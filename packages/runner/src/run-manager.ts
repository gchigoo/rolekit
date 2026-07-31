import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  compilePrompt,
  type ExecutorReport,
  type GateRecordFile,
  type ResultEnvelope,
  type RunEvent,
  validateArtifact,
} from '@rolekit/core'
import { sha256Canonical } from './canonical-json.ts'
import { EMPTY_VERIFICATION, emptyVerificationArtifact } from './empty-verification.ts'
import { ExecutorUnsupportedOperationError, RunManagerError } from './errors.ts'
import { appendEvent, ensureFinishedEvent, hasDedupeKey } from './events.ts'
import {
  closeBarrierSteering,
  commitExitBarrier,
  markExitBarrierReady,
  requestCancellingTransition,
  requestFinalizingTransition,
} from './exit-barrier.ts'
import {
  ensureDir,
  readJsonIfExists,
  readTextIfExists,
  rmSafe,
  runDir as runDirectoryOf,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs-util.ts'
import { buildChangeManifest } from './gate/change-manifest.ts'
import { EMPTY_API_PATHS_WARNING } from './gate/detectors.ts'
import { runGateEvaluationPipeline } from './gate/gate-evaluation-pipeline.ts'
import {
  ensureEmptyApiPathsWarning,
  ensureGateEvents,
  resolveAllPending,
} from './gate/gate-events.ts'
import {
  emptyGatesFile,
  listPending,
  mechanicalScopeRecord,
  readGatesFile,
  recordsFromEvaluation,
  writeGatesFile,
} from './gate/gates-store.ts'
import { IntegrationManager } from './integration-manager.ts'
import { buildInputDigestObject, loadPiCompatRange, loadSnapshots } from './loaders.ts'
import { withLock } from './lock.ts'
import { isProcessIdentityLive, killProcessIdentityTree } from './process-identity.ts'
import { createAdapter } from './registry.ts'
import {
  allocateRunId,
  listReservations,
  markAbortRequested,
  removeReservation,
  writeReservation,
} from './reservation-store.ts'
import {
  lastEventTs,
  projectStatus,
  readRunState,
  updateRunState,
  writeRunState,
  writeRunStateUnlockedAt,
} from './run-state-store.ts'
import { failPendingSteering, SteeringCoordinator } from './steering-coordinator.ts'
import { spawnSupervisor } from './supervisor-spawn.ts'
import type {
  BaselineSnapshot,
  ExecutorControl,
  ManagedRunStatus,
  PrepareRunInput,
  ProcessIdentity,
  ReservationRecord,
  RunHandle,
  RunState,
  VerificationReport,
} from './types.ts'
import { MinimalVerifier } from './verifier.ts'
import { WorktreeManager } from './worktree.ts'

/**
 * RunManager — sole application control plane (design D3).
 */
export class RunManager {
  projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  /**
   * prepare: probe → reservation → preparing → materialize → prepared.
   */
  async prepare(input: PrepareRunInput): Promise<RunHandle> {
    const digestObj = buildInputDigestObject(input)
    const inputDigest = sha256Canonical(digestObj)

    // abort_requested recovery first
    const existing = await listReservations(this.projectRoot, input.task.id)
    for (const rec of existing) {
      if (rec.abort_requested) {
        await this.abortPrepared(rec.run_id).catch(() => undefined)
      }
    }

    const decision = await this.resolveRetry(input, inputDigest, existing)
    if (decision.kind === 'existing') {
      const reservation =
        existing.find((r) => r.run_id === decision.runId) ?? existing[existing.length - 1]!
      await this.resumePreparingIfNeeded(input, inputDigest, reservation)
      return { run_id: decision.runId }
    }

    // probe before any write
    const compat =
      input.adapter === 'pi-rpc' ? await loadPiCompatRange(this.projectRoot) : undefined
    const adapter = createAdapter(input.adapter, {
      projectRoot: this.projectRoot,
      compatRange: compat,
      settings: executorSettings(input.executor_profile),
    })
    await adapter.probe()

    const runId = await allocateRunId(this.projectRoot)
    const reservation: ReservationRecord = {
      task_id: input.task.id,
      attempt: decision.attempt,
      run_id: runId,
      input_digest: inputDigest,
      created_by: decision.createdBy,
      predecessor_run_id: decision.predecessor,
      abort_requested: false,
    }

    // allocation commit: reservation first
    await writeReservation(this.projectRoot, reservation)

    const worktreePath = new WorktreeManager(this.projectRoot).worktreePath(runId)
    const dir = runDirectoryOf(this.projectRoot, runId)
    await ensureDir(join(dir, 'artifacts'))

    const state: RunState = {
      run_id: runId,
      task_id: input.task.id,
      attempt: decision.attempt,
      adapter: input.adapter,
      verifier_mode: input.verifier_mode,
      worktree_path: worktreePath,
      state: 'running',
      phase: 'preparing',
      updated_at: new Date().toISOString(),
    }
    await writeRunState(this.projectRoot, state)

    // materialize 失败时保持 preparing，供同 digest prepare 续跑 / abort 回收
    await this.materialize(input, runId, worktreePath, dir)
    await updateRunState(this.projectRoot, runId, async (s) => ({
      ...s,
      phase: 'prepared',
    }))

    return { run_id: runId }
  }

  /**
   * abortPrepared: only preparing/prepared and not started.
   */
  async abortPrepared(runId: string): Promise<void> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.phase !== 'preparing' && state.phase !== 'prepared') {
      throw new RunManagerError('invalid_transition', `cannot abort in phase ${state.phase}`)
    }
    const wt = new WorktreeManager(this.projectRoot)
    try {
      await wt.remove(runId)
      await rmSafe(runDirectoryOf(this.projectRoot, runId))
      await removeReservation(this.projectRoot, state.task_id, state.attempt)
    } catch {
      await markAbortRequested(this.projectRoot, state.task_id, state.attempt)
      throw new RunManagerError('prepared_abort_failed', `abort cleanup failed for ${runId}`)
    }
  }

  /**
   * ensureAuditEvent: lane-override observe gate only in prepared/starting.
   */
  async ensureAuditEvent(runId: string, event: RunEvent, dedupeKey: string): Promise<void> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.phase !== 'prepared' && state.phase !== 'starting') {
      throw new RunManagerError('invalid_transition', 'ensureAuditEvent phase')
    }
    if (
      event.type !== 'gate' ||
      event.payload.gate !== 'lane-override' ||
      event.payload.action !== 'observe' ||
      event.payload.decision !== 'auto-pass'
    ) {
      throw new RunManagerError(
        'run_audit_failed',
        'ensureAuditEvent only allows lane-override observe',
      )
    }
    const dir = runDirectoryOf(this.projectRoot, runId)
    await withLock(join(dir, '.lock'), async () => {
      if (await hasDedupeKey(dir, dedupeKey)) {
        return
      }
      await appendEvent(dir, {
        run_id: runId,
        type: 'gate',
        payload: {
          ...event.payload,
          evidence: `${event.payload.evidence} dedupe:${dedupeKey}`,
        },
      })
    })
  }

  /**
   * startPrepared: write executor-control intent, spawn supervisor, wait active/terminal.
   */
  async startPrepared(runId: string): Promise<RunHandle> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (
      state.phase === 'finalizing' ||
      state.phase === 'cancelling' ||
      state.phase === 'gate-pending' ||
      state.phase === 'resuming' ||
      state.phase === 'terminal' ||
      state.phase === 'active'
    ) {
      return { run_id: runId }
    }
    if (state.phase !== 'prepared' && state.phase !== 'starting') {
      throw new RunManagerError('invalid_transition', `cannot start from ${state.phase}`)
    }

    const dir = runDirectoryOf(this.projectRoot, runId)
    const snapshots = await loadSnapshots(dir)
    const timeoutMinutes = snapshots.task.execution.timeout_minutes
    const startedAt = new Date().toISOString()
    const deadlineAt = new Date(Date.now() + timeoutMinutes * 60_000).toISOString()
    const token = createHash('sha256')
      .update(`${state.task_id}${state.attempt}${runId}`, 'utf8')
      .digest('hex')

    await updateRunState(this.projectRoot, runId, async (s) => ({
      ...s,
      phase: 'starting',
      started_at: s.started_at ?? startedAt,
      deadline_at: s.deadline_at ?? deadlineAt,
    }))

    const controlPath = join(dir, 'artifacts', 'executor-control.json')
    const existingControl = await readJsonIfExists<ExecutorControl>(controlPath)
    if (!existingControl) {
      await writeJsonAtomic(controlPath, { token, intent: 'start' } satisfies ExecutorControl)
    }

    const spawned = await spawnSupervisor(this.projectRoot, runId)
    if (!spawned.ok) {
      const current = await readRunState(this.projectRoot, runId)
      if (current && current.phase !== 'prepared' && current.phase !== 'starting') {
        return { run_id: runId }
      }
      await updateRunState(this.projectRoot, runId, async (s) => ({
        ...s,
        phase: 'cancelling',
        termination_intent: { status: 'failed', reason: 'supervisor-start' },
      }))
      await this.reconcile(runId)
      throw new RunManagerError('supervisor_start_failed', spawned.error)
    }

    // wait until active or terminal
    const start = Date.now()
    while (Date.now() - start < 30_000) {
      const s = await readRunState(this.projectRoot, runId)
      if (!s) break
      if (
        s.phase === 'active' ||
        s.phase === 'terminal' ||
        s.phase === 'finalizing' ||
        s.phase === 'cancelling'
      ) {
        return { run_id: runId }
      }
      await sleep(50)
    }
    return { run_id: runId }
  }

  async waitUntilSettled(runId: string): Promise<ManagedRunStatus> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.phase === 'preparing' || state.phase === 'prepared') {
      throw new RunManagerError('run_not_started', runId)
    }
    for (;;) {
      const status = await this.status(runId)
      if (status.state === 'awaiting-gate' || status.state === 'finished') {
        return status
      }
      await this.collect(runId).catch((error: unknown) => {
        if (
          error instanceof RunManagerError &&
          (error.code === 'run_not_settled' || error.code === 'run_awaiting_gate')
        ) {
          return null
        }
        throw error
      })
      await sleep(100)
    }
  }

  async status(runId: string): Promise<ManagedRunStatus> {
    await this.reconcile(runId)
    return projectStatus(this.projectRoot, runId)
  }

  async steer(
    runId: string,
    text: string,
    options: { requestId?: string } = {},
  ): Promise<{
    id: string
    state: ManagedRunStatus['state']
    steer: { state: 'accepted'; request_id: string; no_op: boolean }
  }> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.adapter !== 'pi-rpc' && state.adapter !== 'mock') {
      throw new ExecutorUnsupportedOperationError(`${state.adapter} does not declare steer`)
    }
    const result = await new SteeringCoordinator(this.projectRoot).request(runId, text, options)
    const status = await projectStatus(this.projectRoot, runId)
    return {
      id: runId,
      state: status.state,
      steer: { state: 'accepted', request_id: result.requestId, no_op: result.noOp },
    }
  }

  async cancel(runId: string): Promise<{ id: string; state: string; no_op: boolean }> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.phase === 'preparing' || state.phase === 'finalizing' || state.phase === 'resuming') {
      throw new RunManagerError('run_not_cancellable', state.phase)
    }
    if (state.phase === 'terminal') {
      return { id: runId, state: 'finished', no_op: true }
    }
    if (state.phase === 'cancelling') {
      await this.reconcile(runId)
      const s = await projectStatus(this.projectRoot, runId)
      return { id: runId, state: s.state, no_op: false }
    }

    if (state.phase === 'prepared') {
      await this.finalizeFromIntent(runId, { status: 'cancelled', reason: 'user-cancel' })
      return { id: runId, state: 'finished', no_op: false }
    }

    if (state.phase === 'gate-pending') {
      await this.cancelAwaitingGate(runId)
      return { id: runId, state: 'finished', no_op: false }
    }

    if (state.phase === 'active') {
      const outcome = await requestCancellingTransition(this.projectRoot, runId, {
        status: 'cancelled',
        reason: 'user-cancel',
        requested_at: new Date().toISOString(),
      })
      if (outcome === 'report-won' || outcome === 'conflict') {
        throw new RunManagerError('run_not_cancellable', outcome)
      }
    } else {
      await updateRunState(this.projectRoot, runId, async (s) => ({
        ...s,
        phase: 'cancelling',
        termination_intent: { status: 'cancelled', reason: 'user-cancel' },
      }))
    }
    await this.wakeSupervisor(runId)
    await this.reconcile(runId)
    const status = await projectStatus(this.projectRoot, runId)
    return { id: runId, state: status.state, no_op: false }
  }

  /**
   * collect: settle → finalizer → ResultEnvelope.
   */
  async collect(runId: string): Promise<ResultEnvelope> {
    await this.reconcile(runId)
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.phase === 'terminal') {
      const result = await readJsonIfExists<ResultEnvelope>(
        join(runDirectoryOf(this.projectRoot, runId), 'result.json'),
      )
      if (!result) {
        throw new RunManagerError('run_state_inconsistent', 'terminal without result')
      }
      return result
    }
    if (state.phase === 'gate-pending') {
      throw new RunManagerError('run_awaiting_gate', runId)
    }
    if (state.phase === 'preparing' || state.phase === 'prepared' || state.phase === 'starting') {
      throw new RunManagerError('run_not_settled', runId)
    }

    const dir = runDirectoryOf(this.projectRoot, runId)
    const report = await readJsonIfExists<ExecutorReport>(
      join(dir, 'artifacts', 'executor-report.json'),
    )
    if (!report && (state.phase === 'active' || state.phase === 'cancelling')) {
      throw new RunManagerError('run_not_settled', runId)
    }
    if (report && state.phase === 'active') {
      await requestFinalizingTransition(this.projectRoot, runId)
      await this.reconcile(runId)
      const next = await readRunState(this.projectRoot, runId)
      if (next?.phase === 'active') {
        throw new RunManagerError('run_not_settled', runId)
      }
    }
    return this.runFinalizer(runId)
  }

  /**
   * Lists pending human-required gate records for a run id.
   */
  async listGates(runId: string): Promise<{
    id: string
    state: string
    phase: string
    pending: Array<{ index: number; trigger: string; action: string; evidence?: string }>
  }> {
    await this.reconcile(runId)
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    const dir = runDirectoryOf(this.projectRoot, runId)
    const gates = (await readGatesFile(dir)) ?? emptyGatesFile()
    return {
      id: runId,
      state: state.state,
      phase: state.phase,
      pending: listPending(gates),
    }
  }

  /**
   * Approves all pending confirm gates for a run (batch).
   */
  async approveGates(
    runId: string,
    options: { reason?: string; by?: string } = {},
  ): Promise<{ id: string; state: string; decision: 'approved'; no_op: boolean }> {
    return this.decideGates(runId, 'approved', options)
  }

  /**
   * Rejects all pending confirm gates for a run (batch).
   */
  async rejectGates(
    runId: string,
    options: { reason?: string; by?: string } = {},
  ): Promise<{ id: string; state: string; decision: 'rejected'; no_op: boolean }> {
    return this.decideGates(runId, 'rejected', options)
  }

  /**
   * rolekit verify — reverify from baseline+frozen patch without touching primary tree.
   */
  async reverify(runId: string): Promise<{ path: string }> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state) {
      throw new RunManagerError('run_not_found', runId)
    }
    if (state.terminal_status === 'cancelled') {
      throw new RunManagerError('run_not_verifiable', 'cancelled runs cannot be reverified')
    }
    const dir = runDirectoryOf(this.projectRoot, runId)
    const baseline = await readJsonIfExists<BaselineSnapshot>(join(dir, 'baseline.json'))
    const patch = await readTextIfExists(join(dir, 'artifacts', 'integration.patch'))
    const result = await readJsonIfExists<ResultEnvelope>(join(dir, 'result.json'))
    if (!baseline || !result) {
      throw new RunManagerError('run_not_verifiable', 'baseline/result missing')
    }
    if (result.status !== 'completed' && !state.worktree_path) {
      throw new RunManagerError('run_not_verifiable', 'source worktree unavailable')
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const auditPath = join(this.projectRoot, '.rolekit', 'worktrees', `reverify-${runId}-${ts}`)
    const wt = new WorktreeManager(this.projectRoot)
    // create temp worktree from baseline.head
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    await ensureDir(join(this.projectRoot, '.rolekit', 'worktrees'))
    await execFileAsync('git', ['worktree', 'add', '--detach', auditPath, baseline.head], {
      cwd: this.projectRoot,
      encoding: 'utf8',
    })
    try {
      if (patch && result.status === 'completed') {
        const { spawn } = await import('node:child_process')
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('git', ['apply', '--binary'], {
            cwd: auditPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          })
          proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('apply failed'))))
          proc.stdin.write(patch)
          proc.stdin.end()
        })
      }
      const snapshots = await loadSnapshots(dir)
      // temporarily point verify at audit worktree
      const saved = state.worktree_path
      await writeJsonAtomic(join(dir, 'run-state.json'), { ...state, worktree_path: auditPath })
      const verifier = new MinimalVerifier(this.projectRoot)
      // D11 reverify: acceptance+scope on audit worktree only; never flag post-integration primary drift
      const verification = await verifier.verify(dir, snapshots.task, {
        skipPrimaryConcurrent: true,
      })
      await writeJsonAtomic(join(dir, 'run-state.json'), { ...state, worktree_path: saved })
      const artifact = {
        run_id: runId,
        source_patch_sha256: patch
          ? createHash('sha256').update(patch, 'utf8').digest('hex')
          : null,
        verification,
      }
      const out = join(dir, 'artifacts', `reverify-${ts}.json`)
      await writeJsonAtomic(out, artifact)
      return { path: out }
    } finally {
      await wt.remove(`reverify-${runId}-${ts}`).catch(async () => {
        await execFileAsync('git', ['worktree', 'remove', '--force', auditPath], {
          cwd: this.projectRoot,
          encoding: 'utf8',
        }).catch(() => undefined)
        await rmSafe(auditPath)
      })
    }
  }

  // --- internals ---

  private async materialize(
    input: PrepareRunInput,
    runId: string,
    worktreePath: string,
    dir: string,
  ): Promise<void> {
    const wt = new WorktreeManager(this.projectRoot)
    await wt.create(runId)
    const baseline = await wt.captureBaseline()
    await wt.writeBaseline(dir, baseline)
    await writeJsonAtomic(join(dir, 'task.json'), input.task)
    await writeJsonAtomic(join(dir, 'policy-snapshot.json'), input.policy)
    await writeJsonAtomic(join(dir, 'profile-snapshot.json'), input.profile_bundle)
    await writeJsonAtomic(join(dir, 'executor-profile-snapshot.json'), input.executor_profile)
    if (input.verifier_mode === 'enhanced') {
      if (!input.detect_snapshot) {
        throw new RunManagerError('detect_policy_invalid', 'enhanced requires detect snapshot')
      }
      await writeJsonAtomic(join(dir, 'detect-snapshot.json'), input.detect_snapshot)
    }
    await writeJsonAtomic(join(dir, 'knowledge-snapshot.json'), input.knowledgeSnapshot)
    const fragments = input.profile_bundle.resolved_fragments.map((f) => f.content)
    const rules = input.knowledgeSnapshot.rules.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
    }))
    const prompt = compilePrompt(input.profile_bundle.profile, input.task, input.policy, {
      fragmentContents: fragments,
      rules,
    })
    await writeTextAtomic(join(dir, 'prompt.md'), prompt)
    await writeTextAtomic(join(dir, 'events.jsonl'), '')
    // refresh worktree_path in state
    await updateRunState(this.projectRoot, runId, async (s) => ({
      ...s,
      worktree_path: worktreePath,
    }))
  }

  /**
   * Reservation-only / preparing recovery (D6 / pi-rpc D3b·D11):
   * same digest → resume materialize to prepared; different digest → inconsistent.
   * Phases past preparing are idempotent no-ops (frozen snapshots).
   */
  private async resumePreparingIfNeeded(
    input: PrepareRunInput,
    inputDigest: string,
    reservation: ReservationRecord,
  ): Promise<void> {
    const state = await readRunState(this.projectRoot, reservation.run_id)
    if (state && state.phase !== 'preparing') {
      return
    }
    if (reservation.input_digest !== inputDigest) {
      throw new RunManagerError(
        'run_state_inconsistent',
        'reservation digest mismatch while preparing',
      )
    }
    const worktreePath =
      state?.worktree_path ?? new WorktreeManager(this.projectRoot).worktreePath(reservation.run_id)
    const dir = runDirectoryOf(this.projectRoot, reservation.run_id)
    await ensureDir(join(dir, 'artifacts'))
    if (!state) {
      await writeRunState(this.projectRoot, {
        run_id: reservation.run_id,
        task_id: input.task.id,
        attempt: reservation.attempt,
        adapter: input.adapter,
        verifier_mode: input.verifier_mode,
        worktree_path: worktreePath,
        state: 'running',
        phase: 'preparing',
        updated_at: new Date().toISOString(),
      })
    }
    await this.materialize(input, reservation.run_id, worktreePath, dir)
    await updateRunState(this.projectRoot, reservation.run_id, async (s) => ({
      ...s,
      phase: 'prepared',
    }))
  }

  private async resolveRetry(
    input: PrepareRunInput,
    inputDigest: string,
    existing: ReservationRecord[],
  ): Promise<
    | { kind: 'existing'; runId: string }
    | {
        kind: 'new'
        attempt: number
        createdBy: 'initial' | 'retry'
        predecessor?: string
      }
  > {
    if (!input.retry) {
      if (existing.length === 0) {
        return { kind: 'new', attempt: 1, createdBy: 'initial' }
      }
      const latest = existing[existing.length - 1]!
      return { kind: 'existing', runId: latest.run_id }
    }

    if (existing.length === 0) {
      throw new RunManagerError('retry_not_allowed', 'no prior reservation')
    }
    const latest = existing[existing.length - 1]!
    const latestState = await readRunState(this.projectRoot, latest.run_id)
    const terminal = latestState?.phase === 'terminal' ? latestState.terminal_status : null
    if (terminal === 'failed' || terminal === 'cancelled' || terminal === 'question') {
      return {
        kind: 'new',
        attempt: latest.attempt + 1,
        createdBy: 'retry',
        predecessor: latest.run_id,
      }
    }
    if (
      latestState &&
      latestState.phase !== 'terminal' &&
      latest.created_by === 'retry' &&
      latest.predecessor_run_id &&
      latest.input_digest === inputDigest
    ) {
      return { kind: 'existing', runId: latest.run_id }
    }
    throw new RunManagerError('retry_not_allowed', 'retry preconditions not met')
  }

  private async wakeSupervisor(runId: string): Promise<void> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    await writeJsonAtomic(join(dir, 'artifacts', 'cancel-wake.json'), {
      at: new Date().toISOString(),
    })
  }

  async reconcile(runId: string): Promise<void> {
    const state = await readRunState(this.projectRoot, runId)
    if (!state || state.phase === 'terminal') {
      if (state?.phase === 'terminal') {
        const result = await readJsonIfExists<ResultEnvelope>(
          join(runDirectoryOf(this.projectRoot, runId), 'result.json'),
        )
        if (!result) throw new RunManagerError('run_state_inconsistent', 'terminal missing result')
      }
      return
    }
    if (state.phase === 'preparing' || state.phase === 'prepared') return

    const dir = runDirectoryOf(this.projectRoot, runId)
    if (state.phase === 'gate-pending') {
      const gates = await readGatesFile(dir)
      if (gates) await ensureGateEvents(dir, runId, gates)
      return
    }
    if (state.phase === 'resuming') {
      await this.runFinalizer(runId).catch(() => undefined)
      return
    }

    // D3: durable transition recovery always precedes report/deadline inference.
    if (state.transition_intent) {
      await this.reconcileExitTransition(runId, state)
      return
    }

    if (state.phase === 'finalizing' && state.state === 'running') {
      if (await this.tryReconcilePreAwait(runId)) return
    }

    const report = await readJsonIfExists<ExecutorReport>(
      join(dir, 'artifacts', 'executor-report.json'),
    )
    const live = await isSupervisorLive(dir)

    if (report) {
      if (state.phase === 'active') {
        await requestFinalizingTransition(this.projectRoot, runId)
        await this.reconcile(runId)
      } else if (state.phase === 'finalizing' || state.phase === 'cancelling') {
        await this.runFinalizer(runId).catch(() => undefined)
      }
      return
    }

    const control = await readJsonIfExists<ExecutorControl>(
      join(dir, 'artifacts', 'executor-control.json'),
    )
    if (!live) {
      // Liveness probing is outside the run lock; re-read durable winners before fixing owner loss.
      const current = await readRunState(this.projectRoot, runId)
      if (!current) return
      if (current.transition_intent) {
        await this.reconcileExitTransition(runId, current)
        return
      }
      const committedReport = await readJsonIfExists<ExecutorReport>(
        join(dir, 'artifacts', 'executor-report.json'),
      )
      if (committedReport && current.phase === 'active') {
        await requestFinalizingTransition(this.projectRoot, runId)
        await this.reconcile(runId)
        return
      }
      if (current.phase === 'starting' && control && !control.started) {
        // The only same-run restart: no durable started receipt exists.
        await spawnSupervisor(this.projectRoot, runId)
        return
      }
      if (current.phase === 'starting' || current.phase === 'active') {
        // Owner loss wins over an expired deadline when neither report nor cancel intent committed.
        await failPendingSteering(this.projectRoot, runId, 'executor_lost')
        const winner = await readRunState(this.projectRoot, runId)
        if (winner?.transition_intent) {
          await this.reconcileExitTransition(runId, winner)
          return
        }
        if (await readJsonIfExists(join(dir, 'artifacts', 'executor-report.json'))) {
          await requestFinalizingTransition(this.projectRoot, runId)
          await this.reconcile(runId)
          return
        }
        await this.stopRecordedExecutor(current, control)
        await this.finalizeFromIntent(runId, { status: 'failed', reason: 'lost' })
        return
      }
      if (current.phase === 'cancelling' && current.termination_intent) {
        await this.stopRecordedExecutor(current, control)
        await this.finalizeFromIntent(runId, current.termination_intent)
      }
      return
    }

    if (
      state.phase === 'active' &&
      state.deadline_at &&
      Date.now() > Date.parse(state.deadline_at)
    ) {
      // Timeout may participate only while the owner identity is still live.
      const outcome = await requestCancellingTransition(this.projectRoot, runId, {
        status: 'failed',
        reason: 'timeout',
        requested_at: new Date().toISOString(),
      })
      if (outcome === 'created' || outcome === 'existing') await this.wakeSupervisor(runId)
    }
  }

  private async reconcileExitTransition(runId: string, state: RunState): Promise<void> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    const intent = state.transition_intent
    if (!intent) throw new RunManagerError('run_state_inconsistent', 'missing exit transition')
    if (intent.state === 'committed') {
      if (state.phase !== intent.to) {
        throw new RunManagerError('run_state_inconsistent', 'committed barrier phase mismatch')
      }
      if (intent.to === 'cancelling' && state.termination_intent) {
        await this.finalizeFromIntent(runId, state.termination_intent)
      } else {
        await this.runFinalizer(runId).catch(() => undefined)
      }
      return
    }
    if (state.phase !== 'active') {
      throw new RunManagerError('run_state_inconsistent', 'uncommitted barrier outside active')
    }
    if (intent.state === 'ready') {
      await commitExitBarrier(this.projectRoot, runId)
      await this.reconcile(runId)
      return
    }

    const report = await readJsonIfExists<ExecutorReport>(
      join(dir, 'artifacts', 'executor-report.json'),
    )
    const live = await isSupervisorLive(dir)
    if (live) {
      if (intent.to === 'cancelling') await this.wakeSupervisor(runId)
      return
    }

    const control = await readJsonIfExists<ExecutorControl>(
      join(dir, 'artifacts', 'executor-control.json'),
    )
    if (intent.to === 'cancelling') {
      await closeBarrierSteering(this.projectRoot, runId, {
        closeInflight: true,
        inflightError: 'run_not_steerable',
      })
      const stopped = await this.stopRecordedExecutor(state, control)
      if (!stopped) throw new RunManagerError('executor_lost', 'executor tree did not stop')
      await markExitBarrierReady(this.projectRoot, runId, { executorStopped: true })
      await commitExitBarrier(this.projectRoot, runId)
      await this.reconcile(runId)
      return
    }

    await closeBarrierSteering(this.projectRoot, runId, {
      closeInflight: true,
      inflightError: 'executor_lost',
    })
    if (report) {
      await markExitBarrierReady(this.projectRoot, runId)
      await commitExitBarrier(this.projectRoot, runId)
      await this.runFinalizer(runId).catch(() => undefined)
      return
    }

    // A report-side pending barrier is not a winner. Without its owner/report, close it as lost.
    await withLock(join(dir, '.lock'), async () => {
      const current = await readRunState(this.projectRoot, runId)
      if (
        current?.phase === 'active' &&
        current.transition_intent?.barrier_id === intent.barrier_id &&
        current.transition_intent.state === 'pending'
      ) {
        await writeRunStateUnlockedAt(dir, { ...current, transition_intent: null })
      }
    })
    await this.stopRecordedExecutor(state, control)
    await this.finalizeFromIntent(runId, { status: 'failed', reason: 'lost' })
  }

  private async stopRecordedExecutor(
    state: RunState,
    control: ExecutorControl | null,
  ): Promise<boolean> {
    if (state.adapter === 'mock' || !control?.started) return true
    const started = control.started
    if (!started.start_time_utc || !started.command_sha256) return true
    const identity: ProcessIdentity = {
      pid: started.pid,
      start_time_utc: started.start_time_utc,
      command_sha256: started.command_sha256,
    }
    if (!(await isProcessIdentityLive(identity))) return true
    return killProcessIdentityTree(identity)
  }

  private async finalizeFromIntent(
    runId: string,
    intent: { status: 'cancelled' | 'failed'; reason: string },
  ): Promise<ResultEnvelope> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    return withLock(join(dir, '.lock'), async () => {
      const existing = await readJsonIfExists<ResultEnvelope>(join(dir, 'result.json'))
      if (existing) return existing
      const state = await readRunState(this.projectRoot, runId)
      if (!state) throw new RunManagerError('run_not_found', runId)
      return this.finalizeFromIntentUnlocked(runId, intent)
    })
  }

  private async runFinalizer(runId: string): Promise<ResultEnvelope> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    return withLock(join(dir, '.lock'), async () => {
      const existing = await readJsonIfExists<ResultEnvelope>(join(dir, 'result.json'))
      if (existing) {
        const st = await readRunState(this.projectRoot, runId)
        if (st && st.phase !== 'terminal') {
          await writeRunStateUnlockedAt(dir, {
            ...st,
            phase: 'terminal',
            transition_intent: null,
            terminal_status: existing.status,
            reason: existing.summary,
            state: 'finished',
            updated_at: new Date().toISOString(),
          })
          await ensureFinishedEvent(dir, runId, existing.status, existing.summary)
        }
        return existing
      }

      let state = (await readRunState(this.projectRoot, runId))!
      const report = await readJsonIfExists<ExecutorReport>(
        join(dir, 'artifacts', 'executor-report.json'),
      )

      // intent wins if committed before report (except gate-pending)
      if (state.termination_intent && state.phase === 'cancelling' && !report) {
        return this.finalizeFromIntentUnlocked(runId, state.termination_intent)
      }

      if (!report) {
        throw new RunManagerError('run_not_settled', runId)
      }

      // commit finalizing
      if (
        state.phase !== 'finalizing' &&
        state.phase !== 'gate-pending' &&
        state.phase !== 'resuming'
      ) {
        state = {
          ...state,
          phase: 'finalizing',
          updated_at: new Date().toISOString(),
        }
        await writeJsonAtomic(join(dir, 'run-state.json'), state)
      }

      // short-circuit non-completed executor reports (question/blocked/failed/cancelled)
      if (report.status !== 'completed' && state.phase !== 'resuming') {
        await writeJsonAtomic(join(dir, 'verification.json'), emptyVerificationArtifact())
        await writeGatesFile(dir, emptyGatesFile())
        const envelope = buildEnvelope({
          taskId: state.task_id,
          status: report.status,
          summary: report.summary,
          verification: EMPTY_VERIFICATION,
          scope_violations: [],
          unresolved: report.unresolved.length ? report.unresolved : [report.status],
          changed_files: report.changed_files,
          decisions: report.decisions,
          assumptions: report.assumptions,
          evidence: report.evidence,
          risks: report.risks,
        })
        await this.commitTerminalUnlocked(runId, envelope, report.summary)
        return envelope
      }

      // resuming path: skip re-verify; consume approved/rejected gates
      if (state.phase === 'resuming') {
        return this.finalizeAfterGateDecision(runId, state, report)
      }

      // completed → verify once
      const snapshots = await loadSnapshots(dir)
      let verification = await readJsonIfExists<VerificationReport>(join(dir, 'verification.json'))
      if (!verification) {
        const verifier = new MinimalVerifier(this.projectRoot)
        verification = await verifier.verify(dir, snapshots.task)
        await writeJsonAtomic(join(dir, 'verification.json'), verification)
      }

      const pipeline = runGateEvaluationPipeline({
        verification,
        executorReport: report,
        policy: snapshots.policy,
        detect: snapshots.detect_snapshot,
        manifest: null,
        verifierMode: state.verifier_mode,
      })

      if (pipeline.branch.kind === 'mechanical-scope-block') {
        const ts = new Date().toISOString()
        const gates: GateRecordFile = {
          schema: 'rolekit/gate-record@1',
          records: [mechanicalScopeRecord(ts)],
        }
        await writeGatesFile(dir, gates)
        await ensureGateEvents(dir, runId, gates)
        const envelope = buildEnvelope({
          taskId: state.task_id,
          status: 'failed',
          summary: 'verification failed',
          verification: verification.results,
          scope_violations: verification.scope_violations,
          unresolved: verification.scope_violations,
          changed_files: report.changed_files,
        })
        await this.commitTerminalUnlocked(runId, envelope, 'verification failed')
        return envelope
      }

      if (pipeline.branch.kind === 'verification-failed') {
        await writeGatesFile(dir, emptyGatesFile())
        const envelope = buildEnvelope({
          taskId: state.task_id,
          status: 'failed',
          summary: 'verification failed',
          verification: verification.results,
          scope_violations: verification.scope_violations,
          unresolved: ['acceptance failed'],
          changed_files: report.changed_files,
        })
        await this.commitTerminalUnlocked(runId, envelope, 'verification failed')
        return envelope
      }

      // enhanced: build immutable change-manifest before detectors re-run with manifest
      let manifest = null
      if (state.verifier_mode === 'enhanced') {
        const existingManifest = await readJsonIfExists(
          join(dir, 'artifacts', 'change-manifest.json'),
        )
        if (existingManifest) {
          manifest = existingManifest as Awaited<ReturnType<typeof buildChangeManifest>>
        } else {
          manifest = await buildChangeManifest(state.worktree_path)
          await writeJsonAtomic(join(dir, 'artifacts', 'change-manifest.json'), manifest)
        }
      }

      const evaluated = runGateEvaluationPipeline({
        verification,
        executorReport: report,
        policy: snapshots.policy,
        detect: snapshots.detect_snapshot,
        manifest,
        verifierMode: state.verifier_mode,
      })

      if (evaluated.warnEmptyApiPaths) {
        await ensureEmptyApiPathsWarning(dir, runId, EMPTY_API_PATHS_WARNING)
      }

      const ts = new Date().toISOString()
      const evaluation = evaluated.evaluation!
      const records = recordsFromEvaluation(
        evaluation.decisions,
        evaluated.hits,
        evaluation.overall,
        ts,
      )
      const gatesFile: GateRecordFile = { schema: 'rolekit/gate-record@1', records }

      // freeze candidate/patch before awaiting or integrate (D12)
      const baseline = (await readJsonIfExists<BaselineSnapshot>(join(dir, 'baseline.json')))!
      const integration = new IntegrationManager(this.projectRoot)
      try {
        const existingCandidate = await readJsonIfExists(join(dir, 'artifacts', 'candidate.json'))
        if (!existingCandidate) {
          await integration.freezeCandidate(dir, state.worktree_path, state.verifier_mode)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'integration failed'
        await writeGatesFile(dir, emptyGatesFile())
        const envelope = buildEnvelope({
          taskId: state.task_id,
          status: 'failed',
          summary: message,
          verification: verification.results,
          scope_violations: [],
          unresolved: [message],
          changed_files: report.changed_files,
        })
        await this.commitTerminalUnlocked(runId, envelope, message)
        return envelope
      }

      if (evaluated.branch.kind === 'awaiting-confirm') {
        await writeGatesFile(dir, gatesFile)
        await ensureGateEvents(dir, runId, gatesFile)
        await writeRunStateUnlockedAt(dir, {
          ...state,
          phase: 'gate-pending',
          transition_intent: null,
          state: 'awaiting-gate',
          updated_at: ts,
        })
        throw new RunManagerError('run_awaiting_gate', runId)
      }

      if (evaluated.branch.kind === 'blocked') {
        await writeGatesFile(dir, gatesFile)
        await ensureGateEvents(dir, runId, gatesFile)
        const envelope = buildEnvelope({
          taskId: state.task_id,
          status: 'blocked',
          summary: 'gate blocked',
          verification: verification.results,
          scope_violations: [],
          unresolved: evaluation.decisions
            .filter((d) => d.action === 'block')
            .map((d) => d.trigger),
          changed_files: report.changed_files,
          evidence: [...report.evidence, 'verification.json', 'gates.json'],
        })
        await this.commitTerminalUnlocked(runId, envelope, 'gate blocked')
        return envelope
      }

      // integrate (observe/ignore)
      await writeGatesFile(dir, gatesFile)
      await ensureGateEvents(dir, runId, gatesFile)
      try {
        await integration.integrate(dir, baseline)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'integration failed'
        const envelope = buildEnvelope({
          taskId: state.task_id,
          status: 'failed',
          summary: message,
          verification: verification.results,
          scope_violations: message.includes('并发') ? [`concurrent-change: ${message}`] : [],
          unresolved: [message],
          changed_files: report.changed_files,
        })
        await this.commitTerminalUnlocked(runId, envelope, message)
        return envelope
      }

      const envelope = buildEnvelope({
        taskId: state.task_id,
        status: 'completed',
        summary: report.summary,
        verification: verification.results,
        scope_violations: [],
        unresolved: report.unresolved,
        changed_files: report.changed_files,
        decisions: report.decisions,
        assumptions: report.assumptions,
        evidence: await evidenceForCompleted(dir, report.evidence),
        risks: report.risks,
      })
      await this.commitTerminalUnlocked(runId, envelope, null)

      const wt = new WorktreeManager(this.projectRoot)
      const removed = await wt.remove(runId)
      if (removed.orphan) {
        await appendEvent(dir, {
          run_id: runId,
          type: 'message',
          payload: { role: 'system', text: 'orphan worktree: remove failed' },
        })
      }
      return envelope
    })
  }

  private async finalizeAfterGateDecision(
    runId: string,
    state: RunState,
    report: ExecutorReport,
  ): Promise<ResultEnvelope> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    const verification =
      (await readJsonIfExists<VerificationReport>(join(dir, 'verification.json'))) ??
      emptyVerificationArtifact()
    const gates = (await readGatesFile(dir)) ?? emptyGatesFile()
    const pending = listPending(gates)
    if (pending.length > 0) {
      throw new RunManagerError('run_awaiting_gate', runId)
    }

    const rejected = gates.records.some((r) => r.resolution?.result === 'rejected')
    if (rejected) {
      const envelope = buildEnvelope({
        taskId: state.task_id,
        status: 'blocked',
        summary: 'gate rejected',
        verification: verification.results,
        scope_violations: verification.scope_violations,
        unresolved: ['gate rejected'],
        changed_files: report.changed_files,
        evidence: [...report.evidence, 'verification.json', 'gates.json'],
      })
      await this.commitTerminalUnlocked(runId, envelope, 'gate rejected')
      return envelope
    }

    const cancelled = gates.records.some((r) => r.resolution?.result === 'cancelled')
    if (cancelled && !gates.records.some((r) => r.resolution?.result === 'approved')) {
      const envelope = buildEnvelope({
        taskId: state.task_id,
        status: 'cancelled',
        summary: 'cancelled at gate',
        verification: verification.results,
        scope_violations: verification.scope_violations,
        unresolved: ['cancelled at gate'],
        changed_files: report.changed_files,
      })
      await this.commitTerminalUnlocked(runId, envelope, 'user-cancel')
      return envelope
    }

    const baseline = (await readJsonIfExists<BaselineSnapshot>(join(dir, 'baseline.json')))!
    const integration = new IntegrationManager(this.projectRoot)
    try {
      await integration.integrate(dir, baseline)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'integration failed'
      const envelope = buildEnvelope({
        taskId: state.task_id,
        status: 'failed',
        summary: message,
        verification: verification.results,
        scope_violations: message.includes('并发') ? [`concurrent-change: ${message}`] : [],
        unresolved: [message],
        changed_files: report.changed_files,
      })
      await this.commitTerminalUnlocked(runId, envelope, message)
      return envelope
    }

    const envelope = buildEnvelope({
      taskId: state.task_id,
      status: 'completed',
      summary: report.summary,
      verification: verification.results,
      scope_violations: [],
      unresolved: report.unresolved,
      changed_files: report.changed_files,
      decisions: report.decisions,
      assumptions: report.assumptions,
      evidence: await evidenceForCompleted(dir, report.evidence),
      risks: report.risks,
    })
    await this.commitTerminalUnlocked(runId, envelope, null)
    const wt = new WorktreeManager(this.projectRoot)
    await wt.remove(runId).catch(() => undefined)
    return envelope
  }

  private async finalizeFromIntentUnlocked(
    runId: string,
    intent: { status: 'cancelled' | 'failed'; reason: string },
  ): Promise<ResultEnvelope> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    const state = await readRunState(this.projectRoot, runId)
    if (!state) throw new RunManagerError('run_not_found', runId)
    await writeJsonAtomic(join(dir, 'verification.json'), emptyVerificationArtifact())
    await writeGatesFile(dir, emptyGatesFile())
    const envelope = buildEnvelope({
      taskId: state.task_id,
      status: intent.status,
      summary: intent.reason,
      verification: EMPTY_VERIFICATION,
      scope_violations: [],
      unresolved: [intent.reason],
    })
    await this.commitTerminalUnlocked(runId, envelope, intent.reason)
    return envelope
  }

  private async commitTerminalUnlocked(
    runId: string,
    envelope: ResultEnvelope,
    reason: string | null,
  ): Promise<void> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    const validation = validateArtifact('rolekit/result-envelope@1', envelope)
    if (!validation.valid) {
      throw new RunManagerError('run_state_inconsistent', 'invalid envelope')
    }
    // ensure gates wrapper exists on every terminal
    if (!(await readGatesFile(dir))) {
      await writeGatesFile(dir, emptyGatesFile())
    }
    await writeJsonAtomic(join(dir, 'result.json'), envelope)
    await ensureFinishedEvent(dir, runId, envelope.status, reason)
    const state = (await readRunState(this.projectRoot, runId))!
    await writeJsonAtomic(join(dir, 'run-state.json'), {
      ...state,
      phase: 'terminal',
      transition_intent: null,
      state: 'finished',
      terminal_status: envelope.status,
      reason,
      updated_at: new Date().toISOString(),
    } satisfies RunState)
  }

  private async tryReconcilePreAwait(runId: string): Promise<boolean> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    const verification = await readJsonIfExists<VerificationReport>(join(dir, 'verification.json'))
    const candidate = await readJsonIfExists(join(dir, 'artifacts', 'candidate.json'))
    const patch = await readTextIfExists(join(dir, 'artifacts', 'integration.patch'))
    const result = await readJsonIfExists(join(dir, 'result.json'))
    const gates = await readGatesFile(dir)
    if (!verification || !candidate || patch === null || result || !gates) {
      return false
    }
    const pending = listPending(gates)
    if (pending.length === 0) {
      return false
    }
    await withLock(join(dir, '.lock'), async () => {
      await ensureGateEvents(dir, runId, gates)
      const state = (await readRunState(this.projectRoot, runId))!
      if (state.phase === 'finalizing' && !result) {
        await writeRunStateUnlockedAt(dir, {
          ...state,
          phase: 'gate-pending',
          transition_intent: null,
          state: 'awaiting-gate',
          updated_at: new Date().toISOString(),
        })
      }
    })
    return true
  }

  private async decideGates<D extends 'approved' | 'rejected'>(
    runId: string,
    decision: D,
    options: { reason?: string; by?: string },
  ): Promise<{ id: string; state: string; decision: D; no_op: boolean }> {
    await this.reconcile(runId)
    const dir = runDirectoryOf(this.projectRoot, runId)
    return withLock(join(dir, '.lock'), async () => {
      let state = (await readRunState(this.projectRoot, runId))!
      if (!state) {
        throw new RunManagerError('run_not_found', runId)
      }

      if (state.phase === 'terminal') {
        const gates = (await readGatesFile(dir)) ?? emptyGatesFile()
        const pending = listPending(gates)
        if (pending.length > 0) {
          throw new RunManagerError('run_state_inconsistent', 'terminal with pending gates')
        }
        const same = gates.records.some((r) => r.resolution?.result === decision)
        if (same) {
          return { id: runId, state: 'finished', decision, no_op: true }
        }
        const opposite = gates.records.some(
          (r) =>
            r.resolution &&
            (r.resolution.result === 'approved' ||
              r.resolution.result === 'rejected' ||
              r.resolution.result === 'cancelled') &&
            r.resolution.result !== decision,
        )
        if (opposite) {
          throw new RunManagerError('gate_decision_conflict', runId)
        }
        throw new RunManagerError('no_pending_gate', runId)
      }

      if (state.phase === 'resuming') {
        // continue finalizer outside lock after no-op decision write
      } else if (state.phase !== 'gate-pending') {
        // try pre-await morph first
        const gatesEarly = await readGatesFile(dir)
        if (state.phase === 'finalizing' && gatesEarly && listPending(gatesEarly).length > 0) {
          await ensureGateEvents(dir, runId, gatesEarly)
          state = {
            ...state,
            phase: 'gate-pending',
            transition_intent: null,
            state: 'awaiting-gate',
            updated_at: new Date().toISOString(),
          }
          await writeRunStateUnlockedAt(dir, state)
        } else {
          throw new RunManagerError('no_pending_gate', runId)
        }
      }

      const gates = (await readGatesFile(dir)) ?? emptyGatesFile()
      const pending = listPending(gates)
      if (pending.length === 0) {
        if (state.phase === 'resuming') {
          // fall through to collect
        } else if (state.phase === 'terminal') {
          return { id: runId, state: 'finished', decision, no_op: true }
        } else {
          throw new RunManagerError('no_pending_gate', runId)
        }
      } else {
        const ts = new Date().toISOString()
        const resolved = resolveAllPending(gates, {
          result: decision,
          by: options.by ?? 'owner',
          ...(options.reason ? { reason: options.reason } : {}),
          ts,
        })
        await writeGatesFile(dir, resolved)
        await writeRunStateUnlockedAt(dir, {
          ...state,
          phase: 'resuming',
          state: 'running',
          updated_at: ts,
        })
      }
      return { id: runId, state: 'running', decision, no_op: false }
    }).then(async (out) => {
      if (!out.no_op) {
        await this.collect(runId).catch((error: unknown) => {
          if (error instanceof RunManagerError && error.code === 'run_awaiting_gate') {
            return null
          }
          throw error
        })
      }
      const status = await projectStatus(this.projectRoot, runId)
      return { ...out, state: status.state }
    })
  }

  private async cancelAwaitingGate(runId: string): Promise<void> {
    const dir = runDirectoryOf(this.projectRoot, runId)
    await withLock(join(dir, '.lock'), async () => {
      const state = (await readRunState(this.projectRoot, runId))!
      const verification =
        (await readJsonIfExists<VerificationReport>(join(dir, 'verification.json'))) ??
        emptyVerificationArtifact()
      const report = await readJsonIfExists<ExecutorReport>(
        join(dir, 'artifacts', 'executor-report.json'),
      )
      const gates = (await readGatesFile(dir)) ?? emptyGatesFile()
      const ts = new Date().toISOString()
      const cancelled = resolveAllPending(gates, {
        result: 'cancelled',
        by: 'system',
        reason: 'user-cancel',
        ts,
      })
      await writeGatesFile(dir, cancelled)
      const envelope = buildEnvelope({
        taskId: state.task_id,
        status: 'cancelled',
        summary: 'cancelled at gate',
        verification: verification.results,
        scope_violations: verification.scope_violations,
        unresolved: ['cancelled at gate'],
        changed_files: report?.changed_files ?? [],
      })
      await this.commitTerminalUnlocked(runId, envelope, 'user-cancel')
    })
  }
}

/**
 * D6：kind=research completed 的 evidence 恰为 ExecutorReport 两项；其它 kind 附加 runner 元数据。
 */
async function evidenceForCompleted(runDir: string, reportEvidence: string[]): Promise<string[]> {
  const task = await readJsonIfExists<{ kind?: string }>(join(runDir, 'task.json'))
  if (task?.kind === 'research') {
    return [...reportEvidence]
  }
  return [...reportEvidence, 'verification.json', 'result.json', 'gates.json']
}

/** Merges executor-profile top-level model into adapter settings (top-level wins). */
function executorSettings(profile: {
  model?: string
  settings?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    ...(profile.settings ?? {}),
    ...(typeof profile.model === 'string' ? { model: profile.model } : {}),
  }
}

function buildEnvelope(args: {
  taskId: string
  status: ResultEnvelope['status']
  summary: string
  verification: ResultEnvelope['verification']
  scope_violations: string[]
  unresolved: string[]
  changed_files?: string[]
  decisions?: string[]
  assumptions?: string[]
  evidence?: string[]
  risks?: string[]
}): ResultEnvelope {
  return {
    schema: 'rolekit/result-envelope@1',
    task_id: args.taskId,
    status: args.status,
    summary: args.summary,
    changed_files: args.changed_files ?? [],
    verification: args.verification,
    scope_violations: args.scope_violations,
    decisions: args.decisions ?? [],
    assumptions: args.assumptions ?? [],
    evidence: args.evidence ?? ['result.json', 'verification.json', 'events.jsonl'],
    risks: args.risks ?? [],
    unresolved: args.unresolved,
    recommended_next_action:
      args.status === 'completed' ? 'done' : 'inspect unresolved and retry if needed',
  }
}

async function isSupervisorLive(dir: string): Promise<boolean> {
  const sup = await readJsonIfExists<Partial<ProcessIdentity>>(
    join(dir, 'artifacts', 'supervisor.json'),
  )
  if (!sup?.pid) return false
  if (sup.start_time_utc && sup.command_sha256) {
    return isProcessIdentityLive(sup as ProcessIdentity)
  }
  // Compatibility for pre-hardening fixtures; production acknowledgements always carry identity.
  try {
    process.kill(sup.pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { lastEventTs }

import { join, resolve } from 'node:path'
import {
  adoptRunResult,
  applyProcessGateAction,
  applyQuestionGateAction,
  attachRun,
  evaluate,
  type GateAction,
  type GatePolicy,
  hasResolvedDesignArtifact,
  InvalidTransition,
  type Lane,
  latestRecoveryRunsCount,
  RolekitError,
  selectLane,
  transition,
  type WorkItem,
} from '@rolekit/core'
import {
  loadGatePolicy,
  loadRunInput,
  loadTask,
  type ManagedRunStatus,
  type RunManager,
  RunManagerError,
  sha256Canonical,
  UnknownAdapterError,
} from '@rolekit/runner'
import { WorkItemCliError } from './errors.ts'
import type { StoredWorkItem, WorkItemStore } from './store.ts'

export interface StartFlags {
  taskPath?: string
  estimated_files: number
  cross_module: boolean
  migration: boolean
  context_already_loaded: boolean
  laneOverride?: Lane
}

export interface StartResult {
  item: WorkItem
  run_id?: string
  no_op?: boolean
  exitCode: number
  error?: string
  next_action?: string
}

/**
 * workitem start saga (design D2 c/d/e).
 */
export async function startWorkItem(
  store: WorkItemStore,
  rm: RunManager,
  id: string,
  flags: StartFlags,
): Promise<StartResult> {
  // Phase 0: existing-run prefer path (no loaders)
  let initial = await store.withLock(async () => store.read(id))
  let item = initial.item
  let revision = initial.revision
  const initialRecoveryCount = latestRecoveryRunsCount(item)
  if (initialRecoveryCount !== undefined && initialRecoveryCount > item.runs.length) {
    throw new WorkItemCliError('invalid_workitem', {
      id,
      detail: 'recovery_runs_count exceeds runs length',
    })
  }
  const migratedUnclaimed =
    initialRecoveryCount === undefined &&
    item.status === 'executing' &&
    item.lane === null &&
    item.runs.length === 0
  const recovery =
    !migratedUnclaimed &&
    initialRecoveryCount !== undefined &&
    initialRecoveryCount === item.runs.length

  if (!recovery && item.status === 'executing' && item.runs.length > 0) {
    const latestRunId = item.runs[item.runs.length - 1]
    if (!latestRunId) {
      throw new WorkItemCliError('run_state_inconsistent', { id })
    }
    const status = await rm.status(latestRunId)
    const handled = await handleExistingRun(store, rm, initial, status, flags)
    if (handled) return handled
    initial = await store.withLock(async () => store.read(id))
    item = initial.item
    revision = initial.revision
  }

  if (item.status === 'executing' && item.lane === 'direct' && item.runs.length === 0) {
    throw new WorkItemCliError('invalid_transition', {
      id,
      detail: 'direct executing host in progress',
    })
  }

  if (item.status !== 'planned' && item.status !== 'designing' && item.status !== 'executing') {
    throw new WorkItemCliError('invalid_transition', {
      id,
      detail: `cannot start from ${item.status}`,
    })
  }

  // Retry path: executing + terminal failed|cancelled|question.
  // Recovery markers deliberately bypass existing-run inspection and create attempt 1 for a new task id.
  let retry = false
  let retryStatus: 'failed' | 'cancelled' | 'question' | undefined
  if (recovery && !flags.taskPath) {
    throw new WorkItemCliError('recovery_task_required', { id })
  }
  if (!recovery && item.status === 'executing' && item.runs.length > 0) {
    const latestRunId = item.runs[item.runs.length - 1]
    if (!latestRunId) {
      throw new WorkItemCliError('run_state_inconsistent', { id })
    }
    const status = await rm.status(latestRunId)
    if (status.state === 'finished') {
      const envelope = await rm.collect(latestRunId)
      if (envelope.status === 'completed') {
        return adoptAndReturn(store, item, revision, latestRunId, envelope)
      }
      if (envelope.status === 'blocked') {
        return adoptAndReturn(store, item, revision, latestRunId, envelope)
      }
      if (
        envelope.status === 'failed' ||
        envelope.status === 'cancelled' ||
        envelope.status === 'question'
      ) {
        if (!flags.taskPath) {
          throw new WorkItemCliError('retry_task_required', {
            id,
            run_id: latestRunId,
            ...(envelope.status === 'question'
              ? {
                  next_action: `rolekit workitem start ${id} --task <revised-task>`,
                }
              : {}),
          })
        }
        retry = true
        retryStatus = envelope.status
      }
    }
  }

  // Recovery and question-answer checks intentionally precede the full run-input loader and prepare.
  if (flags.taskPath && (recovery || retryStatus === 'question')) {
    let candidate: Awaited<ReturnType<typeof loadTask>>
    try {
      candidate = await loadTask(resolve(flags.taskPath))
    } catch (error) {
      throw mapLoaderError(error)
    }
    if (recovery) {
      for (const runId of item.runs) {
        let historical: Awaited<ReturnType<typeof loadTask>>
        try {
          historical = await loadTask(
            join(store.projectRoot, '.rolekit', 'runs', runId, 'task.json'),
          )
        } catch (error) {
          throw mapLoaderError(error)
        }
        if (historical.id === candidate.id) {
          throw new WorkItemCliError('recovery_task_reused', { id, run_id: runId })
        }
      }
    } else {
      const latestRunId = item.runs[item.runs.length - 1]
      if (!latestRunId) throw new WorkItemCliError('run_state_inconsistent', { id })
      let baseline: Awaited<ReturnType<typeof loadTask>>
      try {
        baseline = await loadTask(
          join(store.projectRoot, '.rolekit', 'runs', latestRunId, 'task.json'),
        )
      } catch (error) {
        throw mapLoaderError(error)
      }
      if (
        candidate.id === baseline.id &&
        sha256Canonical(candidate) === sha256Canonical(baseline)
      ) {
        throw new WorkItemCliError('question_unanswered', {
          id,
          run_id: latestRunId,
          next_action: `rolekit workitem start ${id} --task <revised-task>`,
        })
      }
    }
  }

  const expectedDispatchRevision = revision

  // New run / first / retry: load policy outside lock for D5/lane
  let policy: GatePolicy
  try {
    policy = await loadGatePolicy(store.projectRoot)
  } catch (error) {
    throw mapLoaderError(error)
  }

  // Short lock: D5 + lane + maybe direct write / cache effects
  type Deferred = {
    expectedRevision: string
    item: WorkItem
    lane: Lane
    lane_reason: string
    override?: WorkItem['lane_overrides'][number]
  }

  const locked = await store.withLock(
    async (): Promise<
      | { kind: 'early'; item: WorkItem; exitCode: number; error?: string }
      | { kind: 'continue'; deferred: Deferred }
    > => {
      const cur = await store.read(id)
      if (cur.revision !== expectedDispatchRevision) {
        throw new WorkItemCliError('workitem_changed', { id })
      }
      item = cur.item
      revision = cur.revision

      if (item.status === 'designing') {
        if (!hasResolvedDesignArtifact(item)) {
          const evaluation = evaluate([{ trigger: 'design-artifact' }], policy)
          const after = applyProcessGateAction(item, 'design-artifact', evaluation.overall)
          if (after.status === 'awaiting-gate') {
            await store.write(after, revision)
            return { kind: 'early', item: after, exitCode: 0 }
          }
          if (after.status === 'blocked') {
            await store.write(after, revision)
            return { kind: 'early', item: after, exitCode: 1, error: 'workitem_blocked' }
          }
          item = after
        }
      }

      if (item.status !== 'planned' && item.status !== 'designing' && item.status !== 'executing') {
        throw new WorkItemCliError('invalid_transition', { id, detail: item.status })
      }

      let lane: Lane
      let lane_reason: string
      let override: WorkItem['lane_overrides'][number] | undefined

      if (retry) {
        lane = (item.lane ?? 'delegated') as Lane
        lane_reason = item.lane_reason ?? 'retry'
        if (flags.laneOverride) {
          if (flags.laneOverride === 'direct') {
            throw new WorkItemCliError('invalid_lane_override', { id })
          }
          if (flags.laneOverride !== lane) {
            override = {
              by: 'cli',
              from: lane,
              to: flags.laneOverride,
              reason: 'manual',
              ts: new Date().toISOString(),
            }
            lane = flags.laneOverride
            lane_reason = 'manual override'
          }
        }
      } else {
        const decision = selectLane(item, policy, {
          estimated_files: flags.estimated_files,
          cross_module: flags.cross_module,
          migration: flags.migration,
          context_already_loaded: flags.context_already_loaded,
        })
        lane = decision.lane
        lane_reason = decision.reason
        if (flags.laneOverride && flags.laneOverride !== lane) {
          override = {
            by: 'cli',
            from: lane,
            to: flags.laneOverride,
            reason: 'manual',
            ts: new Date().toISOString(),
          }
          lane = flags.laneOverride
          lane_reason = 'manual override'
        }
      }

      if (lane === 'direct') {
        if (retry || recovery) {
          throw new WorkItemCliError('invalid_lane_override', {
            id,
            detail: recovery ? 'direct recovery' : 'direct retry',
          })
        }
        const now = new Date().toISOString()
        const base =
          item.status === 'executing'
            ? { ...item, updated: now }
            : transition(item, 'executing', { now })
        const next: WorkItem = {
          ...base,
          lane,
          lane_reason,
          lane_overrides: override ? [...base.lane_overrides, override] : base.lane_overrides,
          gate: null,
          updated: now,
        }
        await store.write(next, revision)
        return { kind: 'early', item: next, exitCode: 0 }
      }

      return {
        kind: 'continue',
        deferred: {
          expectedRevision: revision,
          item: {
            ...item,
            lane,
            lane_reason,
            lane_overrides: override ? [...item.lane_overrides, override] : item.lane_overrides,
          },
          lane,
          lane_reason,
          override,
        },
      }
    },
  )

  if (locked.kind === 'early') {
    return {
      item: locked.item,
      exitCode: locked.exitCode,
      ...(locked.error ? { error: locked.error } : {}),
    }
  }
  const deferred = locked.deferred
  const hadHistoricalRuns = deferred.item.runs.length > 0

  // Lock-out: loadRunInput + prepare
  if (!flags.taskPath) {
    throw new WorkItemCliError(recovery ? 'recovery_task_required' : 'task_required', {
      id,
      detail: 'delegated/coordinated requires --task',
      exitCode: 1,
    })
  }

  let loaded: Awaited<ReturnType<typeof loadRunInput>>
  try {
    loaded = await loadRunInput(resolve(flags.taskPath), {
      policy,
      projectRoot: store.projectRoot,
    })
  } catch (error) {
    throw mapLoaderError(error)
  }

  if (retry) {
    const latestRunId = deferred.item.runs[deferred.item.runs.length - 1]
    if (latestRunId) {
      const prev = await rm.collect(latestRunId)
      if (loaded.task.id !== prev.task_id) {
        throw new WorkItemCliError('retry_task_mismatch', {
          id,
          detail: `${loaded.task.id} != ${prev.task_id}`,
        })
      }
    }
  }

  let handle: { run_id: string }
  try {
    handle = await rm.prepare({ ...loaded, retry })
  } catch (error) {
    throw mapLoaderError(error)
  }

  // Re-lock: attach + write lane/override/run-id
  const linked = await store.withLock(async () => {
    const cur = await store.read(id)
    if (cur.item.runs.includes(handle.run_id)) {
      return { item: cur.item, revision: cur.revision, run_id: handle.run_id }
    }
    if (cur.revision !== deferred.expectedRevision) {
      // concurrent change — abort prepared if we don't own the run
      if (!cur.item.runs.includes(handle.run_id)) {
        try {
          await rm.abortPrepared(handle.run_id)
        } catch (error) {
          if (error instanceof RunManagerError && error.code === 'prepared_abort_failed') {
            throw new WorkItemCliError('prepared_abort_failed', { id, run_id: handle.run_id })
          }
          throw new WorkItemCliError('workitem_changed', { id, run_id: handle.run_id })
        }
        throw new WorkItemCliError('workitem_changed', { id, run_id: handle.run_id })
      }
    }

    const mode = retry || (recovery && cur.item.runs.length > 0) ? 'retry' : 'first'
    let next: WorkItem
    try {
      let attachBase: WorkItem = {
        ...cur.item,
        gate_log: deferred.item.gate_log,
        lane: deferred.lane,
        lane_reason: deferred.lane_reason,
        lane_overrides: deferred.item.lane_overrides,
      }
      if (
        recovery &&
        attachBase.runs.length > 0 &&
        (attachBase.status === 'planned' || attachBase.status === 'designing')
      ) {
        attachBase = transition(attachBase, 'executing')
      }
      next = attachRun(attachBase, handle.run_id, mode)
    } catch (error) {
      if (error instanceof InvalidTransition) {
        throw new WorkItemCliError('invalid_transition', { id, detail: error.message })
      }
      throw error
    }
    const written = await store.write(next, cur.revision)
    return {
      item: written.item,
      revision: written.revision,
      run_id: handle.run_id,
      linkedRevision: written.revision,
    }
  })

  // Mirror override audit then startPrepared (D8: only when historical runs existed)
  const latestOverride = linked.item.lane_overrides[linked.item.lane_overrides.length - 1]
  if (latestOverride && hadHistoricalRuns) {
    try {
      await rm.ensureAuditEvent(
        linked.run_id,
        {
          schema: 'rolekit/run-event@1',
          type: 'gate',
          ts: latestOverride.ts,
          run_id: linked.run_id,
          payload: {
            gate: 'lane-override',
            action: 'observe',
            decision: 'auto-pass',
            evidence: `workitem:${linked.item.id}`,
          },
        },
        `${linked.item.id}:${latestOverride.ts}`,
      )
    } catch (error) {
      if (error instanceof RunManagerError && error.code === 'run_audit_failed') {
        throw new WorkItemCliError('run_audit_failed', { id, run_id: linked.run_id })
      }
      // phase may already be past prepared on recovery; ignore invalid_transition for non-override
      if (!(error instanceof RunManagerError && error.code === 'invalid_transition')) {
        throw error
      }
    }
  }

  try {
    await rm.startPrepared(linked.run_id)
  } catch (error) {
    if (error instanceof RunManagerError) {
      // control path may have written terminal result
      try {
        const envelope = await rm.collect(linked.run_id)
        return adoptAndReturn(store, linked.item, linked.revision, linked.run_id, envelope)
      } catch {
        throw new WorkItemCliError(error.code, { id, run_id: linked.run_id, detail: error.message })
      }
    }
    throw error
  }

  const settled = await rm.waitUntilSettled(linked.run_id)
  if (settled.state === 'awaiting-gate') {
    return {
      item: linked.item,
      run_id: linked.run_id,
      exitCode: 1,
      error: 'run_awaiting_gate',
      next_action: `rolekit gate list ${linked.run_id}`,
    }
  }

  const envelope = await rm.collect(linked.run_id)
  return adoptAndReturn(store, linked.item, linked.revision, linked.run_id, envelope)
}

async function handleExistingRun(
  store: WorkItemStore,
  rm: RunManager,
  stored: StoredWorkItem,
  status: ManagedRunStatus,
  flags: StartFlags,
): Promise<StartResult | null> {
  const { item, revision } = stored
  const runId = status.id
  const phase = status.phase

  if (phase === 'preparing') {
    throw new WorkItemCliError('run_state_inconsistent', { id: item.id, run_id: runId })
  }

  if (phase === 'prepared' || phase === 'starting') {
    const latestOverride = item.lane_overrides[item.lane_overrides.length - 1]
    if (latestOverride) {
      await rm.ensureAuditEvent(
        runId,
        {
          schema: 'rolekit/run-event@1',
          type: 'gate',
          ts: latestOverride.ts,
          run_id: runId,
          payload: {
            gate: 'lane-override',
            action: 'observe',
            decision: 'auto-pass',
            evidence: `workitem:${item.id}`,
          },
        },
        `${item.id}:${latestOverride.ts}`,
      )
    }
    await rm.startPrepared(runId)
    const settled = await rm.waitUntilSettled(runId)
    if (settled.state === 'awaiting-gate') {
      return {
        item,
        run_id: runId,
        exitCode: 1,
        error: 'run_awaiting_gate',
        next_action: `rolekit gate list ${runId}`,
      }
    }
    const envelope = await rm.collect(runId)
    return adoptAndReturn(store, item, revision, runId, envelope)
  }

  if (
    phase === 'active' ||
    phase === 'finalizing' ||
    phase === 'cancelling' ||
    phase === 'resuming'
  ) {
    const settled = await rm.waitUntilSettled(runId)
    if (settled.state === 'awaiting-gate') {
      return {
        item,
        run_id: runId,
        exitCode: 1,
        error: 'run_awaiting_gate',
        next_action: `rolekit gate list ${runId}`,
      }
    }
    const envelope = await rm.collect(runId)
    return adoptAndReturn(store, item, revision, runId, envelope)
  }

  if (phase === 'gate-pending') {
    return {
      item,
      run_id: runId,
      exitCode: 1,
      error: 'run_awaiting_gate',
      next_action: `rolekit gate list ${runId}`,
    }
  }

  if (phase === 'terminal') {
    const envelope = await rm.collect(runId)
    if (envelope.status === 'completed' || envelope.status === 'blocked') {
      return adoptAndReturn(store, item, revision, runId, envelope)
    }
    if (envelope.status === 'question') {
      const adopted = await adoptAndReturn(store, item, revision, runId, envelope)
      if (flags.taskPath && adopted.item.status === 'executing') return null
      return adopted
    }
    // failed|cancelled → fall through to retry new-run if task provided
    if (!flags.taskPath) {
      throw new WorkItemCliError('retry_task_required', { id: item.id, run_id: runId })
    }
    return null
  }

  return null
}

async function adoptAndReturn(
  store: WorkItemStore,
  item: WorkItem,
  linkedRevision: string,
  runId: string,
  envelope: Awaited<ReturnType<RunManager['collect']>>,
): Promise<StartResult> {
  let questionAction: GateAction | undefined
  if (envelope.status === 'question') {
    try {
      questionAction = evaluate(
        [{ trigger: 'ambiguous-requirement' }],
        await loadGatePolicy(store.projectRoot),
      ).overall
    } catch (error) {
      throw mapLoaderError(error)
    }
  }
  return store.withLock(async () => {
    const cur = await store.read(item.id)
    const latest = cur.item.runs[cur.item.runs.length - 1]
    if (latest !== runId) {
      throw new WorkItemCliError('workitem_changed', { id: item.id, run_id: runId })
    }

    const failCode =
      envelope.status === 'cancelled'
        ? 'run_cancelled'
        : envelope.status === 'question'
          ? 'run_question'
          : envelope.status === 'failed'
            ? 'run_failed'
            : envelope.status === 'blocked'
              ? 'run_blocked'
              : 'run_completed'

    // D2(e): revision drifted — only no-op inside evidence closure
    if (cur.revision !== linkedRevision) {
      if (envelope.status === 'completed') {
        if (
          cur.item.status === 'verifying' ||
          cur.item.status === 'awaiting-gate' ||
          cur.item.status === 'done' ||
          cur.item.status === 'blocked'
        ) {
          return { item: cur.item, run_id: runId, no_op: true, exitCode: 0 }
        }
      } else if (envelope.status === 'blocked' && cur.item.status === 'blocked') {
        return {
          item: cur.item,
          run_id: runId,
          no_op: true,
          exitCode: 1,
          error: 'run_blocked',
        }
      } else if (envelope.status === 'question' && questionAction) {
        try {
          const adopted = applyQuestionGateAction(cur.item, runId, questionAction)
          return questionStartResult(adopted.item, runId, true)
        } catch (error) {
          if (error instanceof InvalidTransition) {
            throw new WorkItemCliError('workitem_changed', {
              id: item.id,
              run_id: runId,
              detail: error.message,
            })
          }
          throw error
        }
      } else if (
        (envelope.status === 'failed' || envelope.status === 'cancelled') &&
        cur.item.status === 'executing'
      ) {
        return {
          item: cur.item,
          run_id: runId,
          no_op: true,
          exitCode: 1,
          error: failCode,
        }
      }
      throw new WorkItemCliError('workitem_changed', { id: item.id, run_id: runId })
    }

    try {
      const adopted =
        envelope.status === 'question' && questionAction
          ? applyQuestionGateAction(cur.item, runId, questionAction)
          : adoptRunResult(cur.item, runId, envelope)
      if (!adopted.no_op) {
        await store.write(adopted.item, cur.revision)
      }
      if (envelope.status === 'question') {
        return questionStartResult(adopted.item, runId, adopted.no_op)
      }
      const code = adopted.code
      if (code === 'run_completed') {
        return {
          item: adopted.item,
          run_id: runId,
          no_op: adopted.no_op,
          exitCode: 0,
        }
      }
      if (code === 'run_blocked') {
        return {
          item: adopted.item,
          run_id: runId,
          no_op: adopted.no_op,
          exitCode: 1,
          error: 'run_blocked',
        }
      }
      if (code === 'run_failed' || code === 'run_cancelled' || code === 'run_question') {
        return {
          item: adopted.item,
          run_id: runId,
          no_op: adopted.no_op,
          exitCode: 1,
          error: code,
        }
      }
      return { item: adopted.item, run_id: runId, no_op: adopted.no_op, exitCode: 0 }
    } catch (error) {
      if (error instanceof InvalidTransition) {
        if (
          envelope.status !== 'question' &&
          (cur.item.status === 'verifying' ||
            cur.item.status === 'awaiting-gate' ||
            cur.item.status === 'done' ||
            cur.item.status === 'blocked')
        ) {
          return { item: cur.item, run_id: runId, no_op: true, exitCode: 0 }
        }
        throw new WorkItemCliError('workitem_changed', { id: item.id, detail: error.message })
      }
      throw error
    }
  })
}

function questionStartResult(item: WorkItem, runId: string, noOp: boolean): StartResult {
  if (item.status === 'awaiting-gate') {
    return {
      item,
      run_id: runId,
      no_op: noOp,
      exitCode: 1,
      error: 'workitem_awaiting_gate',
      next_action: `rolekit gate list ${item.id}`,
    }
  }
  if (item.status === 'blocked') {
    return {
      item,
      run_id: runId,
      no_op: noOp,
      exitCode: 1,
      error: 'run_blocked',
      next_action: `rolekit workitem resume ${item.id} --to executing`,
    }
  }
  return {
    item,
    run_id: runId,
    no_op: noOp,
    exitCode: 1,
    error: 'run_question',
    next_action: `rolekit workitem start ${item.id} --task <revised-task>`,
  }
}

function mapLoaderError(error: unknown): WorkItemCliError {
  if (error instanceof WorkItemCliError) return error
  if (error instanceof UnknownAdapterError) {
    return new WorkItemCliError('unknown_adapter', { detail: error.message })
  }
  if (error instanceof RolekitError) {
    return new WorkItemCliError(error.code, { detail: error.message })
  }
  if (error instanceof RunManagerError) {
    return new WorkItemCliError(error.code, { detail: error.message })
  }
  return new WorkItemCliError('internal_error', {
    detail: error instanceof Error ? error.message : String(error),
  })
}

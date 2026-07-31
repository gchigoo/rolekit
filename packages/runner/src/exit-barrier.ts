import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExecutorReport } from '@rolekit/core'
import { canonicalize, sha256Buffer, sha256Text } from './canonical-json.ts'
import { RunManagerError } from './errors.ts'
import { readJsonIfExists, runDir, writeTextAtomic } from './fs-util.ts'
import { withLock } from './lock.ts'
import { readRunState, writeRunStateUnlockedAt } from './run-state-store.ts'
import {
  acceptedSteeringEventAt,
  listSteeringControlsAt,
  type SteeringControl,
  writeSteeringControlAt,
} from './steering-coordinator.ts'
import type { BarrierResolution, ExitTransitionIntent, RunState } from './types.ts'

export type CancelIntent = NonNullable<ExitTransitionIntent['cancel_intent']>

/** Creates the report-side active exit barrier. It is not the report commit point. */
export async function requestFinalizingTransition(
  projectRoot: string,
  runId: string,
): Promise<'created' | 'existing' | 'termination-won'> {
  const dir = runDir(projectRoot, runId)
  return withLock(join(dir, '.lock'), async () => {
    const state = await requiredState(projectRoot, runId)
    const intent = state.transition_intent
    if (intent?.to === 'cancelling') return 'termination-won'
    if (intent?.to === 'finalizing') return 'existing'
    if (state.phase !== 'active') {
      throw new RunManagerError('run_state_inconsistent', `finalizing barrier from ${state.phase}`)
    }
    await writeRunStateUnlockedAt(dir, {
      ...state,
      transition_intent: await newIntent(dir, runId, 'finalizing', null),
    })
    return 'created'
  })
}

/** D3a termination CAS. A durable report wins; finalizing/pending without one may be rewritten once. */
export async function requestCancellingTransition(
  projectRoot: string,
  runId: string,
  cancelIntent: CancelIntent,
): Promise<'created' | 'existing' | 'report-won' | 'conflict'> {
  const dir = runDir(projectRoot, runId)
  return withLock(join(dir, '.lock'), async () => {
    const state = await requiredState(projectRoot, runId)
    const report = await readJsonIfExists(join(dir, 'artifacts', 'executor-report.json'))
    const intent = state.transition_intent
    if (report || (intent?.to === 'finalizing' && intent.state !== 'pending')) return 'report-won'
    if (intent?.to === 'cancelling') {
      return sameCancel(intent.cancel_intent, cancelIntent) ? 'existing' : 'conflict'
    }
    if (state.phase !== 'active') return 'report-won'

    if (intent?.to === 'finalizing') {
      await writeRunStateUnlockedAt(dir, {
        ...state,
        transition_intent: {
          ...intent,
          to: 'cancelling',
          state: 'pending',
          resolutions_sha256: null,
          target_commit_sha256: null,
          cancel_intent: cancelIntent,
          committed_at: null,
        },
      })
      return 'created'
    }

    await writeRunStateUnlockedAt(dir, {
      ...state,
      transition_intent: await newIntent(dir, runId, 'cancelling', cancelIntent),
    })
    return 'created'
  })
}

/** Commits an immutable executor report only while the report-side barrier still owns the race. */
export async function commitExecutorReportForBarrier(
  projectRoot: string,
  runId: string,
  report: ExecutorReport,
): Promise<boolean> {
  const dir = runDir(projectRoot, runId)
  return withLock(join(dir, '.lock'), async () => {
    const state = await requiredState(projectRoot, runId)
    const intent = state.transition_intent
    if (state.phase !== 'active' || intent?.to !== 'finalizing' || intent.state !== 'pending') {
      return false
    }
    const path = join(dir, 'artifacts', 'executor-report.json')
    const bytes = `${JSON.stringify(report, null, 2)}\n`
    try {
      const existing = await readFile(path)
      if (!existing.equals(Buffer.from(bytes, 'utf8'))) {
        throw new RunManagerError('run_state_inconsistent', 'executor report conflict')
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeTextAtomic(path, bytes)
    return true
  })
}

/**
 * Repairs event→control residue and closes queued/inflight controls captured by the barrier.
 * Inflight controls remain open only when closeInflight=false and the original sender is live.
 */
export async function closeBarrierSteering(
  projectRoot: string,
  runId: string,
  options: {
    closeInflight: boolean
    inflightError: Extract<SteeringControl, { state: 'failed' }>['error_code']
  },
): Promise<void> {
  const dir = runDir(projectRoot, runId)
  await withLock(join(dir, '.lock'), async () => {
    const state = await requiredState(projectRoot, runId)
    const intent = state.transition_intent
    if (state.phase !== 'active' || !intent || intent.state !== 'pending') return
    const controls = new Map(
      (await listSteeringControlsAt(dir)).map((item) => [item.request_id, item]),
    )
    for (const requestId of intent.steer_request_ids) {
      const control = controls.get(requestId)
      if (!control) {
        throw new RunManagerError('run_state_inconsistent', `missing steering control ${requestId}`)
      }
      if (control.state !== 'pending') continue
      const acceptedAt = await acceptedSteeringEventAt(dir, control)
      if (acceptedAt) {
        await writeSteeringControlAt(dir, {
          version: 1,
          request_id: control.request_id,
          message: control.message,
          message_sha256: control.message_sha256,
          state: 'accepted',
          requested_at: control.requested_at,
          resolved_at: acceptedAt,
        })
        continue
      }
      if (control.dispatch === 'inflight' && !options.closeInflight) continue
      await writeSteeringControlAt(
        dir,
        failedControl(
          control,
          control.dispatch === 'queued' ? 'run_not_steerable' : options.inflightError,
        ),
      )
    }
  })
}

/** Persists the digest-closed ready checkpoint. */
export async function markExitBarrierReady(
  projectRoot: string,
  runId: string,
  options: { executorStopped?: boolean } = {},
): Promise<'ready' | 'already-ready'> {
  const dir = runDir(projectRoot, runId)
  return withLock(join(dir, '.lock'), async () => {
    const state = await requiredState(projectRoot, runId)
    const intent = state.transition_intent
    if (!intent) throw new RunManagerError('run_state_inconsistent', 'missing exit barrier')
    if (intent.state === 'ready' || intent.state === 'committed') return 'already-ready'
    if (state.phase !== 'active') {
      throw new RunManagerError('run_state_inconsistent', 'pending barrier outside active')
    }
    if (intent.to === 'cancelling' && options.executorStopped !== true) {
      throw new RunManagerError('run_state_inconsistent', 'executor still live at cancelling ready')
    }

    const controls = new Map(
      (await listSteeringControlsAt(dir)).map((item) => [item.request_id, item]),
    )
    const resolutions: BarrierResolution[] = intent.steer_request_ids.map((requestId) => {
      const control = controls.get(requestId)
      if (!control || control.state === 'pending') {
        throw new RunManagerError(
          'run_state_inconsistent',
          `pending steering at ready ${requestId}`,
        )
      }
      return {
        request_id: requestId,
        state: control.state,
        error_code: control.state === 'accepted' ? null : control.error_code,
        message_sha256: control.message_sha256,
      }
    })
    const reportPath = join(dir, 'artifacts', 'executor-report.json')
    let targetCommit: string | null = null
    if (intent.to === 'finalizing') {
      try {
        targetCommit = sha256Buffer(await readFile(reportPath))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new RunManagerError('run_state_inconsistent', 'finalizing ready without report')
        }
        throw error
      }
    }
    await writeRunStateUnlockedAt(dir, {
      ...state,
      transition_intent: {
        ...intent,
        state: 'ready',
        resolutions_sha256: sha256Text(canonicalize(resolutions)),
        target_commit_sha256: targetCommit,
        committed_at: null,
      },
    })
    return 'ready'
  })
}

/** Atomically projects the ready barrier into its target phase. */
export async function commitExitBarrier(projectRoot: string, runId: string): Promise<void> {
  const dir = runDir(projectRoot, runId)
  await withLock(join(dir, '.lock'), async () => {
    const state = await requiredState(projectRoot, runId)
    const intent = state.transition_intent
    if (!intent) throw new RunManagerError('run_state_inconsistent', 'missing exit barrier')
    if (intent.state === 'committed') {
      if (state.phase !== intent.to) {
        throw new RunManagerError('run_state_inconsistent', 'committed barrier phase mismatch')
      }
      return
    }
    if (state.phase !== 'active' || intent.state !== 'ready') {
      throw new RunManagerError('run_state_inconsistent', 'exit barrier is not ready')
    }
    const committedAt = new Date().toISOString()
    await writeRunStateUnlockedAt(dir, {
      ...state,
      phase: intent.to,
      termination_intent:
        intent.to === 'cancelling' && intent.cancel_intent
          ? { status: intent.cancel_intent.status, reason: intent.cancel_intent.reason }
          : state.termination_intent,
      transition_intent: { ...intent, state: 'committed', committed_at: committedAt },
    })
  })
}

async function newIntent(
  dir: string,
  runId: string,
  to: ExitTransitionIntent['to'],
  cancelIntent: ExitTransitionIntent['cancel_intent'],
): Promise<ExitTransitionIntent> {
  const requestedAt = new Date().toISOString()
  const ids = (await listSteeringControlsAt(dir))
    .filter((control) => control.state === 'pending')
    .map((control) => control.request_id)
    .sort()
  return {
    barrier_id: `exit-${createHash('sha256').update(`${runId}\0${requestedAt}`, 'utf8').digest('hex').slice(0, 24)}`,
    from: 'active',
    to,
    state: 'pending',
    requested_at: requestedAt,
    steer_request_ids: ids,
    resolutions_sha256: null,
    target_commit_sha256: null,
    cancel_intent: cancelIntent,
    committed_at: null,
  }
}

function failedControl(
  control: Extract<SteeringControl, { state: 'pending' }>,
  errorCode: Extract<SteeringControl, { state: 'failed' }>['error_code'],
): Extract<SteeringControl, { state: 'failed' }> {
  return {
    version: 1,
    request_id: control.request_id,
    message: control.message,
    message_sha256: control.message_sha256,
    state: 'failed',
    requested_at: control.requested_at,
    resolved_at: new Date().toISOString(),
    error_code: errorCode,
  }
}

async function requiredState(projectRoot: string, runId: string): Promise<RunState> {
  const state = await readRunState(projectRoot, runId)
  if (!state) throw new RunManagerError('run_not_found', runId)
  return state
}

function sameCancel(left: CancelIntent | null, right: CancelIntent): boolean {
  return left?.status === right.status && left.reason === right.reason
}

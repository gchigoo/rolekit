import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ExecutorReport } from '@rolekit/core'
import type { ExecutorAdapter } from './adapter.ts'
import { canonicalize } from './canonical-json.ts'
import {
  ExecutorIncompatibleError,
  ExecutorLostError,
  ExecutorStartError,
  ExecutorTimeoutError,
} from './errors.ts'
import {
  closeBarrierSteering,
  commitExecutorReportForBarrier,
  commitExitBarrier,
  markExitBarrierReady,
  requestCancellingTransition,
  requestFinalizingTransition,
} from './exit-barrier.ts'
import { readJsonIfExists, runDir, writeJsonAtomic, writeTextAtomic } from './fs-util.ts'
import { loadPiCompatRange, loadSnapshots } from './loaders.ts'
import { acquireLock } from './lock.ts'
import { captureProcessIdentity } from './process-identity.ts'
import { createAdapter } from './registry.ts'
import { readRunState, updateRunState } from './run-state-store.ts'
import { type DispatchResult, dispatchNextSteering } from './steering-coordinator.ts'
import type { ExecutorControl, RunContext } from './types.ts'

/**
 * RunSupervisor process body: owns adapter/stdio until awaiting|finished.
 */
export async function runSupervisorMain(projectRoot: string, runId: string): Promise<void> {
  const dir = runDir(projectRoot, runId)
  const lock = await acquireLock(join(dir, '.supervisor.lock'), { retries: 100, delayMs: 50 })
  try {
    let state = await readRunState(projectRoot, runId)
    if (!state) {
      return
    }

    const snapshots = await loadSnapshots(dir)
    const compat = state.adapter === 'pi-rpc' ? await loadPiCompatRange(projectRoot) : undefined
    const adapter = createAdapter(state.adapter, {
      projectRoot,
      compatRange: compat,
      settings: {
        ...(snapshots.executor_profile.settings as Record<string, unknown> | undefined),
        ...(typeof snapshots.executor_profile.model === 'string'
          ? { model: snapshots.executor_profile.model }
          : {}),
      },
    })

    const ctx: RunContext = {
      worktreePath: state.worktree_path,
      runDir: dir,
      attempt: state.attempt,
      profile: snapshots.profile_bundle.profile,
      policy: snapshots.policy,
      supervisorOwnsTerminal: true,
    }

    const controlPath = join(dir, 'artifacts', 'executor-control.json')
    let control = await readJsonIfExists<ExecutorControl>(controlPath)
    if (!control) {
      await updateRunState(projectRoot, runId, async (s) => ({
        ...s,
        phase: 'cancelling',
        termination_intent: { status: 'failed', reason: 'supervisor-start' },
      }))
      return
    }

    const supervisorIdentity = await captureProcessIdentity(process.pid, process.argv)
    await writeTextAtomic(
      join(dir, 'artifacts', 'supervisor.json'),
      canonicalize({
        run_id: runId,
        executor_control_token: control.token,
        instance_id: randomUUID(),
        ...supervisorIdentity,
        acked_at: new Date().toISOString(),
      }),
    )

    // start adapter if no started receipt
    if (!control.started && (state.phase === 'starting' || state.phase === 'prepared')) {
      const deadlineMs = state.deadline_at
        ? Date.parse(state.deadline_at) - Date.now()
        : snapshots.task.execution.timeout_minutes * 60_000

      try {
        const handle = await Promise.race([
          adapter.start(snapshots.task, ctx),
          sleepReject(Math.max(deadlineMs, 1), 'deadline'),
        ])
        control = {
          ...control,
          started: {
            pid: handle.pid ?? process.pid,
            at: new Date().toISOString(),
            ...(handle.process_identity
              ? {
                  start_time_utc: handle.process_identity.start_time_utc,
                  command_sha256: handle.process_identity.command_sha256,
                }
              : {}),
          },
        }
        await writeJsonAtomic(controlPath, control)
        await updateRunState(projectRoot, runId, async (s) => ({
          ...s,
          phase: 'active',
        }))
      } catch (error) {
        const reason =
          error instanceof ExecutorTimeoutError ||
          (error instanceof Error && error.message === 'deadline')
            ? 'timeout'
            : error instanceof ExecutorIncompatibleError
              ? 'executor-incompatible'
              : error instanceof ExecutorStartError
                ? 'executor-start'
                : 'lost'
        await updateRunState(projectRoot, runId, async (s) => ({
          ...s,
          phase: 'cancelling',
          termination_intent: {
            status: reason === 'timeout' ? 'failed' : 'failed',
            reason,
          },
        }))
        await adapter.cancel(runId).catch(() => undefined)
        await writeEmptyReport(dir, snapshots.task.id, reason)
        return
      }
    } else if (state.phase === 'starting') {
      await updateRunState(projectRoot, runId, async (s) => ({ ...s, phase: 'active' }))
    }

    // poll until finished / exit barrier commit. A steer sender may coexist only with abort-safe cancel.
    let steeringTask: SteeringTask | null = null
    for (;;) {
      const currentState = await readRunState(projectRoot, runId)
      if (!currentState) break
      state = currentState
      if (state.phase === 'terminal' || state.phase === 'gate-pending') break
      if (state.phase === 'finalizing' || state.phase === 'cancelling') break

      const transition = state.transition_intent
      if (state.phase === 'active' && transition?.to === 'cancelling') {
        // Start stop immediately; never queue an abort RPC behind the inflight steer request.
        const stopTask = adapter.cancel(runId).catch(() => undefined)
        await closeBarrierSteering(projectRoot, runId, {
          closeInflight: false,
          inflightError: 'run_not_steerable',
        })
        await stopTask
        await closeBarrierSteering(projectRoot, runId, {
          closeInflight: true,
          inflightError: 'run_not_steerable',
        })
        await markExitBarrierReady(projectRoot, runId, { executorStopped: true })
        await commitExitBarrier(projectRoot, runId)
        break
      }
      if (state.phase === 'active' && transition?.to === 'finalizing') {
        const existingReport = await readJsonIfExists<ExecutorReport>(
          join(dir, 'artifacts', 'executor-report.json'),
        )
        if (existingReport) {
          await finishReportBarrier(projectRoot, runId, steeringTask)
          break
        }
      }

      if (state.deadline_at && Date.now() > Date.parse(state.deadline_at)) {
        await requestCancellingTransition(projectRoot, runId, {
          status: 'failed',
          reason: 'timeout',
          requested_at: new Date().toISOString(),
        })
        continue
      }

      if (steeringTask?.settled && steeringTask.result?.executorLost) {
        if (
          await finishLostExecutor(projectRoot, runId, snapshots.task.id, adapter, steeringTask)
        ) {
          break
        }
        continue
      }
      if (steeringTask?.settled) steeringTask = null
      if (!steeringTask) steeringTask = beginSteeringDispatch(projectRoot, runId, adapter)

      try {
        const status = await adapter.status(runId)
        if (status.state === 'finished') {
          const winner = await requestFinalizingTransition(projectRoot, runId)
          if (winner === 'termination-won') continue
          await closeBarrierSteering(projectRoot, runId, {
            closeInflight: false,
            inflightError: 'steer_response_timeout',
          })
          await waitForSteeringAtExit(steeringTask, state.deadline_at)
          const report = await adapter.collect(runId)
          if (!(await commitExecutorReportForBarrier(projectRoot, runId, report))) continue
          await finishReportBarrier(projectRoot, runId, steeringTask)
          break
        }
      } catch (error) {
        if (error instanceof ExecutorLostError) {
          if (
            await finishLostExecutor(projectRoot, runId, snapshots.task.id, adapter, steeringTask)
          ) {
            break
          }
          continue
        }
        throw error
      }
      await sleep(100)
    }
  } finally {
    await lock.release()
  }
}

interface SteeringTask {
  settled: boolean
  result: DispatchResult | null
  promise: Promise<void>
}

function beginSteeringDispatch(
  projectRoot: string,
  runId: string,
  adapter: ExecutorAdapter,
): SteeringTask {
  const task: SteeringTask = { settled: false, result: null, promise: Promise.resolve() }
  task.promise = dispatchNextSteering(projectRoot, runId, adapter).then(
    (result) => {
      task.result = result
      task.settled = true
    },
    () => {
      task.result = { dispatched: true, executorLost: true }
      task.settled = true
    },
  )
  return task
}

async function waitForSteeringAtExit(
  task: SteeringTask | null,
  deadlineAt: string | undefined,
): Promise<void> {
  if (!task || task.settled) return
  const remaining = deadlineAt ? Math.max(0, Date.parse(deadlineAt) - Date.now()) : 30_000
  const cap = Math.min(30_000, remaining)
  if (cap === 0) return
  await Promise.race([task.promise, sleep(cap)])
}

async function finishReportBarrier(
  projectRoot: string,
  runId: string,
  steeringTask: SteeringTask | null,
): Promise<void> {
  const state = await readRunState(projectRoot, runId)
  await closeBarrierSteering(projectRoot, runId, {
    closeInflight: false,
    inflightError: 'steer_response_timeout',
  })
  await waitForSteeringAtExit(steeringTask, state?.deadline_at)
  await closeBarrierSteering(projectRoot, runId, {
    closeInflight: true,
    inflightError: 'steer_response_timeout',
  })
  await markExitBarrierReady(projectRoot, runId)
  await commitExitBarrier(projectRoot, runId)
}

async function finishLostExecutor(
  projectRoot: string,
  runId: string,
  taskId: string,
  adapter: ExecutorAdapter,
  steeringTask: SteeringTask | null,
): Promise<boolean> {
  const winner = await requestFinalizingTransition(projectRoot, runId)
  if (winner === 'termination-won') return false
  await adapter.cancel(runId).catch(() => undefined)
  await closeBarrierSteering(projectRoot, runId, {
    closeInflight: true,
    inflightError: 'executor_lost',
  })
  if (!(await commitExecutorReportForBarrier(projectRoot, runId, emptyReport(taskId, 'lost')))) {
    return false
  }
  void steeringTask
  await markExitBarrierReady(projectRoot, runId)
  await commitExitBarrier(projectRoot, runId)
  return true
}

function emptyReport(taskId: string, reason: string): ExecutorReport {
  return {
    schema: 'rolekit/executor-report@1',
    task_id: taskId,
    status: reason === 'cancelled' || reason === 'user-cancel' ? 'cancelled' : 'failed',
    summary: reason,
    changed_files: [],
    decisions: [],
    assumptions: [],
    evidence: [],
    risks: [],
    unresolved: [reason],
    recommended_next_action: 'inspect',
  }
}

async function writeEmptyReport(dir: string, taskId: string, reason: string): Promise<void> {
  await writeJsonAtomic(join(dir, 'artifacts', 'executor-report.json'), emptyReport(taskId, reason))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sleepReject(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new ExecutorTimeoutError(message)), ms)
  })
}

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { ExecutorAdapter } from '../../src/adapter.ts'
import { canonicalize, sha256Text } from '../../src/canonical-json.ts'
import {
  closeBarrierSteering,
  commitExecutorReportForBarrier,
  commitExitBarrier,
  markExitBarrierReady,
  requestCancellingTransition,
  requestFinalizingTransition,
} from '../../src/exit-barrier.ts'
import { RunManager } from '../../src/run-manager.ts'
import { readRunState } from '../../src/run-state-store.ts'
import {
  dispatchNextSteering,
  readSteeringControl,
  SteeringCoordinator,
} from '../../src/steering-coordinator.ts'
import type { RunState } from '../../src/types.ts'

async function fixture(): Promise<{ root: string; runId: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'rolekit-recovery-'))
  const runId = 'run-recovery-test'
  const dir = join(root, '.rolekit', 'runs', runId)
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  const state: RunState = {
    run_id: runId,
    task_id: 'task-recovery',
    attempt: 1,
    adapter: 'mock',
    verifier_mode: 'minimal',
    worktree_path: root,
    state: 'running',
    phase: 'active',
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
    transition_intent: null,
    updated_at: new Date().toISOString(),
  }
  await writeFile(join(dir, 'run-state.json'), JSON.stringify(state), 'utf8')
  await writeFile(
    join(dir, 'artifacts', 'supervisor.json'),
    JSON.stringify({ pid: process.pid, run_id: runId }),
    'utf8',
  )
  await writeFile(join(dir, 'events.jsonl'), '', 'utf8')
  return { root, runId, dir }
}

function adapter(steer: ExecutorAdapter['steer']): ExecutorAdapter {
  return {
    async probe() {
      return { adapter: 'mock', protocol_version: '1', capabilities: ['steer'] }
    },
    async start() {
      throw new Error('not used')
    },
    async status() {
      return { state: 'running', last_event_ts: new Date().toISOString() }
    },
    steer,
    async cancel() {},
    async collect() {
      throw new Error('not used')
    },
  }
}

async function waitForControl(root: string, runId: string, requestId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await readSteeringControl(root, runId, requestId)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('control not created')
}

describe('D3/D3a active exit recovery barrier', () => {
  it('persists pending → ready → committed and closes queued steer', async () => {
    const { root, runId } = await fixture()
    const requestId = 'queued-at-exit'
    const waiting = new SteeringCoordinator(root).request(runId, 'continue', { requestId })
    await waitForControl(root, runId, requestId)

    assert.equal(await requestFinalizingTransition(root, runId), 'created')
    const pending = await readRunState(root, runId)
    assert.equal(pending?.phase, 'active')
    assert.equal(pending?.transition_intent?.state, 'pending')
    assert.deepEqual(pending?.transition_intent?.steer_request_ids, [requestId])

    await closeBarrierSteering(root, runId, {
      closeInflight: true,
      inflightError: 'steer_response_timeout',
    })
    await assert.rejects(waiting, (error: { code?: string }) => error.code === 'run_not_steerable')
    const report = {
      schema: 'rolekit/executor-report@1' as const,
      task_id: 'task-recovery',
      status: 'failed' as const,
      summary: 'lost',
      changed_files: [],
      decisions: [],
      assumptions: [],
      evidence: [],
      risks: [],
      unresolved: ['lost'],
      recommended_next_action: 'retry',
    }
    assert.equal(await commitExecutorReportForBarrier(root, runId, report), true)
    await markExitBarrierReady(root, runId)
    const ready = await readRunState(root, runId)
    assert.equal(ready?.phase, 'active')
    assert.equal(ready?.transition_intent?.state, 'ready')
    assert.equal(
      ready?.transition_intent?.resolutions_sha256,
      sha256Text(
        canonicalize([
          {
            request_id: requestId,
            state: 'failed',
            error_code: 'run_not_steerable',
            message_sha256: sha256Text('continue'),
          },
        ]),
      ),
    )
    await commitExitBarrier(root, runId)
    const committed = await readRunState(root, runId)
    assert.equal(committed?.phase, 'finalizing')
    assert.equal(committed?.transition_intent?.state, 'committed')
  })

  it('cancel CAS rewrites report-pending barrier and late report cannot commit', async () => {
    const { root, runId } = await fixture()
    await requestFinalizingTransition(root, runId)
    const before = await readRunState(root, runId)
    const cancel = {
      status: 'cancelled' as const,
      reason: 'user-cancel' as const,
      requested_at: new Date().toISOString(),
    }
    assert.equal(await requestCancellingTransition(root, runId, cancel), 'created')
    const rewritten = await readRunState(root, runId)
    assert.equal(rewritten?.transition_intent?.barrier_id, before?.transition_intent?.barrier_id)
    assert.equal(
      rewritten?.transition_intent?.requested_at,
      before?.transition_intent?.requested_at,
    )
    assert.equal(
      await commitExecutorReportForBarrier(root, runId, {
        schema: 'rolekit/executor-report@1',
        task_id: 'task-recovery',
        status: 'completed',
        summary: 'late',
        changed_files: [],
        decisions: [],
        assumptions: [],
        evidence: [],
        risks: [],
        unresolved: [],
        recommended_next_action: 'done',
      }),
      false,
    )
    await closeBarrierSteering(root, runId, {
      closeInflight: true,
      inflightError: 'run_not_steerable',
    })
    await markExitBarrierReady(root, runId, { executorStopped: true })
    await commitExitBarrier(root, runId)
    const committed = await readRunState(root, runId)
    assert.equal(committed?.phase, 'cancelling')
    assert.deepEqual(committed?.termination_intent, {
      status: 'cancelled',
      reason: 'user-cancel',
    })
  })

  it('report commit beats a later cancel CAS', async () => {
    const { root, runId } = await fixture()
    await requestFinalizingTransition(root, runId)
    assert.equal(
      await commitExecutorReportForBarrier(root, runId, {
        schema: 'rolekit/executor-report@1',
        task_id: 'task-recovery',
        status: 'failed',
        summary: 'report won',
        changed_files: [],
        decisions: [],
        assumptions: [],
        evidence: [],
        risks: [],
        unresolved: ['report won'],
        recommended_next_action: 'retry',
      }),
      true,
    )
    assert.equal(
      await requestCancellingTransition(root, runId, {
        status: 'cancelled',
        reason: 'user-cancel',
        requested_at: new Date().toISOString(),
      }),
      'report-won',
    )
  })

  it('keeps the first cancel/timeout winner', async () => {
    const { root, runId } = await fixture()
    assert.equal(
      await requestCancellingTransition(root, runId, {
        status: 'cancelled',
        reason: 'user-cancel',
        requested_at: new Date().toISOString(),
      }),
      'created',
    )
    assert.equal(
      await requestCancellingTransition(root, runId, {
        status: 'failed',
        reason: 'timeout',
        requested_at: new Date().toISOString(),
      }),
      'conflict',
    )
    assert.equal(
      (await readRunState(root, runId))?.transition_intent?.cancel_intent?.reason,
      'user-cancel',
    )
  })

  it('owner loss beats an already expired deadline and finalizes exactly once', async () => {
    const { root, runId, dir } = await fixture()
    const state = await readRunState(root, runId)
    assert.ok(state)
    state.deadline_at = new Date(Date.now() - 10_000).toISOString()
    await writeFile(join(dir, 'run-state.json'), JSON.stringify(state), 'utf8')
    await writeFile(
      join(dir, 'artifacts', 'supervisor.json'),
      JSON.stringify({ pid: 2_147_483_000, run_id: runId }),
      'utf8',
    )
    await writeFile(
      join(dir, 'artifacts', 'executor-control.json'),
      JSON.stringify({
        token: 'token',
        intent: 'start',
        started: { pid: process.pid, at: state.started_at },
      }),
      'utf8',
    )
    const manager = new RunManager(root)
    await manager.reconcile(runId)
    await manager.reconcile(runId)
    const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'))
    assert.equal(result.status, 'failed')
    assert.equal(result.summary, 'lost')
    const events = (await readFile(join(dir, 'events.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    assert.equal(events.filter((event) => event.type === 'finished').length, 1)
  })

  it('continues a committed timeout after the owner disappears', async () => {
    const { root, runId, dir } = await fixture()
    await requestCancellingTransition(root, runId, {
      status: 'failed',
      reason: 'timeout',
      requested_at: new Date().toISOString(),
    })
    await closeBarrierSteering(root, runId, {
      closeInflight: true,
      inflightError: 'run_not_steerable',
    })
    await markExitBarrierReady(root, runId, { executorStopped: true })
    await commitExitBarrier(root, runId)
    await writeFile(
      join(dir, 'artifacts', 'supervisor.json'),
      JSON.stringify({ pid: 2_147_483_000, run_id: runId }),
      'utf8',
    )
    const manager = new RunManager(root)
    await manager.reconcile(runId)
    const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'))
    assert.equal(result.status, 'failed')
    assert.equal(result.summary, 'timeout')
  })

  it('recovers accepted event without resending inflight steer', async () => {
    const { root, runId, dir } = await fixture()
    const requestId = 'event-control-gap'
    const waiting = new SteeringCoordinator(root).request(runId, 'continue', { requestId })
    await waitForControl(root, runId, requestId)
    let release!: () => void
    const response = new Promise<void>((resolve) => {
      release = resolve
    })
    let sends = 0
    const dispatch = dispatchNextSteering(
      root,
      runId,
      adapter(async () => {
        sends += 1
        await response
      }),
    )
    for (let i = 0; i < 2_000; i += 1) {
      const control = await readSteeringControl(root, runId, requestId)
      if (control?.state === 'pending' && control.dispatch === 'inflight') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const control = await readSteeringControl(root, runId, requestId)
    assert.ok(control?.state === 'pending' && control.dispatch === 'inflight')
    const resolvedAt = new Date().toISOString()
    await writeFile(
      join(dir, 'events.jsonl'),
      `${JSON.stringify({
        schema: 'rolekit/run-event@1',
        ts: resolvedAt,
        run_id: runId,
        type: 'message',
        payload: {
          role: 'system',
          text: `[steer:accepted] request_id=${requestId} message_sha256=${control.message_sha256}`,
        },
      })}\n`,
      'utf8',
    )
    await requestFinalizingTransition(root, runId)
    await closeBarrierSteering(root, runId, {
      closeInflight: true,
      inflightError: 'executor_lost',
    })
    const accepted = await readSteeringControl(root, runId, requestId)
    assert.equal(accepted?.state, 'accepted')
    assert.equal(sends, 1)
    release()
    await dispatch
    await waiting
    assert.equal(sends, 1)
  })
})

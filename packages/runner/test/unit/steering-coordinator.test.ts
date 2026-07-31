import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { ExecutorAdapter } from '../../src/adapter.ts'
import { canonicalize } from '../../src/canonical-json.ts'
import { ExecutorSteerRejectedError } from '../../src/errors.ts'
import {
  canonicalSteeringMessage,
  deriveSteeringRequestId,
  dispatchNextSteering,
  readSteeringControl,
  SteeringCoordinator,
} from '../../src/steering-coordinator.ts'
import type { RunState } from '../../src/types.ts'

function adapterWithSteer(steer: ExecutorAdapter['steer']): ExecutorAdapter {
  return {
    async probe() {
      return {
        adapter: 'mock',
        protocol_version: '1',
        capabilities: ['start', 'status', 'steer', 'cancel', 'collect'],
      }
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

async function steeringFixture(waitMs = 60_000): Promise<{
  root: string
  runId: string
  dir: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'rolekit-steer-'))
  const runId = 'run-steer-test'
  const dir = join(root, '.rolekit', 'runs', runId)
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  const state: RunState = {
    run_id: runId,
    task_id: 'task-steer',
    attempt: 1,
    adapter: 'mock',
    verifier_mode: 'minimal',
    worktree_path: root,
    state: 'running',
    phase: 'active',
    deadline_at: new Date(Date.now() + waitMs).toISOString(),
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

async function waitForFile(path: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      await readFile(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw new Error(`file not created: ${path}`)
}

describe('SteeringCoordinator durable control', () => {
  it('canonicalizes message/id and dispatches the durable request id exactly once', async () => {
    const { root, runId, dir } = await steeringFixture()
    const coordinator = new SteeringCoordinator(root)
    const message = canonicalSteeringMessage('\u2003continue {"nested":{"ok":true}}\n')
    assert.equal(message, 'continue {"nested":{"ok":true}}')
    const requestId = deriveSteeringRequestId(runId, message)
    const controlPath = join(dir, 'control', 'steer', `${requestId}.json`)

    const waiting = coordinator.request(runId, `\t${message}\n`)
    await waitForFile(controlPath)
    const queuedText = await readFile(controlPath, 'utf8')
    assert.equal(queuedText, canonicalize(JSON.parse(queuedText)))
    assert.equal(JSON.parse(queuedText).dispatch, 'queued')

    let sends = 0
    const dispatched = await dispatchNextSteering(
      root,
      runId,
      adapterWithSteer(async (_id, sentMessage, control) => {
        sends += 1
        assert.equal(sentMessage, message)
        assert.equal(control.requestId, requestId)
        const inflight = JSON.parse(await readFile(controlPath, 'utf8'))
        assert.equal(inflight.dispatch, 'inflight')
      }),
    )
    assert.deepEqual(dispatched, { dispatched: true, executorLost: false })
    const result = await waiting
    assert.equal(result.requestId, requestId)
    assert.equal(result.noOp, false)
    assert.equal(sends, 1)

    const accepted = await readSteeringControl(root, runId, requestId)
    assert.equal(accepted?.state, 'accepted')
    assert.ok(accepted)
    assert.equal('dispatch' in accepted, false)
    const events = await readFile(join(dir, 'events.jsonl'), 'utf8')
    assert.match(events, new RegExp(`request_id=${requestId}`))
    assert.doesNotMatch(events, /nested/)

    const again = await coordinator.request(runId, message)
    assert.equal(again.noOp, true)
    assert.equal(sends, 1)
    await assert.rejects(
      () => coordinator.request(runId, 'different', { requestId }),
      (error: { code?: string }) => error.code === 'steer_request_conflict',
    )
  })

  it('keeps a timed-out wait pending and does not create or send a second request', async () => {
    const { root, runId } = await steeringFixture(-1)
    const coordinator = new SteeringCoordinator(root)
    const requestId = 'caller-request.1'
    await assert.rejects(
      () => coordinator.request(runId, 'continue', { requestId }),
      (error: { code?: string }) => error.code === 'steer_wait_timeout',
    )
    const pending = await readSteeringControl(root, runId, requestId)
    assert.equal(pending?.state, 'pending')
    assert.equal(pending?.state === 'pending' ? pending.dispatch : null, 'queued')
    await assert.rejects(
      () => coordinator.request(runId, 'continue', { requestId }),
      (error: { code?: string }) => error.code === 'steer_wait_timeout',
    )
    assert.equal((await readSteeringControl(root, runId, requestId))?.state, 'pending')

    let sends = 0
    await dispatchNextSteering(
      root,
      runId,
      adapterWithSteer(async () => {
        sends += 1
      }),
    )
    const resumed = await coordinator.request(runId, 'continue', { requestId })
    assert.equal(resumed.noOp, true)
    assert.equal(sends, 1)
  })

  it('persists rejected and lost dispatch failures', async () => {
    for (const scenario of ['rejected', 'lost'] as const) {
      const { root, runId, dir } = await steeringFixture()
      const requestId = `request-${scenario}`
      const waiting = new SteeringCoordinator(root).request(runId, 'continue', { requestId })
      const rejected = assert.rejects(
        waiting,
        (error: { code?: string }) =>
          error.code === (scenario === 'rejected' ? 'steer_rejected' : 'executor_lost'),
      )
      await waitForFile(join(dir, 'control', 'steer', `${requestId}.json`))
      const dispatched = await dispatchNextSteering(
        root,
        runId,
        adapterWithSteer(async () => {
          if (scenario === 'rejected') {
            throw new ExecutorSteerRejectedError('no')
          }
          throw new Error('transport lost')
        }),
      )
      assert.equal(dispatched.executorLost, scenario === 'lost')
      await rejected
      const failed = await readSteeringControl(root, runId, requestId)
      assert.equal(failed?.state, 'failed')
      if (failed?.state === 'failed') {
        assert.equal(
          failed.error_code,
          scenario === 'rejected' ? 'steer_rejected' : 'executor_lost',
        )
        assert.equal('dispatch' in failed, false)
      }
    }
  })

  it('rejects invalid canonical inputs before writing control', async () => {
    const { root, runId } = await steeringFixture()
    const coordinator = new SteeringCoordinator(root)
    for (const message of ['   ', 'a\0b', 'x'.repeat(16 * 1024 + 1)]) {
      await assert.rejects(
        () => coordinator.request(runId, message),
        (error: { code?: string }) => error.code === 'steer_message_invalid',
      )
    }
    await assert.rejects(
      () => coordinator.request(runId, 'ok', { requestId: '../escape' }),
      (error: { code?: string }) => error.code === 'steer_request_conflict',
    )
  })

  it('rejects unknown fields in a canonical control record', async () => {
    const { root, runId, dir } = await steeringFixture()
    const requestId = 'strict-request'
    const controlPath = join(dir, 'control', 'steer', `${requestId}.json`)
    const waiting = new SteeringCoordinator(root).request(runId, 'continue', { requestId })
    await waitForFile(controlPath)
    await dispatchNextSteering(
      root,
      runId,
      adapterWithSteer(async () => undefined),
    )
    await waiting
    const control = JSON.parse(await readFile(controlPath, 'utf8'))
    await writeFile(controlPath, canonicalize({ ...control, unknown: true }), 'utf8')
    await assert.rejects(
      () => readSteeringControl(root, runId, requestId),
      (error: { code?: string }) => error.code === 'run_state_inconsistent',
    )
  })
})

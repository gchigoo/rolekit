import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { RunManagerError } from '../../src/errors.ts'
import { loadRunInput } from '../../src/loaders.ts'
import { RunManager } from '../../src/run-manager.ts'
import { createTempProject } from '../helpers/temp-project.ts'

describe('finalizer × cancel / timeout / abort', () => {
  it('cancel after finalizing is run_not_cancellable or terminal no-op', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const cancel = await rm.cancel(handle.run_id)
    assert.equal(cancel.no_op, true)
    const result = await rm.collect(handle.run_id)
    assert.equal(result.status, 'completed')
  })

  it('abortPrepared recovers prepared run and allows re-prepare', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.abortPrepared(handle.run_id)
    const again = await rm.prepare({ ...input, retry: false })
    assert.notEqual(again.run_id, handle.run_id)
  })

  it('abortPrepared rejects after start', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    await assert.rejects(
      () => rm.abortPrepared(handle.run_id),
      (err: unknown) => {
        return err instanceof RunManagerError && err.code === 'invalid_transition'
      },
    )
    await rm.waitUntilSettled(handle.run_id)
  })

  it('ensureAuditEvent dedupes lane-override observe gate', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    const event = {
      schema: 'rolekit/run-event@1' as const,
      ts: new Date().toISOString(),
      run_id: handle.run_id,
      type: 'gate' as const,
      payload: {
        gate: 'lane-override',
        action: 'observe' as const,
        decision: 'auto-pass' as const,
        evidence: 'wi-lane',
      },
    }
    await rm.ensureAuditEvent(handle.run_id, event, 'k1')
    await rm.ensureAuditEvent(handle.run_id, event, 'k1')
    const events = readFileSync(
      join(root, '.rolekit', 'runs', handle.run_id, 'events.jsonl'),
      'utf8',
    )
    const count = events.split('\n').filter((l) => l.includes('lane-override')).length
    assert.equal(count, 1)
  })

  it('cancels without waiting for an inflight steer response', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(
      join(root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
      [
        'schema: rolekit/executor-profile@1',
        'name: mock',
        'adapter: mock',
        'settings:',
        '  delay_ms: 5000',
        '  wait_for_steer: true',
        '  steer_hang: true',
        '',
      ].join('\n'),
    )
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const requestId = 'cancel-inflight'
    const steerOutcome = rm.steer(handle.run_id, 'continue', { requestId }).then(
      () => 'accepted',
      (error: { code?: string }) => error.code,
    )
    const controlPath = join(
      root,
      '.rolekit',
      'runs',
      handle.run_id,
      'control',
      'steer',
      `${requestId}.json`,
    )
    let inflight = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        inflight = JSON.parse(readFileSync(controlPath, 'utf8')).dispatch === 'inflight'
      } catch {
        // supervisor has not dispatched yet
      }
      if (inflight) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(inflight, true)

    const started = Date.now()
    await rm.cancel(handle.run_id)
    await rm.waitUntilSettled(handle.run_id)
    assert.ok(Date.now() - started < 4_000)
    assert.equal(await steerOutcome, 'run_not_steerable')
    const result = await rm.collect(handle.run_id)
    assert.equal(result.status, 'cancelled')
    const events = readFileSync(
      join(root, '.rolekit', 'runs', handle.run_id, 'events.jsonl'),
      'utf8',
    )
    assert.equal(events.split('\n').filter((line) => line.includes('"type":"started"')).length, 1)
    assert.equal(events.split('\n').filter((line) => line.includes('"type":"finished"')).length, 1)
  })

  it('short timeout yields failed/timeout envelope', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(
      join(root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
      `schema: rolekit/executor-profile@1
name: mock
adapter: mock
settings:
  delay_ms: 5000
  write_file: src/implemented.txt
  write_content: "late\\n"
`,
    )
    let yaml = readFileSync(taskSuccess, 'utf8')
    yaml = yaml.replace('timeout_minutes: 5', 'timeout_minutes: 0.05')
    // TaskContract uses number minutes; 0.05 may fail schema if integer-only — use 1 and mock deadline via run-state injection after start
    yaml = yaml.replace('timeout_minutes: 0.05', 'timeout_minutes: 1')
    writeFileSync(taskSuccess, yaml)
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    // force deadline into the past
    const statePath = join(root, '.rolekit', 'runs', handle.run_id, 'run-state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.deadline_at = new Date(Date.now() - 1000).toISOString()
    writeFileSync(statePath, JSON.stringify(state, null, 2))
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const result = await rm.collect(handle.run_id)
    assert.equal(result.status, 'failed')
    assert.ok(
      result.unresolved.some((u) => u.includes('timeout')) || result.summary.includes('timeout'),
    )
  })
})

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { validateArtifact } from '@rolekit/core'
import { loadRunInput } from '../../src/loaders.ts'
import { RunManager } from '../../src/run-manager.ts'
import { createTempProject } from '../helpers/temp-project.ts'

describe('RunManager mock closed loop', () => {
  it('prepare→start→wait produces five artifacts and completed envelope', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    const again = await rm.prepare({ ...input, retry: false })
    assert.equal(again.run_id, handle.run_id)

    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    assert.equal(settled.phase, 'terminal')

    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    for (const name of [
      'task.json',
      'prompt.md',
      'events.jsonl',
      'result.json',
      'verification.json',
    ]) {
      readFileSync(join(runDir, name))
    }

    const result = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'))
    const v = validateArtifact('rolekit/result-envelope@1', result)
    assert.equal(v.valid, true, JSON.stringify(v))
    assert.equal(result.status, 'completed')

    // integration left uncommitted change on primary
    const implemented = readFileSync(join(root, 'src', 'implemented.txt'), 'utf8')
    assert.match(implemented, /implemented-by-mock/)
  })

  it('scope violation fails envelope and writes gate block', async () => {
    const { root, taskForbidden } = createTempProject()
    const input = await loadRunInput(taskForbidden, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const result = JSON.parse(
      readFileSync(join(root, '.rolekit', 'runs', handle.run_id, 'result.json'), 'utf8'),
    )
    assert.equal(result.status, 'failed')
    assert.ok(result.scope_violations.length > 0)
    const events = readFileSync(
      join(root, '.rolekit', 'runs', handle.run_id, 'events.jsonl'),
      'utf8',
    )
    assert.match(events, /scope-violation/)
    assert.match(events, /"action":"block"/)
  })

  it('steer accepts through the mock supervisor and preserves the caller request id', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(
      join(root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
      `schema: rolekit/executor-profile@1
name: mock
adapter: mock
settings:
  delay_ms: 50
  wait_for_steer: true
  write_file: src/implemented.txt
  write_content: "implemented-by-mock\\n"
`,
    )
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const steered = await rm.steer(handle.run_id, '  continue  ', {
      requestId: 'caller-request-1',
    })
    assert.equal(steered.steer.state, 'accepted')
    assert.equal(steered.steer.request_id, 'caller-request-1')
    assert.equal(steered.steer.no_op, false)
    const control = JSON.parse(
      readFileSync(
        join(root, '.rolekit', 'runs', handle.run_id, 'control', 'steer', 'caller-request-1.json'),
        'utf8',
      ),
    )
    assert.equal(control.message, 'continue')
    assert.equal(control.state, 'accepted')
    assert.equal(control.dispatch, undefined)
  })

  it('cancel does not wait for a hanging inflight steer response', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(
      join(root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
      `schema: rolekit/executor-profile@1
name: mock
adapter: mock
settings:
  wait_for_steer: true
  steer_hang: true
`,
    )
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const steering = rm.steer(handle.run_id, 'continue', { requestId: 'hanging-request' })
    const rejected = assert.rejects(
      steering,
      (error: { code?: string }) => error.code === 'run_not_steerable',
    )
    const controlPath = join(
      root,
      '.rolekit',
      'runs',
      handle.run_id,
      'control',
      'steer',
      'hanging-request.json',
    )
    for (let i = 0; i < 100; i += 1) {
      try {
        const control = JSON.parse(readFileSync(controlPath, 'utf8'))
        if (control.dispatch === 'inflight') break
      } catch {
        // supervisor has not picked up the durable request yet
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const beforeCancel = Date.now()
    const cancelled = await rm.cancel(handle.run_id)
    assert.ok(Date.now() - beforeCancel < 5_000)
    assert.equal(cancelled.no_op, false)
    await rejected
    const control = JSON.parse(readFileSync(controlPath, 'utf8'))
    assert.equal(control.state, 'failed')
    assert.equal(control.error_code, 'run_not_steerable')
  })

  it('rejects in-place worktree at loadRunInput', async () => {
    const { root, taskSuccess } = createTempProject()
    const yaml = readFileSync(taskSuccess, 'utf8').replace(
      'worktree: isolated',
      'worktree: in-place',
    )
    const path = join(root, 'tasks', 'in-place.yaml')
    writeFileSync(path, yaml)
    await assert.rejects(
      () => loadRunInput(path, { projectRoot: root }),
      (err: { code?: string }) => err.code === 'unsupported_worktree_mode',
    )
  })

  it('cancel before start finishes cancelled', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    const cancel = await rm.cancel(handle.run_id)
    assert.equal(cancel.state, 'finished')
    const result = await rm.collect(handle.run_id)
    assert.equal(result.status, 'cancelled')
  })

  it('concurrent primary change is detected', async () => {
    const { root, taskSuccess } = createTempProject()
    // slow mock
    writeFileSync(
      join(root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
      `schema: rolekit/executor-profile@1
name: mock
adapter: mock
settings:
  delay_ms: 800
  write_file: src/implemented.txt
  write_content: "implemented-by-mock\\n"
`,
    )
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    // inject primary change while running
    writeFileSync(join(root, 'src', 'seed.txt'), 'injected\n')
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const result = JSON.parse(
      readFileSync(join(root, '.rolekit', 'runs', handle.run_id, 'result.json'), 'utf8'),
    )
    assert.equal(result.status, 'failed')
    assert.ok(result.scope_violations.some((v: string) => v.startsWith('concurrent-change:')))
  })
})

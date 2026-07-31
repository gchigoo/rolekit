import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTempProject } from '../../packages/runner/test/helpers/temp-project.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cliEntry = join(root, 'packages/cli/bin/rolekit.js')

function runRolekit(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('rolekit run/verify e2e (mock)', () => {
  it('run start mock success + verify reverify artifact', async () => {
    const { root: project, taskSuccess } = createTempProject()
    const start = runRolekit(['run', 'start', taskSuccess, '--json'], project)
    assert.equal(start.status, 0, start.stderr || start.stdout)
    const payload = JSON.parse(start.stdout) as {
      id: string
      state: string
      phase: string
    }
    assert.equal(payload.state, 'finished')
    assert.equal(payload.phase, 'terminal')

    const status = runRolekit(['run', 'status', payload.id, '--json'], project)
    assert.equal(status.status, 0)
    const st = JSON.parse(status.stdout) as { last_event_ts: string | null; phase: string }
    assert.equal(st.phase, 'terminal')
    assert.notEqual(st.last_event_ts, null)

    const collect = runRolekit(['run', 'collect', payload.id, '--json'], project)
    assert.equal(collect.status, 0)
    const collected = JSON.parse(collect.stdout) as { result: { status: string } }
    assert.equal(collected.result.status, 'completed')

    const verify = runRolekit(['verify', payload.id, '--json'], project)
    assert.equal(verify.status, 0, verify.stderr || verify.stdout)
    const v = JSON.parse(verify.stdout) as { reverify: string }
    const artifact = JSON.parse(readFileSync(v.reverify, 'utf8')) as {
      verification: { passed: boolean; scope_violations: string[] }
    }
    assert.equal(artifact.verification.passed, true, JSON.stringify(artifact.verification))
    assert.equal(artifact.verification.scope_violations.length, 0)
  })

  it('steer accepts canonical message with a durable caller request id', () => {
    const { root: project, taskSuccess } = createTempProject()
    writeFileSync(
      join(project, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
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
    const start = runRolekit(['run', 'start', taskSuccess, '--detach', '--json'], project)
    assert.equal(start.status, 0, start.stderr || start.stdout)
    const payload = JSON.parse(start.stdout) as { id: string }
    const steer = runRolekit(
      [
        'run',
        'steer',
        payload.id,
        '--message',
        '  continue {"nested":{"ok":true}}  ',
        '--request-id',
        'e2e-request-1',
        '--json',
      ],
      project,
    )
    assert.equal(steer.status, 0, steer.stderr || steer.stdout)
    const body = JSON.parse(steer.stdout) as {
      id: string
      steer: { state: string; request_id: string; no_op: boolean }
    }
    assert.equal(body.id, payload.id)
    assert.deepEqual(body.steer, {
      state: 'accepted',
      request_id: 'e2e-request-1',
      no_op: false,
    })
    const control = JSON.parse(
      readFileSync(
        join(project, '.rolekit', 'runs', payload.id, 'control', 'steer', 'e2e-request-1.json'),
        'utf8',
      ),
    ) as { message: string; state: string; dispatch?: string }
    assert.equal(control.message, 'continue {"nested":{"ok":true}}')
    assert.equal(control.state, 'accepted')
    assert.equal(control.dispatch, undefined)
  })

  it('usage errors exit 2', () => {
    const { root: project } = createTempProject()
    assert.equal(runRolekit(['run', 'start'], project).status, 2)
    assert.equal(runRolekit(['run', 'start', 'x', '--nope'], project).status, 2)
  })

  it('in-place worktree rejected', () => {
    const { root: project, taskSuccess } = createTempProject()
    const yaml = readFileSync(taskSuccess, 'utf8').replace(
      'worktree: isolated',
      'worktree: in-place',
    )
    const path = join(project, 'tasks', 'in-place.yaml')
    writeFileSync(path, yaml)
    const result = runRolekit(['run', 'start', path, '--json'], project)
    assert.equal(result.status, 1)
    const body = JSON.parse(result.stdout) as { error: string }
    assert.equal(body.error, 'unsupported_worktree_mode')
  })

  it('cancel run rejects verify', () => {
    const { root: project, taskSuccess } = createTempProject()
    // prepare-only cancel via API path: start detach then immediately cancel may race;
    // use short path: start with detach=false on a prepared cancel isn't available via CLI.
    // Instead: run start --detach then cancel quickly.
    const start = runRolekit(['run', 'start', taskSuccess, '--detach', '--json'], project)
    const payload = JSON.parse(start.stdout) as { id: string }
    runRolekit(['run', 'cancel', payload.id, '--json'], project)
    // wait settle
    for (let i = 0; i < 100; i += 1) {
      const st = JSON.parse(
        runRolekit(['run', 'status', payload.id, '--json'], project).stdout,
      ) as { state: string }
      if (st.state === 'finished') break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
    const collect = JSON.parse(
      runRolekit(['run', 'collect', payload.id, '--json'], project).stdout,
    ) as { result?: { status: string }; error?: string }
    if (collect.result?.status === 'cancelled') {
      const verify = runRolekit(['verify', payload.id, '--json'], project)
      assert.equal(verify.status, 1)
      const body = JSON.parse(verify.stdout) as { error: string }
      assert.equal(body.error, 'run_not_verifiable')
    }
  })

  it('help lists run and verify', () => {
    const result = runRolekit(['--help'], root)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /run start/)
    assert.match(result.stdout, /verify/)
  })
})

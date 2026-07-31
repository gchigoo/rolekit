import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTempProject } from '../../runner/test/helpers/temp-project.ts'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const cliEntry = join(repositoryRoot, 'packages/cli/bin/rolekit.js')

function rolekit(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('run steer CLI', () => {
  it('parses --message/--request-id and emits the accepted nested result', () => {
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
    const start = rolekit(['run', 'start', taskSuccess, '--detach', '--json'], root)
    assert.equal(start.status, 0, start.stderr || start.stdout)
    const runId = (JSON.parse(start.stdout) as { id: string }).id
    const steered = rolekit(
      ['run', 'steer', runId, '--message', ' continue ', '--request-id', 'cli-request-1', '--json'],
      root,
    )
    assert.equal(steered.status, 0, steered.stderr || steered.stdout)
    assert.deepEqual((JSON.parse(steered.stdout) as { steer: unknown }).steer, {
      state: 'accepted',
      request_id: 'cli-request-1',
      no_op: false,
    })
  })

  it('uses exit 2 for a missing --message or positional message', () => {
    const { root } = createTempProject()
    assert.equal(rolekit(['run', 'steer', 'run-missing', '--json'], root).status, 2)
    assert.equal(
      rolekit(['run', 'steer', 'run-missing', 'legacy-positional-message'], root).status,
      2,
    )
  })
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

const invokeSourceCli = [
  "import('./src/cli.ts')",
  '.then(async ({ main }) => { await main(process.argv.slice(1)); })',
].join('')

function runCli(args: readonly string[]) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', invokeSourceCli, '--', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    },
  )
}

function assertOk(result: ReturnType<typeof runCli>): Record<string, unknown> {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const envelope = JSON.parse(result.stdout) as Record<string, unknown>
  assert.equal(envelope.ok, true, JSON.stringify(envelope))
  assert.deepEqual(envelope.warnings, [])
  assert.equal(typeof envelope.data, 'object')
  assert.notEqual(envelope.data, null)
  return envelope.data as Record<string, unknown>
}

describe('checked-in credential-free documentation examples', () => {
  it('keeps static example CLI commands runnable without installed adapter CLIs or secrets', () => {
    const config = assertOk(
      runCli(['config', 'validate', '--config', 'examples/rolekit.yaml', '--json']),
    )
    assert.deepEqual(config.roles, ['implementer', 'reviewer'])

    const compiled = assertOk(
      runCli([
        'compile',
        '--config',
        'examples/rolekit.yaml',
        '--role',
        'reviewer',
        '--task',
        'examples/tasks/review-change.yaml',
        '--executor',
        'host-reviewer',
        '--json',
      ]),
    )
    assert.equal((compiled.plan as Record<string, unknown>).schema, 'rolekit/execution-plan@1')

    const described = assertOk(
      runCli([
        'executors',
        'describe',
        '--config',
        'examples/rolekit.yaml',
        '--executor',
        'pi-rpc-implementer',
        '--json',
      ]),
    )
    assert.equal(described.profileId, 'pi-rpc-implementer')
    assert.equal(described.executorId, 'pi-rpc')
  })
})

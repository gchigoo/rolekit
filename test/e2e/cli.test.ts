import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

describe('RoleKit CLI', () => {
  it('shows only the portable validate and run surface', () => {
    const result = runCli(['--help'])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /rolekit validate role/u)
    assert.match(result.stdout, /rolekit run --role/u)
    assert.doesNotMatch(result.stdout, /\b(workitem|gate|migrate|evals|knowledge)\b/iu)
  })

  it('validates role and task contracts and runs a selected CLI adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-cli-test-'))
    try {
      const rolePath = join(directory, 'role.json')
      const taskPath = join(directory, 'task.json')
      const optionsPath = join(directory, 'options.json')
      const capturePath = join(directory, 'capture.json')
      await writeFile(
        rolePath,
        JSON.stringify({
          schema: 'rolekit/role-spec@1',
          id: 'writer',
          description: 'Writes a report.',
          requiredCapabilities: ['repository.read', 'repository.write'],
          inputSchema: {
            type: 'object',
            properties: { source: { type: 'string' } },
            required: ['source'],
            additionalProperties: false,
          },
          outputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        }),
        'utf8',
      )
      await writeFile(
        taskPath,
        JSON.stringify({
          schema: 'rolekit/task-packet@1',
          taskId: 'cli-task',
          roleId: 'writer',
          objective: 'Create a report.',
          input: { source: 'README.md' },
          context: [],
          constraints: [],
          acceptanceCriteria: ['Report returned.'],
          expectedArtifacts: [{ name: 'report', kind: 'text' }],
        }),
        'utf8',
      )
      await writeFile(
        optionsPath,
        JSON.stringify({
          command: process.execPath,
          commandArgs: [resolve('test', 'fixtures', 'fake-cli.mjs'), 'cursor'],
          environment: { ROLEKIT_FAKE_CAPTURE: capturePath },
        }),
        'utf8',
      )

      const validateRole = runCli(['validate', 'role', rolePath, '--json'])
      assert.equal(validateRole.status, 0, validateRole.stderr)
      assert.equal(JSON.parse(validateRole.stdout).valid, true)

      const validateTask = runCli(['validate', 'task', taskPath, '--json'])
      assert.equal(validateTask.status, 0, validateTask.stderr)
      assert.equal(JSON.parse(validateTask.stdout).valid, true)

      const run = runCli([
        'run',
        '--role',
        rolePath,
        '--task',
        taskPath,
        '--executor',
        'cursor',
        '--options',
        optionsPath,
        '--cwd',
        process.cwd(),
        '--json',
      ])
      assert.equal(run.status, 0, run.stderr)
      const result = JSON.parse(run.stdout)
      assert.equal(result.status, 'completed')
      assert.equal(result.executor.id, 'cursor')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

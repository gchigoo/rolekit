import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

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

async function createFixtureExecutable(
  directory: string,
  name: string,
  sourcePath: string,
  fixedArgs: readonly string[],
): Promise<string> {
  const scriptPath = join(directory, `${name}.mjs`)
  await writeFile(
    scriptPath,
    [
      '#!/usr/bin/env node',
      'const incoming = process.argv.slice(2)',
      'const invalidValueCanary = incoming.includes("rolekit-invalid-value-canary")',
      `if (incoming.includes('--version')) { process.stdout.write(${JSON.stringify(`fake-${name} 1.0.0\n`)}) }`,
      `else if (incoming.includes('--help')) { if (invalidValueCanary) { process.stderr.write(${JSON.stringify("error: invalid value 'rolekit-invalid-value-canary' for '--output-format <OUTPUT_FORMAT>'\n  [possible values: text, json, stream-json]\n\nFor more information, try '--help'.\n")}); process.exitCode = 2 } else { process.stdout.write(${JSON.stringify('--print --output-format --workspace --trust --sandbox --force --mode --model --approve-mcps --help\n')}) } }`,
      `else { process.argv.splice(2, 0, ...${JSON.stringify(fixedArgs)}); await import(${JSON.stringify(pathToFileURL(sourcePath).href)}) }`,
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(scriptPath, 0o755)
  if (process.platform !== 'win32') {
    return scriptPath
  }
  const commandPath = join(directory, `${name}.cmd`)
  await writeFile(commandPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8')
  return commandPath
}

async function writeRoleAndTask(directory: string): Promise<{
  readonly rolePath: string
  readonly taskPath: string
}> {
  const rolePath = join(directory, 'role.json')
  const taskPath = join(directory, 'task.json')
  await writeFile(
    rolePath,
    JSON.stringify({
      schema: 'rolekit/role-spec@1',
      id: 'writer',
      description: 'Writes a report.',
      requiredCapabilities: ['repository.read'],
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
  return { rolePath, taskPath }
}

async function writeConfig(
  directory: string,
  rolePath: string,
  command: string,
  environment: readonly string[] = [],
): Promise<string> {
  const configPath = join(directory, 'rolekit.yaml')
  await writeFile(
    configPath,
    [
      'schema: rolekit/config@1',
      'roles:',
      '  writer:',
      `    spec: ${JSON.stringify(rolePath)}`,
      '    executor: cursor-default',
      'executors:',
      '  cursor-default:',
      '    mode: adapter',
      '    adapter: cursor',
      '    options:',
      `      command: ${JSON.stringify(command)}`,
      ...(environment.length === 0
        ? []
        : ['      environment:', ...environment.map((entry) => `        ${entry}`)]),
      '',
    ].join('\n'),
    'utf8',
  )
  return configPath
}

describe('RoleKit CLI', () => {
  it('shows the portable contract, config, compile, run, finalize, and executor surface', () => {
    const result = runCli(['--help'])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /rolekit validate role/u)
    assert.match(result.stdout, /rolekit config validate/u)
    assert.match(result.stdout, /rolekit compile/u)
    assert.match(result.stdout, /rolekit run --config/u)
    assert.match(result.stdout, /rolekit finalize/u)
    assert.match(result.stdout, /rolekit executors describe/u)
    assert.doesNotMatch(result.stdout, /legacy|deprecated|rolekit run --role/iu)
    assert.doesNotMatch(result.stdout, /\b(workitem|gate|migrate|evals|knowledge)\b/iu)
  })

  it('validates contracts, runs the configured CLI adapter, and rejects obsolete run flags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-cli-test-'))
    try {
      const { rolePath, taskPath } = await writeRoleAndTask(directory)
      const capturePath = join(directory, 'capture.json')
      const resultPath = join(directory, 'run-result.v2.json')
      const command = await createFixtureExecutable(
        directory,
        'cursor-success',
        resolve('test', 'fixtures', 'fake-cli.mjs'),
        ['cursor'],
      )
      const configPath = await writeConfig(directory, rolePath, command, [
        `ROLEKIT_FAKE_CAPTURE: ${JSON.stringify(capturePath)}`,
      ])

      const validateRole = runCli(['validate', 'role', rolePath, '--json'])
      assert.equal(validateRole.status, 0, validateRole.stderr)
      assert.deepEqual(JSON.parse(validateRole.stdout), {
        ok: true,
        data: { valid: true, kind: 'role', file: resolve(rolePath) },
        warnings: [],
      })

      const validateTask = runCli(['validate', 'task', taskPath, '--json'])
      assert.equal(validateTask.status, 0, validateTask.stderr)
      assert.deepEqual(JSON.parse(validateTask.stdout), {
        ok: true,
        data: { valid: true, kind: 'task', file: resolve(taskPath) },
        warnings: [],
      })

      const run = runCli([
        'run',
        '--config',
        configPath,
        '--role',
        'writer',
        '--task',
        taskPath,
        '--cwd',
        process.cwd(),
        '--json',
      ])
      assert.equal(run.status, 0, run.stderr)
      assert.equal(run.stderr, '')
      const runEnvelope = JSON.parse(run.stdout)
      assert.equal(runEnvelope.ok, true)
      assert.deepEqual(runEnvelope.warnings, [])
      const result = runEnvelope.data
      assert.equal(result.schema, 'rolekit/run-result@2')
      assert.equal(result.status, 'completed')
      assert.equal(result.executor.id, 'cursor')
      assert.equal(result.executor.profileId, 'cursor-default')
      assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
      assert.equal(Object.hasOwn(result, 'warnings'), false)

      const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
        readonly mode: string
      }
      assert.equal(capture.mode, 'cursor')

      const textRun = runCli([
        'run',
        '--config',
        configPath,
        '--role',
        'writer',
        '--task',
        taskPath,
        '--cwd',
        process.cwd(),
      ])
      assert.equal(textRun.status, 0, textRun.stderr)
      assert.equal(textRun.stderr, '')
      assert.match(textRun.stdout, /\[completed\]/u)

      const obsoleteRun = runCli([
        'run',
        '--role',
        rolePath,
        '--task',
        taskPath,
        '--executor',
        'cursor',
        '--json',
      ])
      assert.equal(obsoleteRun.status, 2, obsoleteRun.stderr)
      const obsoleteEnvelope = JSON.parse(obsoleteRun.stdout)
      assert.equal(obsoleteEnvelope.ok, false)
      assert.equal(obsoleteEnvelope.error.code, 'usage_error')
      assert.match(obsoleteEnvelope.error.message, /--config/u)
      assert.deepEqual(obsoleteEnvelope.warnings, [])

      await writeFile(resultPath, JSON.stringify(result), 'utf8')
      const validateV2 = runCli(['validate', 'result', resultPath, '--json'])
      assert.equal(validateV2.status, 0, validateV2.stderr)
      assert.equal(JSON.parse(validateV2.stdout).ok, true)
      assert.equal(JSON.parse(validateV2.stdout).data.valid, true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('redacts sensitive command and stderr values from JSON failure output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-cli-redaction-'))
    const secret = 'cli-json-secret'
    try {
      const { rolePath, taskPath } = await writeRoleAndTask(directory)
      const command = await createFixtureExecutable(
        directory,
        'cursor-failure',
        resolve('test', 'fixtures', 'long-running-cli.mjs'),
        ['fail', '--token', secret],
      )
      const configPath = await writeConfig(directory, rolePath, command)

      const run = runCli([
        'run',
        '--config',
        configPath,
        '--role',
        'writer',
        '--task',
        taskPath,
        '--json',
      ])

      assert.equal(run.status, 1, run.stderr)
      assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, new RegExp(secret, 'u'))
      const envelope = JSON.parse(run.stdout)
      assert.equal(envelope.ok, true)
      assert.deepEqual(envelope.warnings, [])
      const result = envelope.data
      assert.equal(result.status, 'failed')
      assert.equal(result.error.code, 'nonzero_exit')
      assert.equal(Object.hasOwn(result, 'warnings'), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('prints the package version through the source CLI', () => {
    const result = runCli(['--version'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^0\.1\.0\s*$/u)
    assert.equal(result.stderr, '')
  })
})

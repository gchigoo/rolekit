import assert from 'node:assert/strict'
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function startCli(args: readonly string[]): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--input-type=module', '-e', invokeSourceCli, '--', ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

async function collectCli(child: ChildProcessWithoutNullStreams): Promise<{
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}> {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  return new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }))
  })
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
  }
  throw new Error(`Timed out waiting for file: ${path}`)
}

function forceKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The fixture already exited.
  }
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
    assert.match(result.stdout, /legacy.*rolekit run --role/iu)
    assert.doesNotMatch(result.stdout, /\b(workitem|gate|migrate|evals|knowledge)\b/iu)
  })

  it('validates role and task contracts and runs a selected CLI adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-cli-test-'))
    try {
      const rolePath = join(directory, 'role.json')
      const taskPath = join(directory, 'task.json')
      const optionsPath = join(directory, 'options.json')
      const resultPath = join(directory, 'run-result.v2.json')
      const legacyResultPath = join(directory, 'run-result.v1.json')
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
      const command = await createFixtureExecutable(
        directory,
        'cursor-success',
        resolve('test', 'fixtures', 'fake-cli.mjs'),
        ['cursor'],
      )
      await writeFile(
        optionsPath,
        JSON.stringify({
          command,
          environment: { ROLEKIT_FAKE_CAPTURE: capturePath },
        }),
        'utf8',
      )

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
      assert.equal(run.stderr, '')
      const runEnvelope = JSON.parse(run.stdout)
      assert.equal(runEnvelope.ok, true)
      assert.deepEqual(runEnvelope.warnings, [
        {
          code: 'legacy_run_deprecated',
          message:
            'Legacy run flags are deprecated; use run --config <file> --role <role-id> --task <file>.',
        },
      ])
      const result = runEnvelope.data
      assert.equal(result.schema, 'rolekit/run-result@2')
      assert.equal(result.status, 'completed')
      assert.equal(result.executor.id, 'cursor')
      assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
      assert.equal(Object.hasOwn(result, 'warnings'), false)

      const textRun = runCli([
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
      ])
      assert.equal(textRun.status, 0, textRun.stderr)
      assert.match(textRun.stderr, /legacy run flags are deprecated/iu)
      assert.match(textRun.stdout, /\[completed\]/u)

      const unknownBuiltIn = runCli([
        'run',
        '--role',
        rolePath,
        '--task',
        taskPath,
        '--executor',
        'unknown-built-in',
        '--json',
      ])
      assert.equal(unknownBuiltIn.status, 2, unknownBuiltIn.stderr)
      const unknownEnvelope = JSON.parse(unknownBuiltIn.stdout)
      assert.equal(unknownEnvelope.ok, false)
      assert.equal(unknownEnvelope.error.code, 'usage_error')
      assert.deepEqual(unknownEnvelope.warnings, [
        {
          code: 'legacy_run_deprecated',
          message:
            'Legacy run flags are deprecated; use run --config <file> --role <role-id> --task <file>.',
        },
      ])

      await writeFile(resultPath, JSON.stringify(result), 'utf8')
      const validateV2 = runCli(['validate', 'result', resultPath, '--json'])
      assert.equal(validateV2.status, 0, validateV2.stderr)
      assert.equal(JSON.parse(validateV2.stdout).ok, true)
      assert.equal(JSON.parse(validateV2.stdout).data.valid, true)

      await writeFile(
        legacyResultPath,
        JSON.stringify({
          schema: 'rolekit/run-result@1',
          runId: 'legacy-run',
          taskId: 'cli-task',
          roleId: 'writer',
          status: 'blocked',
          executor: { id: 'cursor', transport: 'cli' },
          summary: 'Stored legacy result.',
          artifacts: [],
          evidence: [],
          usage: {},
          error: { code: 'blocked', message: 'Stored block.', retryable: false },
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        'utf8',
      )
      const validateV1 = runCli(['validate', 'result', legacyResultPath, '--json'])
      assert.equal(validateV1.status, 0, validateV1.stderr)
      assert.equal(JSON.parse(validateV1.stdout).ok, true)
      assert.equal(JSON.parse(validateV1.stdout).data.valid, true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('redacts sensitive command and stderr values from JSON failure output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-cli-redaction-'))
    const secret = 'cli-json-secret'
    try {
      const rolePath = join(directory, 'role.json')
      const taskPath = join(directory, 'task.json')
      const optionsPath = join(directory, 'options.json')
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
          taskId: 'cli-failure-task',
          roleId: 'writer',
          objective: 'Fail without exposing credentials.',
          input: { source: 'README.md' },
          context: [],
          constraints: [],
          acceptanceCriteria: [],
          expectedArtifacts: [],
        }),
        'utf8',
      )
      const command = await createFixtureExecutable(
        directory,
        'cursor-failure',
        resolve('test', 'fixtures', 'long-running-cli.mjs'),
        ['fail', '--token', secret],
      )
      await writeFile(optionsPath, JSON.stringify({ command }), 'utf8')

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
        '--json',
      ])

      assert.equal(run.status, 1, run.stderr)
      assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, new RegExp(secret, 'u'))
      const envelope = JSON.parse(run.stdout)
      assert.equal(envelope.ok, true)
      assert.deepEqual(envelope.warnings, [
        {
          code: 'legacy_run_deprecated',
          message:
            'Legacy run flags are deprecated; use run --config <file> --role <role-id> --task <file>.',
        },
      ])
      const result = envelope.data
      assert.equal(result.status, 'failed')
      assert.equal(result.error.code, 'nonzero_exit')
      assert.equal(Object.hasOwn(result, 'warnings'), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('maps SIGINT and SIGTERM cancellation to conventional exit codes', {
    skip: process.platform === 'win32',
  }, async () => {
    for (const { signal, expectedCode } of [
      { signal: 'SIGINT', expectedCode: 130 },
      { signal: 'SIGTERM', expectedCode: 143 },
    ] as const) {
      const directory = await mkdtemp(join(tmpdir(), `rolekit-cli-${signal.toLowerCase()}-`))
      const rolePath = join(directory, 'role.json')
      const taskPath = join(directory, 'task.json')
      const optionsPath = join(directory, 'options.json')
      const markerPath = join(directory, 'fixture.pid')
      let fixturePid: number | undefined
      let child: ChildProcessWithoutNullStreams | undefined
      try {
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
            taskId: `cli-${signal.toLowerCase()}-task`,
            roleId: 'writer',
            objective: 'Wait for cancellation.',
            input: { source: 'README.md' },
            context: [],
            constraints: [],
            acceptanceCriteria: [],
            expectedArtifacts: [],
          }),
          'utf8',
        )
        const command = await createFixtureExecutable(
          directory,
          `cursor-${signal.toLowerCase()}`,
          resolve('test', 'fixtures', 'long-running-cli.mjs'),
          ['hang', markerPath],
        )
        await writeFile(optionsPath, JSON.stringify({ command }), 'utf8')

        child = startCli([
          'run',
          '--role',
          rolePath,
          '--task',
          taskPath,
          '--executor',
          'cursor',
          '--options',
          optionsPath,
          '--json',
        ])
        const completion = collectCli(child)
        await waitForFile(markerPath)
        fixturePid = Number.parseInt(await readFile(markerPath, 'utf8'), 10)
        assert.equal(child.kill(signal), true)

        const result = await completion
        assert.equal(result.signal, null, result.stderr)
        assert.equal(result.code, expectedCode, JSON.stringify(result))
        const envelope = JSON.parse(result.stdout)
        assert.equal(envelope.ok, true)
        assert.deepEqual(envelope.warnings, [
          {
            code: 'legacy_run_deprecated',
            message:
              'Legacy run flags are deprecated; use run --config <file> --role <role-id> --task <file>.',
          },
        ])
        assert.equal(envelope.data.status, 'cancelled')
        assert.equal(envelope.data.error.code, 'cancelled')
      } finally {
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
        if (fixturePid !== undefined) {
          forceKill(fixturePid)
        }
        await rm(directory, { recursive: true, force: true })
      }
    }
  })
})

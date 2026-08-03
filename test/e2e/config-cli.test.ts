import assert from 'node:assert/strict'
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const invokeSourceCli = [
  "import('./src/cli.ts')",
  '.then(async ({ main }) => { await main(process.argv.slice(1)); })',
].join('')

interface RunCliOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

function runCli(args: readonly string[], options: RunCliOptions = {}) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', invokeSourceCli, '--', ...args],
    {
      cwd: options.cwd ?? process.cwd(),
      encoding: 'utf8',
      env: options.env ?? process.env,
    },
  )
}

function startCli(
  args: readonly string[],
  options: RunCliOptions = {},
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--input-type=module', '-e', invokeSourceCli, '--', ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
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

async function openFifoWriter(path: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await open(path, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK)
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined
      if (code !== 'ENXIO') {
        throw error
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
  }
  throw new Error(`Timed out waiting for FIFO reader: ${path}`)
}

function forceKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The fixture already exited.
  }
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(access(path))
}

async function createFixtureExecutable(
  directory: string,
  name: string,
  sourcePath: string,
  fixedArgs: readonly string[],
  probeCapturePath?: string,
  slowProbeMarkerPath?: string,
): Promise<string> {
  const scriptPath = join(directory, `${name}.mjs`)
  const captureProbe =
    probeCapturePath === undefined
      ? ''
      : `await appendFile(${JSON.stringify(probeCapturePath)}, JSON.stringify({ args: incoming, cursorSecret: process.env.CURSOR_API_KEY ?? null, openAiSecret: process.env.OPENAI_API_KEY ?? null }) + "\\n", "utf8")\n`
  const slowProbe =
    slowProbeMarkerPath === undefined
      ? ''
      : `await writeFile(${JSON.stringify(slowProbeMarkerPath)}, String(process.pid), "utf8")\nsetInterval(() => {}, 1000)\nawait new Promise(() => {})\n`
  await writeFile(
    scriptPath,
    [
      '#!/usr/bin/env node',
      'import { appendFile, writeFile } from "node:fs/promises"',
      'const incoming = process.argv.slice(2)',
      'const invalidValueCanary = incoming.includes("rolekit-invalid-value-canary")',
      'if (incoming.includes("--version")) {',
      captureProbe,
      slowProbe,
      `  process.stdout.write(${JSON.stringify(`fake-${name} 1.0.0\n`)})`,
      '} else if (incoming.includes("--help")) {',
      captureProbe,
      slowProbe,
      '  if (invalidValueCanary) {',
      `    process.stderr.write(${JSON.stringify("error: invalid value 'rolekit-invalid-value-canary' for '--output-format <OUTPUT_FORMAT>'\n  [possible values: text, json, stream-json]\n\nFor more information, try '--help'.\n")})`,
      '    process.exitCode = 2',
      '  } else {',
      `    process.stdout.write(${JSON.stringify('--print --output-format --workspace --trust --sandbox --force --mode --model --approve-mcps --json --ephemeral --color --skip-git-repo-check --ignore-user-config --ignore-rules -c -C --output-schema -o --profile --web-search --no-session --no-context-files --no-extensions --no-skills --no-prompt-templates --tools --system-prompt --provider --thinking --offline\n')})`,
      '  }',
      '} else {',
      `  process.argv.splice(2, 0, ...${JSON.stringify(fixedArgs)})`,
      `  await import(${JSON.stringify(pathToFileURL(sourcePath).href)})`,
      '}',
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

interface ConfigFixture {
  readonly directory: string
  readonly configPath: string
  readonly rolePath: string
  readonly taskPath: string
  readonly cursorCommand: string
  readonly cursorCapturePath: string
  readonly codexCapturePath: string
  readonly piRpcCapturePath: string
  readonly probeCapturePath: string
}

async function createConfigFixture(): Promise<ConfigFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-config-cli-'))
  const rolePath = join(directory, 'reviewer.json')
  const taskPath = join(directory, 'task.json')
  const fragmentPath = join(directory, 'reviewer-extra.md')
  const configPath = join(directory, 'rolekit.yaml')
  const cursorCapturePath = join(directory, 'cursor-capture.json')
  const codexCapturePath = join(directory, 'codex-capture.json')
  const piRpcCapturePath = join(directory, 'pi-rpc-capture.jsonl')
  const probeCapturePath = join(directory, 'probe-capture.jsonl')
  const fixtureSource = resolve('test', 'fixtures', 'fake-cli.mjs')
  const piRpcCommand = resolve('test', 'fixtures', 'fake-pi-rpc.mjs')
  await chmod(piRpcCommand, 0o755)
  const cursorCommand = await createFixtureExecutable(
    directory,
    'cursor-config',
    fixtureSource,
    ['cursor'],
    probeCapturePath,
  )
  const codexCommand = await createFixtureExecutable(directory, 'codex-config', fixtureSource, [
    'codex',
  ])

  await writeFile(
    rolePath,
    `${JSON.stringify(
      {
        schema: 'rolekit/role-spec@1',
        id: 'reviewer',
        description: 'Reviews one bounded change.',
        instructions: 'Base reviewer instructions.',
        requiredCapabilities: ['repository.read'],
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['request'],
          properties: { request: { type: 'string', minLength: 1 } },
        },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writeFile(fragmentPath, 'Apply the configured review checklist.\n', 'utf8')
  await writeFile(
    taskPath,
    `${JSON.stringify(
      {
        schema: 'rolekit/task-packet@1',
        taskId: 'config-cli-task',
        roleId: 'reviewer',
        objective: 'Review the requested change.',
        input: { request: 'Review README.md.' },
        context: [
          {
            id: 'readme',
            type: 'file',
            value: 'README.md',
            description: 'Primary review context.',
          },
        ],
        constraints: ['Do not modify the workspace.'],
        acceptanceCriteria: ['Return one review report.'],
        allowedPaths: ['README.md'],
        expectedArtifacts: [{ name: 'report', kind: 'text' }],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writeFile(
    configPath,
    [
      'schema: rolekit/config@1',
      'roles:',
      '  reviewer:',
      '    spec: reviewer.json',
      '    promptFragments: [reviewer-extra.md]',
      '    executor: cursor-default',
      'executors:',
      '  cursor-default:',
      '    mode: adapter',
      '    adapter: cursor',
      '    options:',
      `      command: ${JSON.stringify(cursorCommand)}`,
      '      model: cursor-requested',
      '      environment:',
      '        CURSOR_API_KEY: { $env: CURSOR_API_KEY }',
      `        ROLEKIT_FAKE_CAPTURE: ${JSON.stringify(cursorCapturePath)}`,
      '  codex-reviewer:',
      '    mode: adapter',
      '    adapter: codex',
      '    options:',
      `      command: ${JSON.stringify(codexCommand)}`,
      '      model: codex-requested',
      '      reasoningEffort: high',
      '      environment:',
      '        OPENAI_API_KEY: { $env: OPENAI_API_KEY }',
      `        ROLEKIT_FAKE_CAPTURE: ${JSON.stringify(codexCapturePath)}`,
      '  pi-rpc-reviewer:',
      '    mode: adapter',
      '    adapter: pi-rpc',
      '    options:',
      `      command: ${JSON.stringify(piRpcCommand)}`,
      '      provider: xai',
      '      model: grok-4.5',
      '      thinking: high',
      '      tools: [read]',
      '      environment:',
      '        XAI_API_KEY: { $env: XAI_API_KEY }',
      `        ROLEKIT_FAKE_RPC_CAPTURE: ${JSON.stringify(piRpcCapturePath)}`,
      '  unavailable-pi:',
      '    mode: adapter',
      '    adapter: pi',
      '    options:',
      `      command: ${JSON.stringify(join(directory, 'not-installed-pi'))}`,
      '      provider: xai',
      '      model: static-only-model',
      '      tools: [read]',
      '      environment:',
      '        XAI_API_KEY: { $env: XAI_API_KEY }',
      '  host-reviewer:',
      '    mode: host',
      '    executorId: native-review-host',
      '    transport: remote',
      '    capabilities: [repository.read]',
      '    requestedProvider: host-provider',
      '    requestedModel: host-requested',
      '    pathEnforcement: host',
      '    contextIsolation:',
      '      userConfig: isolated',
      '      projectInstructions: isolated',
      '      projectResources: isolated',
      '      environment: minimal',
      '      credentials: explicit',
      '',
    ].join('\n'),
    'utf8',
  )

  return {
    directory,
    configPath,
    rolePath,
    taskPath,
    cursorCommand,
    cursorCapturePath,
    codexCapturePath,
    piRpcCapturePath,
    probeCapturePath,
  }
}

function jsonEnvelope(result: ReturnType<typeof runCli>): Record<string, unknown> {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout)
  return JSON.parse(result.stdout) as Record<string, unknown>
}

function successfulData(result: ReturnType<typeof runCli>): Record<string, unknown> {
  const envelope = jsonEnvelope(result)
  assert.equal(envelope.ok, true, JSON.stringify(envelope))
  assert.deepEqual(envelope.warnings, [])
  assert.equal(typeof envelope.data, 'object')
  assert.notEqual(envelope.data, null)
  return envelope.data as Record<string, unknown>
}

function failedError(result: ReturnType<typeof runCli>): Record<string, unknown> {
  const envelope = jsonEnvelope(result)
  assert.equal(envelope.ok, false, JSON.stringify(envelope))
  assert.deepEqual(envelope.warnings, [])
  assert.equal(typeof envelope.error, 'object')
  assert.notEqual(envelope.error, null)
  return envelope.error as Record<string, unknown>
}

function planFromCompile(result: ReturnType<typeof runCli>): {
  readonly plan: Record<string, unknown>
  readonly planDigest: string
} {
  const data = successfulData(result)
  assert.equal(typeof data.plan, 'object')
  assert.notEqual(data.plan, null)
  assert.equal(typeof data.planDigest, 'string')
  return { plan: data.plan as Record<string, unknown>, planDigest: data.planDigest as string }
}

function hostReceipt(
  resolved: { readonly plan: Record<string, unknown>; readonly planDigest: string },
  response: unknown,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const content = resolved.plan.content as Record<string, unknown>
  const task = (content.task as Record<string, unknown>).snapshot as Record<string, unknown>
  const role = (content.role as Record<string, unknown>).snapshot as Record<string, unknown>
  const executor = content.executor as Record<string, unknown>
  return {
    schema: 'rolekit/execution-receipt@1',
    planDigest: resolved.planDigest,
    runId: resolved.plan.runId,
    taskId: task.taskId,
    roleId: role.id,
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:03.000Z',
    actualExecutor: {
      id: executor.id,
      transport: executor.transport,
      executorVersion: 'host-runtime-1.0.0',
      actualProvider: 'host-provider-actual',
      actualModel: 'host-model-actual',
    },
    response,
    ...overrides,
  }
}

const completedHostResponse = {
  status: 'completed',
  summary: 'Host review completed.',
  output: { message: 'host' },
  artifacts: [{ name: 'report', kind: 'text', content: 'host report' }],
  evidence: [{ kind: 'note', value: 'host fixture' }],
  provider: 'host-provider-actual',
  model: 'host-model-actual',
  version: 'host-runtime-1.0.0',
} as const

describe('config-driven RoleKit CLI', () => {
  it('validates the complete config graph without installed executables or resolved secrets', async () => {
    const fixture = await createConfigFixture()
    try {
      const result = runCli(['config', 'validate', '--config', fixture.configPath, '--json'], {
        env: { PATH: process.env.PATH },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      const data = successfulData(result)
      assert.equal(data.valid, true)
      assert.deepEqual(data.roles, ['reviewer'])
      assert.deepEqual(data.executors, [
        'codex-reviewer',
        'cursor-default',
        'host-reviewer',
        'pi-rpc-reviewer',
        'unavailable-pi',
      ])
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.codexCapturePath)
      await assertMissing(fixture.probeCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('rejects invalid unused profiles and missing prompt fragments during full config validation', async () => {
    const fixture = await createConfigFixture()
    try {
      const invalidProfilePath = join(fixture.directory, 'invalid-profile.yaml')
      await writeFile(
        invalidProfilePath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: reviewer.json',
          '    executor: host',
          'executors:',
          '  host:',
          '    mode: host',
          '    executorId: host',
          '    transport: remote',
          '    capabilities: [repository.read]',
          '    pathEnforcement: host',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '  unused-invalid:',
          '    mode: adapter',
          '    adapter: cursor',
          '    options:',
          '      unsupportedOption: true',
          '',
        ].join('\n'),
        'utf8',
      )
      const invalidProfile = runCli([
        'config',
        'validate',
        '--config',
        invalidProfilePath,
        '--json',
      ])
      assert.equal(invalidProfile.status, 3)
      assert.equal(failedError(invalidProfile).code, 'invalid_config')

      const missingFragmentPath = join(fixture.directory, 'missing-fragment.yaml')
      await writeFile(
        missingFragmentPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: reviewer.json',
          '    promptFragments: [missing.md]',
          '    executor: host',
          'executors:',
          '  host:',
          '    mode: host',
          '    executorId: host',
          '    transport: remote',
          '    capabilities: [repository.read]',
          '    pathEnforcement: host',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '',
        ].join('\n'),
        'utf8',
      )
      const missingFragment = runCli([
        'config',
        'validate',
        '--config',
        missingFragmentPath,
        '--json',
      ])
      assert.equal(missingFragment.status, 3)
      assert.equal(failedError(missingFragment).code, 'invalid_config')
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('rejects invalid role and profile declarations shadowed by effective root entries', async () => {
    const fixture = await createConfigFixture()
    try {
      const shadowedRoleBasePath = join(fixture.directory, 'shadowed-role-base.yaml')
      const shadowedRoleRootPath = join(fixture.directory, 'shadowed-role-root.yaml')
      await writeFile(
        shadowedRoleBasePath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: missing-shadowed-role.json',
          '    promptFragments: [missing-shadowed-fragment.md]',
          '    executor: host',
          'executors:',
          '  host:',
          '    mode: host',
          '    executorId: host',
          '    transport: remote',
          '    capabilities: [repository.read]',
          '    pathEnforcement: host',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '',
        ].join('\n'),
        'utf8',
      )
      await writeFile(
        shadowedRoleRootPath,
        [
          'schema: rolekit/config@1',
          'extends: [shadowed-role-base.yaml]',
          'roles:',
          '  reviewer:',
          '    spec: reviewer.json',
          '    executor: host',
          'executors: {}',
          '',
        ].join('\n'),
        'utf8',
      )
      const shadowedRole = runCli([
        'config',
        'validate',
        '--config',
        shadowedRoleRootPath,
        '--json',
      ])
      assert.equal(shadowedRole.status, 3, shadowedRole.stdout)
      assert.equal(failedError(shadowedRole).code, 'invalid_config')

      const shadowedProfileBasePath = join(fixture.directory, 'shadowed-profile-base.yaml')
      const shadowedProfileRootPath = join(fixture.directory, 'shadowed-profile-root.yaml')
      await writeFile(
        shadowedProfileBasePath,
        [
          'schema: rolekit/config@1',
          'roles: {}',
          'executors:',
          '  shared:',
          '    mode: adapter',
          '    adapter: cursor',
          '    options:',
          '      environment:',
          '        CURSOR_API_KEY: { $env: invalid-name }',
          '',
        ].join('\n'),
        'utf8',
      )
      await writeFile(
        shadowedProfileRootPath,
        [
          'schema: rolekit/config@1',
          'extends: [shadowed-profile-base.yaml]',
          'roles:',
          '  reviewer:',
          '    spec: reviewer.json',
          '    executor: shared',
          'executors:',
          '  shared:',
          '    mode: host',
          '    executorId: host',
          '    transport: remote',
          '    capabilities: [repository.read]',
          '    pathEnforcement: host',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '',
        ].join('\n'),
        'utf8',
      )
      const shadowedProfile = runCli([
        'config',
        'validate',
        '--config',
        shadowedProfileRootPath,
        '--json',
      ])
      assert.equal(shadowedProfile.status, 3, shadowedProfile.stdout)
      assert.equal(failedError(shadowedProfile).code, 'invalid_config')
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('compiles a complete role binding without probing, resolving secrets, or invoking an adapter', async () => {
    const fixture = await createConfigFixture()
    const secret = 'compile-must-not-read-this-secret'
    try {
      const args = [
        'compile',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        fixture.taskPath,
        '--cwd',
        fixture.directory,
        '--run-id',
        'reproducible-run',
        '--created-at',
        '2026-01-01T00:00:00.000Z',
        '--json',
      ]
      const result = runCli(args, {
        env: {
          ...process.env,
          CURSOR_API_KEY: secret,
          ROLEKIT_CAPTURE_FILE: fixture.cursorCapturePath,
        },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.doesNotMatch(result.stdout, new RegExp(secret, 'u'))
      assert.equal(result.stdout.includes(fixture.cursorCapturePath), false)
      const resolved = planFromCompile(result)
      assert.equal(resolved.plan.schema, 'rolekit/execution-plan@1')
      assert.equal(resolved.plan.runId, 'reproducible-run')
      assert.equal(resolved.plan.createdAt, '2026-01-01T00:00:00.000Z')
      const content = resolved.plan.content as Record<string, unknown>
      const executor = content.executor as Record<string, unknown>
      assert.equal(executor.profileId, 'cursor-default')
      assert.equal(executor.requestedModel, 'cursor-requested')
      assert.deepEqual(executor.requiredSecrets, ['CURSOR_API_KEY'])
      assert.deepEqual((content.role as Record<string, unknown>).snapshot, {
        schema: 'rolekit/role-spec@1',
        id: 'reviewer',
        description: 'Reviews one bounded change.',
        instructions: 'Base reviewer instructions.\n\nApply the configured review checklist.',
        requiredCapabilities: ['repository.read'],
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['request'],
          properties: { request: { type: 'string', minLength: 1 } },
        },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
      })
      assert.deepEqual((content.task as Record<string, unknown>).snapshot, {
        schema: 'rolekit/task-packet@1',
        taskId: 'config-cli-task',
        roleId: 'reviewer',
        objective: 'Review the requested change.',
        input: { request: 'Review README.md.' },
        context: [
          {
            id: 'readme',
            type: 'file',
            value: 'README.md',
            description: 'Primary review context.',
          },
        ],
        constraints: ['Do not modify the workspace.'],
        acceptanceCriteria: ['Return one review report.'],
        allowedPaths: ['README.md'],
        expectedArtifacts: [{ name: 'report', kind: 'text' }],
      })
      assert.equal((content.policy as Record<string, unknown>).pathEnforcement, 'advisory')

      const repeated = runCli(args, { env: { ...process.env, CURSOR_API_KEY: 'other-secret' } })
      assert.equal(repeated.status, 0, repeated.stderr)
      assert.deepEqual(planFromCompile(repeated), resolved)

      const varied = runCli(
        args.map((value) => (value === 'reproducible-run' ? 'other-run' : value)),
      )
      assert.equal(varied.status, 0, varied.stderr)
      const variedPlan = planFromCompile(varied)
      assert.notEqual(variedPlan.planDigest, resolved.planDigest)
      assert.equal(variedPlan.plan.contentDigest, resolved.plan.contentDigest)
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.probeCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('emits a denied integrity-bound plan and exits 4 for static admission failure', async () => {
    const fixture = await createConfigFixture()
    try {
      const blockedTaskPath = join(fixture.directory, 'blocked-task.json')
      const task = JSON.parse(await readFile(fixture.taskPath, 'utf8')) as Record<string, unknown>
      task.requiredCapabilities = ['shell']
      await writeFile(blockedTaskPath, `${JSON.stringify(task)}\n`, 'utf8')
      const result = runCli([
        'compile',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        blockedTaskPath,
        '--json',
      ])
      assert.equal(result.status, 4, result.stderr)
      const resolved = planFromCompile(result)
      assert.match(resolved.planDigest, /^sha256:[a-f0-9]{64}$/u)
      const policy = (resolved.plan.content as Record<string, unknown>).policy as Record<
        string,
        unknown
      >
      assert.deepEqual((policy.admission as Record<string, unknown>).allowed, false)
      assert.equal(
        ((policy.admission as Record<string, unknown>).error as Record<string, unknown>).code,
        'unsupported_permission_combination',
      )
      const hostResult = runCli([
        'compile',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        blockedTaskPath,
        '--executor',
        'host-reviewer',
        '--json',
      ])
      assert.equal(hostResult.status, 4, hostResult.stderr)
      const hostPlan = planFromCompile(hostResult).plan
      const hostContent = hostPlan.content as Record<string, unknown>
      assert.equal((hostContent.executor as Record<string, unknown>).target, 'host')
      const hostPolicy = hostContent.policy as Record<string, unknown>
      assert.equal((hostPolicy.admission as Record<string, unknown>).allowed, false)
      assert.equal(
        ((hostPolicy.admission as Record<string, unknown>).error as Record<string, unknown>).code,
        'capability_mismatch',
      )
      assert.equal(hostPolicy.pathEnforcement, 'host')
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.probeCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('runs the configured default executor profile with runtime-only secret resolution', async () => {
    const fixture = await createConfigFixture()
    const secret = 'cursor-runtime-secret'
    try {
      const result = runCli(
        [
          'run',
          '--config',
          fixture.configPath,
          '--role',
          'reviewer',
          '--task',
          fixture.taskPath,
          '--cwd',
          fixture.directory,
          '--json',
        ],
        { env: { ...process.env, CURSOR_API_KEY: secret } },
      )
      assert.equal(result.status, 0, result.stderr)
      assert.doesNotMatch(result.stdout, new RegExp(secret, 'u'))
      const data = successfulData(result)
      assert.equal(data.schema, 'rolekit/run-result@2')
      assert.equal(data.status, 'completed')
      assert.deepEqual(data.output, { message: 'cursor' })
      const executor = data.executor as Record<string, unknown>
      assert.equal(executor.id, 'cursor')
      assert.equal(executor.profileId, 'cursor-default')
      assert.equal(executor.requestedModel, 'cursor-requested')
      assert.equal(executor.actualModel, 'cursor/actual-model')
      const capture = JSON.parse(await readFile(fixture.cursorCapturePath, 'utf8')) as {
        readonly environment: Readonly<Record<string, string | null>>
      }
      assert.equal(capture.environment.CURSOR_API_KEY, secret)
      await assertMissing(fixture.codexCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('runs one configured Pi RPC task without falling back to another executor profile', async () => {
    const fixture = await createConfigFixture()
    const secret = 'pi-rpc-config-runtime-secret'
    try {
      const result = runCli(
        [
          'run',
          '--config',
          fixture.configPath,
          '--role',
          'reviewer',
          '--task',
          fixture.taskPath,
          '--cwd',
          fixture.directory,
          '--executor',
          'pi-rpc-reviewer',
          '--json',
        ],
        { env: { ...process.env, XAI_API_KEY: secret } },
      )
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
      assert.doesNotMatch(result.stdout, new RegExp(secret, 'u'))
      const data = successfulData(result)
      assert.equal(data.status, 'completed')
      assert.deepEqual(data.output, { message: 'pi-rpc' })
      const executor = data.executor as Record<string, unknown>
      assert.equal(executor.id, 'pi-rpc')
      assert.equal(executor.profileId, 'pi-rpc-reviewer')
      assert.equal(executor.requestedProvider, 'xai')
      assert.equal(executor.requestedModel, 'grok-4.5')
      assert.equal(executor.actualProvider, 'xai')
      assert.equal(executor.actualModel, 'grok-4.5')

      const records = (await readFile(fixture.piRpcCapturePath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      const commands = records
        .filter((record) => record.phase === 'command')
        .map((record) => record.command as Record<string, unknown>)
      assert.ok(commands.some((command) => command.type === 'set_model'))
      assert.ok(commands.some((command) => command.type === 'set_thinking_level'))
      assert.ok(commands.some((command) => command.type === 'prompt'))
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.codexCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('emits one cancellation error envelope when configured run is interrupted before a task document exists', {
    skip: process.platform === 'win32',
  }, async () => {
    const fixture = await createConfigFixture()
    const taskPipePath = join(fixture.directory, 'slow-task.json')
    let child: ChildProcessWithoutNullStreams | undefined
    try {
      const mkfifo = spawnSync('mkfifo', [taskPipePath], { encoding: 'utf8' })
      assert.equal(mkfifo.status, 0, mkfifo.stderr)
      child = startCli(
        [
          'run',
          '--config',
          fixture.configPath,
          '--role',
          'reviewer',
          '--task',
          taskPipePath,
          '--json',
        ],
        { env: { ...process.env, CURSOR_API_KEY: 'unused-pre-document-secret' } },
      )
      const completion = collectCli(child)
      const writer = await openFifoWriter(taskPipePath)
      assert.equal(child.kill('SIGTERM'), true)
      try {
        await writer.writeFile(await readFile(fixture.taskPath))
      } catch {
        // The pre-fix process exits on the default signal before consuming the FIFO.
      } finally {
        await writer.close()
      }

      const result = await completion
      assert.equal(result.signal, null, JSON.stringify(result))
      assert.equal(result.code, 143, JSON.stringify(result))
      assert.equal(result.stderr, '')
      const envelope = JSON.parse(result.stdout)
      assert.equal(envelope.ok, false)
      assert.equal(envelope.error.code, 'cancelled')
      assert.deepEqual(envelope.warnings, [])
    } finally {
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('keeps configured-run cancellation as an ok:true RunResult for SIGINT and SIGTERM', {
    skip: process.platform === 'win32',
  }, async () => {
    for (const { signal, expectedCode } of [
      { signal: 'SIGINT', expectedCode: 130 },
      { signal: 'SIGTERM', expectedCode: 143 },
    ] as const) {
      const fixture = await createConfigFixture()
      const markerPath = join(fixture.directory, `${signal.toLowerCase()}-configured.pid`)
      let child: ChildProcessWithoutNullStreams | undefined
      let fixturePid: number | undefined
      try {
        const command = await createFixtureExecutable(
          fixture.directory,
          `cursor-configured-${signal.toLowerCase()}`,
          resolve('test', 'fixtures', 'long-running-cli.mjs'),
          ['hang', markerPath],
        )
        const configPath = join(fixture.directory, `${signal.toLowerCase()}-configured.yaml`)
        await writeFile(
          configPath,
          [
            'schema: rolekit/config@1',
            'extends: [rolekit.yaml]',
            'roles: {}',
            'executors:',
            '  cursor-default:',
            '    mode: adapter',
            '    adapter: cursor',
            '    options:',
            `      command: ${JSON.stringify(command)}`,
            '      environment:',
            '        CURSOR_API_KEY: { $env: CURSOR_API_KEY }',
            '',
          ].join('\n'),
          'utf8',
        )
        child = startCli(
          [
            'run',
            '--config',
            configPath,
            '--role',
            'reviewer',
            '--task',
            fixture.taskPath,
            '--json',
          ],
          { env: { ...process.env, CURSOR_API_KEY: 'configured-runtime-secret' } },
        )
        const completion = collectCli(child)
        await waitForFile(markerPath)
        fixturePid = Number.parseInt(await readFile(markerPath, 'utf8'), 10)
        assert.equal(child.kill(signal), true)

        const result = await completion
        assert.equal(result.signal, null, result.stderr)
        assert.equal(result.code, expectedCode, JSON.stringify(result))
        assert.equal(result.stderr, '')
        const envelope = JSON.parse(result.stdout)
        assert.equal(envelope.ok, true)
        assert.deepEqual(envelope.warnings, [])
        assert.equal(envelope.data.status, 'cancelled')
        assert.equal(envelope.data.error.code, 'cancelled')
      } finally {
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
        if (fixturePid !== undefined) {
          forceKill(fixturePid)
        }
        await rm(fixture.directory, { recursive: true, force: true })
      }
    }
  })

  it('uses one explicit executor override and never falls back to the default profile', async () => {
    const fixture = await createConfigFixture()
    try {
      const result = runCli(
        [
          'run',
          '--config',
          fixture.configPath,
          '--role',
          'reviewer',
          '--task',
          fixture.taskPath,
          '--executor',
          'codex-reviewer',
          '--json',
        ],
        { env: { ...process.env, OPENAI_API_KEY: 'codex-runtime-secret' } },
      )
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
      const data = successfulData(result)
      assert.equal(data.status, 'completed')
      assert.deepEqual(data.output, { message: 'codex' })
      const executor = data.executor as Record<string, unknown>
      assert.equal(executor.id, 'codex')
      assert.equal(executor.profileId, 'codex-reviewer')
      assert.equal(executor.requestedModel, 'codex-requested')
      await access(fixture.codexCapturePath)
      await assertMissing(fixture.cursorCapturePath)

      const unknown = runCli([
        'run',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        fixture.taskPath,
        '--executor',
        'missing-profile',
        '--json',
      ])
      assert.equal(unknown.status, 3)
      assert.equal(failedError(unknown).code, 'unknown_executor_profile')
      await assertMissing(fixture.cursorCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('returns blocked for one unavailable selected adapter without trying another profile', async () => {
    const fixture = await createConfigFixture()
    try {
      const result = runCli(
        [
          'run',
          '--config',
          fixture.configPath,
          '--role',
          'reviewer',
          '--task',
          fixture.taskPath,
          '--executor',
          'unavailable-pi',
          '--json',
        ],
        { env: { ...process.env, XAI_API_KEY: 'unavailable-profile-secret' } },
      )
      assert.equal(result.status, 4, `${result.stderr}\n${result.stdout}`)
      const data = successfulData(result)
      assert.equal(data.status, 'blocked')
      assert.equal((data.error as Record<string, unknown>).code, 'executor_unavailable')
      assert.equal((data.executor as Record<string, unknown>).profileId, 'unavailable-pi')
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.codexCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('finalizes host-native receipts through core semantics, including malformed nested responses', async () => {
    const fixture = await createConfigFixture()
    try {
      const compile = runCli([
        'compile',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        fixture.taskPath,
        '--executor',
        'host-reviewer',
        '--cwd',
        fixture.directory,
        '--run-id',
        'host-run',
        '--created-at',
        '2026-01-01T00:00:00.000Z',
        '--json',
      ])
      assert.equal(compile.status, 0, compile.stderr)
      const resolved = planFromCompile(compile)
      const content = resolved.plan.content as Record<string, unknown>
      assert.equal((content.executor as Record<string, unknown>).target, 'host')
      assert.equal((content.executor as Record<string, unknown>).capabilitySource, 'host-attested')
      assert.equal(Object.hasOwn(content.executor as object, 'adapterProtocol'), false)
      assert.equal((content.policy as Record<string, unknown>).pathEnforcement, 'host')

      const planPath = join(fixture.directory, 'host-plan.json')
      const receiptPath = join(fixture.directory, 'host-receipt.json')
      await writeFile(planPath, `${JSON.stringify(resolved)}\n`, 'utf8')
      await writeFile(
        receiptPath,
        `${JSON.stringify(hostReceipt(resolved, completedHostResponse))}\n`,
        'utf8',
      )
      const finalized = runCli(['finalize', '--plan', planPath, '--receipt', receiptPath, '--json'])
      assert.equal(finalized.status, 0, finalized.stderr)
      const result = successfulData(finalized)
      assert.equal(result.schema, 'rolekit/run-result@2')
      assert.equal(result.status, 'completed')
      assert.deepEqual(result.output, { message: 'host' })
      const executor = result.executor as Record<string, unknown>
      assert.equal(executor.id, 'native-review-host')
      assert.equal(executor.capabilitySource, 'host-attested')
      assert.equal(executor.requestedProvider, 'host-provider')
      assert.equal(executor.requestedModel, 'host-requested')
      assert.equal(executor.actualProvider, 'host-provider-actual')
      assert.equal(executor.actualModel, 'host-model-actual')

      const malformedReceiptPath = join(fixture.directory, 'host-malformed-receipt.json')
      await writeFile(
        malformedReceiptPath,
        `${JSON.stringify(
          hostReceipt(resolved, {
            status: 'completed',
            summary: 'Malformed host response.',
            output: { message: 'host' },
            artifacts: null,
            evidence: [],
          }),
        )}\n`,
        'utf8',
      )
      const malformed = runCli([
        'finalize',
        '--plan',
        planPath,
        '--receipt',
        malformedReceiptPath,
        '--json',
      ])
      assert.equal(malformed.status, 1, malformed.stderr)
      const malformedResult = successfulData(malformed)
      assert.equal(malformedResult.schema, 'rolekit/run-result@2')
      assert.equal(malformedResult.status, 'failed')
      assert.equal(
        (malformedResult.error as Record<string, unknown>).code,
        'invalid_executor_response',
      )
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.codexCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('strictly binds finalization identities, digests, and plan/receipt timestamp ordering', async () => {
    const fixture = await createConfigFixture()
    try {
      const compile = runCli([
        'compile',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        fixture.taskPath,
        '--executor',
        'host-reviewer',
        '--run-id',
        'bound-host-run',
        '--created-at',
        '2026-01-01T00:00:00.000Z',
        '--json',
      ])
      assert.equal(compile.status, 0, compile.stderr)
      const resolved = planFromCompile(compile)
      const planPath = join(fixture.directory, 'bound-plan.json')
      await writeFile(planPath, `${JSON.stringify(resolved)}\n`, 'utf8')

      for (const [name, overrides] of [
        ['planDigest', { planDigest: `sha256:${'0'.repeat(64)}` }],
        ['runId', { runId: 'other-run' }],
        ['taskId', { taskId: 'other-task' }],
        ['roleId', { roleId: 'other-role' }],
        [
          'executorId',
          {
            actualExecutor: {
              id: 'other-host',
              transport: 'remote',
            },
          },
        ],
        [
          'transport',
          {
            actualExecutor: {
              id: 'native-review-host',
              transport: 'in-process',
            },
          },
        ],
        [
          'createdAt-order',
          {
            startedAt: '2025-12-31T23:59:59.000Z',
            completedAt: '2026-01-01T00:00:01.000Z',
          },
        ],
        [
          'receipt-order',
          {
            startedAt: '2026-01-01T00:00:03.000Z',
            completedAt: '2026-01-01T00:00:02.000Z',
          },
        ],
      ] as const) {
        const receiptPath = join(fixture.directory, `${name}-receipt.json`)
        await writeFile(
          receiptPath,
          `${JSON.stringify(hostReceipt(resolved, { malformed: true }, overrides))}\n`,
          'utf8',
        )
        const result = runCli(['finalize', '--plan', planPath, '--receipt', receiptPath, '--json'])
        assert.equal(result.status, 3, `${name}: ${result.stderr}`)
        assert.equal(failedError(result).code, 'invalid_contract', name)
      }
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('rejects configured run for a host profile without fallback or adapter invocation', async () => {
    const fixture = await createConfigFixture()
    try {
      const result = runCli([
        'run',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        fixture.taskPath,
        '--executor',
        'host-reviewer',
        '--json',
      ])
      assert.equal(result.status, 4)
      assert.equal(failedError(result).code, 'host_execution_required')
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.codexCapturePath)
      await assertMissing(fixture.probeCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('lists and statically describes executor profiles, probing only when explicitly requested', async () => {
    const fixture = await createConfigFixture()
    const processSecret = 'probe-must-not-resolve-this-secret'
    try {
      const listed = runCli(['executors', 'list', '--config', fixture.configPath, '--json'])
      assert.equal(listed.status, 0, listed.stderr)
      assert.deepEqual(successfulData(listed).executors, [
        { profileId: 'codex-reviewer', mode: 'adapter', executorId: 'codex' },
        { profileId: 'cursor-default', mode: 'adapter', executorId: 'cursor' },
        { profileId: 'host-reviewer', mode: 'host', executorId: 'native-review-host' },
        { profileId: 'pi-rpc-reviewer', mode: 'adapter', executorId: 'pi-rpc' },
        { profileId: 'unavailable-pi', mode: 'adapter', executorId: 'pi' },
      ])

      const describeArgs = [
        'executors',
        'describe',
        '--config',
        fixture.configPath,
        '--executor',
        'cursor-default',
        '--cwd',
        fixture.directory,
        '--json',
      ]
      const described = runCli(describeArgs, {
        env: { ...process.env, CURSOR_API_KEY: processSecret },
      })
      assert.equal(described.status, 0, described.stderr)
      const staticDescription = successfulData(described)
      assert.equal(staticDescription.profileId, 'cursor-default')
      assert.equal(staticDescription.mode, 'adapter')
      assert.equal(staticDescription.executorId, 'cursor')
      assert.equal(staticDescription.adapterProtocol, 'rolekit/executor-adapter@1')
      assert.equal(staticDescription.adapterVersion, '1.0.0')
      assert.equal(staticDescription.requestedModel, 'cursor-requested')
      assert.equal(staticDescription.capabilitySource, 'adapter-verified')
      assert.deepEqual(staticDescription.capabilities, [
        'repository.read',
        'repository.write',
        'shell',
      ])
      assert.deepEqual(staticDescription.supportedPathEnforcement, ['advisory'])
      assert.deepEqual(staticDescription.requiredSecrets, ['CURSOR_API_KEY'])
      assert.equal(Object.hasOwn(staticDescription, 'probe'), false)
      assert.doesNotMatch(JSON.stringify(staticDescription), new RegExp(processSecret, 'u'))
      await assertMissing(fixture.probeCapturePath)

      const probed = runCli([...describeArgs.slice(0, -1), '--probe', '--json'], {
        env: { ...process.env, CURSOR_API_KEY: processSecret },
      })
      assert.equal(probed.status, 0, probed.stderr)
      const probedDescription = successfulData(probed)
      const { probe, ...probedStaticDescription } = probedDescription
      assert.deepEqual(probedStaticDescription, staticDescription)
      assert.equal((probe as Record<string, unknown>).available, true)
      const probeLines = (await readFile(fixture.probeCapturePath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      assert.equal(probeLines.length, 4)
      assert.deepEqual(
        probeLines.map((line) => line.args),
        [
          ['--version'],
          ['--help'],
          ['--output-format', 'stream-json', '--help'],
          ['--output-format', 'rolekit-invalid-value-canary', '--help'],
        ],
      )
      for (const line of probeLines) {
        assert.equal(line.cursorSecret, null)
        assert.equal(line.openAiSecret, null)
      }

      const literalSecret = 'literal-probe-secret-must-be-absent'
      const literalConfigPath = join(fixture.directory, 'literal-probe.yaml')
      await writeFile(
        literalConfigPath,
        [
          'schema: rolekit/config@1',
          'extends: [rolekit.yaml]',
          'roles: {}',
          'executors:',
          '  cursor-literal:',
          '    mode: adapter',
          '    adapter: cursor',
          '    options:',
          `      command: ${JSON.stringify(fixture.cursorCommand)}`,
          '      environment:',
          `        CURSOR_API_KEY: ${JSON.stringify(literalSecret)}`,
          '',
        ].join('\n'),
        'utf8',
      )
      const literalProbe = runCli(
        [
          'executors',
          'describe',
          '--config',
          literalConfigPath,
          '--executor',
          'cursor-literal',
          '--probe',
          '--json',
        ],
        { env: { ...process.env, CURSOR_API_KEY: processSecret } },
      )
      assert.equal(literalProbe.status, 0, literalProbe.stderr)
      assert.doesNotMatch(literalProbe.stdout, new RegExp(literalSecret, 'u'))
      const allProbeLines = (await readFile(fixture.probeCapturePath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      assert.equal(allProbeLines.length, 8)
      for (const line of allProbeLines.slice(4)) {
        assert.equal(line.cursorSecret, null)
        assert.equal(line.openAiSecret, null)
      }
      await assertMissing(fixture.cursorCapturePath)
      await assertMissing(fixture.codexCapturePath)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('cancels a slow executor probe with one JSON error envelope and conventional signal exit', {
    skip: process.platform === 'win32',
  }, async () => {
    const fixture = await createConfigFixture()
    const markerPath = join(fixture.directory, 'slow-probe.pid')
    let child: ChildProcessWithoutNullStreams | undefined
    let fixturePid: number | undefined
    try {
      const command = await createFixtureExecutable(
        fixture.directory,
        'cursor-slow-probe',
        resolve('test', 'fixtures', 'fake-cli.mjs'),
        ['cursor'],
        undefined,
        markerPath,
      )
      const configPath = join(fixture.directory, 'slow-probe.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles: {}',
          'executors:',
          '  slow-probe:',
          '    mode: adapter',
          '    adapter: cursor',
          '    options:',
          `      command: ${JSON.stringify(command)}`,
          '      environment:',
          '        CURSOR_API_KEY: { $env: CURSOR_API_KEY }',
          '',
        ].join('\n'),
        'utf8',
      )
      child = startCli(
        [
          'executors',
          'describe',
          '--config',
          configPath,
          '--executor',
          'slow-probe',
          '--probe',
          '--json',
        ],
        { env: { ...process.env, CURSOR_API_KEY: 'probe-process-secret' } },
      )
      const completion = collectCli(child)
      await waitForFile(markerPath)
      fixturePid = Number.parseInt(await readFile(markerPath, 'utf8'), 10)
      assert.equal(child.kill('SIGINT'), true)

      const result = await completion
      assert.equal(result.signal, null, result.stderr)
      assert.equal(result.code, 130, JSON.stringify(result))
      assert.equal(result.stderr, '')
      const envelope = JSON.parse(result.stdout)
      assert.equal(envelope.ok, false)
      assert.equal(envelope.error.code, 'cancelled')
      assert.deepEqual(envelope.warnings, [])
    } finally {
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      if (fixturePid !== undefined) {
        forceKill(fixturePid)
      }
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('uses one stable JSON envelope and the documented usage/config/blocked exit codes', async () => {
    const fixture = await createConfigFixture()
    try {
      const usage = runCli(['compile', '--config', fixture.configPath, '--json'])
      assert.equal(usage.status, 2)
      assert.equal(failedError(usage).code, 'usage_error')
      assert.equal(usage.stderr, '')

      const invalidConfigPath = join(fixture.directory, 'invalid.yaml')
      await writeFile(
        invalidConfigPath,
        'schema: rolekit/config@1\nroles: {}\nexecutors: {}\nunexpected: true\n',
        'utf8',
      )
      const invalid = runCli(['config', 'validate', '--config', invalidConfigPath, '--json'])
      assert.equal(invalid.status, 3)
      assert.equal(failedError(invalid).code, 'invalid_config')
      assert.equal(invalid.stderr, '')

      const host = runCli([
        'run',
        '--config',
        fixture.configPath,
        '--role',
        'reviewer',
        '--task',
        fixture.taskPath,
        '--executor',
        'host-reviewer',
        '--json',
      ])
      assert.equal(host.status, 4)
      assert.equal(failedError(host).code, 'host_execution_required')
      assert.equal(host.stderr, '')
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('prints the package version through the source CLI', () => {
    const result = runCli(['--version'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^0\.1\.0\s*$/u)
    assert.equal(result.stderr, '')
  })
})

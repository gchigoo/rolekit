import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve, win32 } from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

import { Type } from '@sinclair/typebox'

import { CliAdapterBase } from '../../src/adapters/cli/base.ts'
import {
  CliAbortedError,
  CliAdapterError,
  CliAuthenticationError,
  CliConfigurationError,
  CliExitError,
  CliIoError,
  CliOutputLimitError,
  CliProtocolError,
  CliSpawnError,
  CliTimeoutError,
} from '../../src/adapters/cli/errors.ts'
import type { CommonCliProcessOptions } from '../../src/adapters/cli/options.ts'
import {
  type CliProcessOptions,
  type CliProcessResult,
  runCliProcess,
} from '../../src/adapters/cli/process.ts'
import { CodexCliAdapter } from '../../src/adapters/codex/index.ts'
import { CursorCliAdapter } from '../../src/adapters/cursor/index.ts'
import { PiCliAdapter, type PiCliAdapterOptions } from '../../src/adapters/pi/index.ts'
import {
  GROK_45_SYSTEM_PROMPT_APPEND,
  hasExplicitPiThinking,
  resolvePiPromptProfile,
} from '../../src/adapters/pi/prompt.ts'
import { Rolekit } from '../../src/core/index.ts'
import type {
  ExecutionAdmission,
  ExecutionContext,
  ExecutorAdapter,
  ExecutorResponse,
  JsonSchema,
  PreparedExecutorOptions,
  RoleSpec,
  TaskPacket,
  TokenUsage,
} from '../../src/core/types.ts'

interface FixtureCapture {
  readonly mode: string
  readonly args: readonly string[]
  readonly prompt: string
  readonly environment: Readonly<Record<string, string | null>>
  readonly outputSchema: JsonSchema | null
}

const role: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
  schema: 'rolekit/role-spec@1',
  id: 'writer',
  description: 'Writes a bounded report.',
  instructions: 'Write only within the declared task boundary.',
  requiredCapabilities: ['repository.read', 'repository.write', 'shell'],
  inputSchema: Type.Object({ source: Type.String() }, { additionalProperties: false }),
  outputSchema: Type.Object({ message: Type.String() }, { additionalProperties: false }),
}

const task: TaskPacket<{ readonly source: string }> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'adapter-task',
  roleId: role.id,
  objective: 'Produce a report.',
  input: { source: 'README.md' },
  context: [],
  constraints: [],
  acceptanceCriteria: ['A report is returned.'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const directAdmission: ExecutionAdmission = {
  allowed: true,
  effectiveCapabilities: ['repository.read', 'repository.write', 'shell'],
  effectivePublicOptions: {},
  pathEnforcement: 'advisory',
  contextIsolation: {
    userConfig: 'unknown',
    projectInstructions: 'unknown',
    projectResources: 'unknown',
    environment: 'minimal',
    credentials: 'explicit',
  },
}

function directContext(
  runId: string,
  options: CommonCliProcessOptions = {},
  sensitiveValues: readonly string[] = [],
): ExecutionContext<CommonCliProcessOptions> {
  return {
    runId,
    cwd: process.cwd(),
    options,
    admission: directAdmission,
    sensitiveValues,
  }
}

const fixturePath = resolve('test', 'fixtures', 'fake-cli.mjs')
const longRunningFixturePath = resolve('test', 'fixtures', 'long-running-cli.mjs')
const COMPLETE_HELP_TOKENS = [
  '--mode',
  '--print',
  '--no-session',
  '--no-context-files',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--tools',
  '--system-prompt',
  '--extension',
  '--skill',
  '--prompt-template',
  '--provider',
  '--model',
  '--thinking',
  '--offline',
  '--append-system-prompt',
  '--json',
  '--ephemeral',
  '--color',
  '--skip-git-repo-check',
  '--ignore-user-config',
  '--ignore-rules',
  '-c',
  '-C',
  '--output-schema',
  '-o',
  '--sandbox',
  '--profile',
  '--print',
  '--output-format',
  '--workspace',
  '--trust',
  '--force',
  '--approve-mcps',
  '--help',
] as const
const COMPLETE_HELP = `${COMPLETE_HELP_TOKENS.join(' ')}\n`
const CODEX_NO_PROMPT_STDERR = 'Reading prompt from stdin...\nNo prompt provided via stdin.\n'
const CODEX_PROJECT_INVALID_STDERR =
  'Error loading config.toml: invalid type: string "rolekit-invalid-value-canary", expected usize\nin `project_doc_max_bytes`\n\n'
const CURSOR_INVALID_OUTPUT_FORMAT_STDERR =
  "error: invalid value 'rolekit-invalid-value-canary' for '--output-format <OUTPUT_FORMAT>'\n  [possible values: text, json, stream-json]\n\nFor more information, try '--help'.\n"
const PROBE_CAPTURE_ENVIRONMENT_KEYS = [
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PI_CODING_AGENT_DIR',
  'CODEX_HOME',
  'CURSOR_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'ROLEKIT_CANARY_TOKEN',
  'ROLEKIT_AMBIENT_SENTINEL',
] as const

interface AdapterExerciseOptions {
  readonly role?: RoleSpec
  readonly task?: TaskPacket
  readonly adapterOptions?: Readonly<Record<string, unknown>>
  readonly cwd?: string
}

async function createFixtureExecutable(
  directory: string,
  mode: string,
  sourcePath = fixturePath,
  fixedArgs: readonly string[] = [mode],
  helpOutput = COMPLETE_HELP,
  embeddedProbeCapturePath?: string,
  codexAcceptedBoundary = 'exact',
): Promise<string> {
  const codexProjectInvalidDiagnostic =
    'Error loading config.toml: invalid type: string "rolekit-invalid-value-canary", expected usize\nin `project_doc_max_bytes`\n\n'
  const codexWebInvalidDiagnostic =
    'Error loading config.toml: unknown variant `rolekit-invalid-value-canary`, expected one of `disabled`, `cached`, `indexed`, `live`\nin `web_search`\n\n'
  const scriptPath = join(directory, `fake-${mode}.mjs`)
  await writeFile(
    scriptPath,
    [
      '#!/usr/bin/env node',
      'import { appendFile } from "node:fs/promises"',
      'const incoming = process.argv.slice(2)',
      `const probeCapturePath = process.env.ROLEKIT_FAKE_PROBE_CAPTURE ?? ${JSON.stringify(embeddedProbeCapturePath)}`,
      `const codexAcceptedBoundary = ${JSON.stringify(codexAcceptedBoundary)}`,
      'const invalidValueCanary = incoming.includes("rolekit-invalid-value-canary") || incoming.some((argument) => argument.includes("rolekit-invalid-value-canary"))',
      'const cursorValueCanary = incoming[0] === "--output-format" && incoming.includes("--help")',
      'const piValueCanary = incoming[0] === "--mode" && incoming.includes("--offline") && !incoming.includes("--system-prompt")',
      'const behaviorAcceptedCanary = incoming[0] === "--rolekit-behavior-accepted"',
      'const behaviorRejectedCanary = incoming[0] === "--rolekit-behavior-rejected"',
      'const codexConfigValue = incoming[incoming.indexOf("-c") + 1] ?? ""',
      'const codexProjectConfigCanary = codexConfigValue.startsWith("project_doc_max_bytes=")',
      'const codexWebConfigCanary = codexConfigValue.startsWith("web_search=")',
      'const codexTypedConfigCanary = incoming[0] === "exec" && incoming.includes("--strict-config") && (codexProjectConfigCanary || codexWebConfigCanary)',
      'const missingFeature = process.env.ROLEKIT_FAKE_MISSING_FEATURE',
      'const ignoresCodexConfigCanary = (missingFeature === "codex-ignore-project-doc-config" && codexProjectConfigCanary) || (missingFeature === "codex-ignore-web-search-config" && codexWebConfigCanary)',
      'const rejectsCodexConfigCanary = (missingFeature === "codex-reject-project-doc-config" && codexProjectConfigCanary) || (missingFeature === "codex-reject-web-search-config" && codexWebConfigCanary)',
      `const probeEnvironmentKeys = ${JSON.stringify(PROBE_CAPTURE_ENVIRONMENT_KEYS)}`,
      'const captureProbe = async (phase) => { if (!probeCapturePath) return; const environment = Object.fromEntries(probeEnvironmentKeys.map((key) => [key, process.env[key] ?? null])); await appendFile(probeCapturePath, JSON.stringify({ phase, environment }) + "\\n", "utf8") }',
      'const writeCodexAcceptedBoundary = () => { if (codexAcceptedBoundary === "changed-wording") { process.stderr.write("Changed no-prompt diagnostic.\\n"); process.exitCode = 1; return } if (codexAcceptedBoundary === "extra-stdout") process.stdout.write("unexpected stdout\\n"); process.stderr.write("Reading prompt from stdin...\\nNo prompt provided via stdin.\\n"); if (codexAcceptedBoundary === "extra-stderr") process.stderr.write("unexpected stderr\\n"); if (codexAcceptedBoundary === "authentication") process.stderr.write("Authentication required before provider execution.\\n"); process.exitCode = codexAcceptedBoundary === "wrong-exit" ? 2 : 1 }',
      `if (incoming.includes('--version')) { await captureProbe('version'); process.stdout.write(${JSON.stringify(`fake-${mode} 1.0.0\n`)}) }`,
      `else if (incoming.includes('--help')) { await captureProbe(invalidValueCanary ? 'invalid-value' : cursorValueCanary ? 'accepted-value' : 'help'); if (invalidValueCanary) { process.stderr.write(${JSON.stringify(CURSOR_INVALID_OUTPUT_FORMAT_STDERR)}); process.exitCode = 2 } else { process.stdout.write(${JSON.stringify(helpOutput)}) } }`,
      `else if (piValueCanary) { await captureProbe(invalidValueCanary ? 'invalid-value' : 'accepted-value'); if (!invalidValueCanary) process.stdout.write('{"type":"session","version":3,"id":"rolekit-probe-session"}\\n') }`,
      `else if (behaviorAcceptedCanary) { process.stdout.write('accepted differential value\\n') }`,
      `else if (behaviorRejectedCanary) { process.stderr.write('typed invalid value rolekit-invalid-value-canary\\n'); process.exitCode = 2 }`,
      `else if (codexTypedConfigCanary) { await captureProbe(invalidValueCanary ? 'invalid-value' : 'accepted-value'); if (rejectsCodexConfigCanary) { process.stderr.write('Error loading config.toml: exact typed config control rejected\\n'); process.exitCode = 2 } else if (!invalidValueCanary || ignoresCodexConfigCanary) { writeCodexAcceptedBoundary() } else { process.stderr.write(codexProjectConfigCanary ? ${JSON.stringify(codexProjectInvalidDiagnostic)} : ${JSON.stringify(codexWebInvalidDiagnostic)}); process.exitCode = 1 } }`,
      `else { process.argv.splice(2, 0, ...${JSON.stringify(fixedArgs)}); await import(${JSON.stringify(pathToFileURL(sourcePath).href)}) }`,
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(scriptPath, 0o755)
  if (process.platform !== 'win32') {
    return scriptPath
  }

  const commandPath = join(directory, `fake-${mode}.cmd`)
  await writeFile(commandPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8')
  return commandPath
}

async function createNodeFixtureExecutable(
  directory: string,
  name: string,
  source: string,
): Promise<string> {
  const scriptPath = join(directory, `${name}.mjs`)
  await writeFile(scriptPath, source, 'utf8')
  await chmod(scriptPath, 0o755)
  if (process.platform !== 'win32') {
    return scriptPath
  }
  const commandPath = join(directory, `${name}.cmd`)
  await writeFile(commandPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8')
  return commandPath
}

async function createCodexSignalCanaryExecutable(
  directory: string,
  signalSide: 'accepted' | 'rejected',
): Promise<string> {
  return createNodeFixtureExecutable(
    directory,
    `codex-signal-${signalSide}`,
    [
      '#!/usr/bin/env node',
      'const incoming = process.argv.slice(2)',
      `const signalSide = ${JSON.stringify(signalSide)}`,
      `const help = ${JSON.stringify(COMPLETE_HELP)}`,
      `const acceptedBoundary = ${JSON.stringify(CODEX_NO_PROMPT_STDERR)}`,
      `const rejectedBoundary = ${JSON.stringify(CODEX_PROJECT_INVALID_STDERR)}`,
      'const invalid = incoming.some((argument) => argument.includes("rolekit-invalid-value-canary"))',
      'const writeThenSignal = async (stderr) => { await new Promise((resolvePromise) => process.stderr.write(stderr, resolvePromise)); process.kill(process.pid, "SIGTERM"); setInterval(() => {}, 1000) }',
      'if (incoming.includes("--version")) { process.stdout.write("fake-codex 0.146.0\\n") }',
      'else if (incoming.includes("--help")) { process.stdout.write(help) }',
      'else if (incoming[0] === "exec" && incoming.includes("--strict-config")) {',
      '  if ((!invalid && signalSide === "accepted") || (invalid && signalSide === "rejected")) {',
      '    await writeThenSignal(invalid ? rejectedBoundary : acceptedBoundary)',
      '  } else {',
      '    process.stderr.write(invalid ? rejectedBoundary : acceptedBoundary)',
      '    process.exitCode = 1',
      '  }',
      '}',
      'else { throw new Error("Unexpected signal fixture arguments: " + incoming.join(" ")) }',
      '',
    ].join('\n'),
  )
}

async function createSentinelUnrelatedCursorExecutable(directory: string): Promise<string> {
  return createNodeFixtureExecutable(
    directory,
    'cursor-sentinel-unrelated',
    [
      '#!/usr/bin/env node',
      'const incoming = process.argv.slice(2)',
      `const help = ${JSON.stringify(COMPLETE_HELP)}`,
      'const invalid = incoming.includes("rolekit-invalid-value-canary")',
      'if (incoming.includes("--version")) { process.stdout.write("fake-cursor 1.0.0\\n") }',
      'else if (incoming.includes("--help")) {',
      '  if (invalid) {',
      '    process.stderr.write("provider unavailable after echoing rolekit-invalid-value-canary\\n")',
      '    process.exitCode = 7',
      '  } else {',
      '    process.stdout.write(help)',
      '  }',
      '}',
      'else { throw new Error("Unexpected Cursor fixture arguments: " + incoming.join(" ")) }',
      '',
    ].join('\n'),
  )
}

interface ProbeStoreCapture {
  readonly phase: 'version' | 'help' | 'accepted-value' | 'invalid-value'
  readonly environment: Readonly<Record<string, string | null>>
  readonly storePaths: readonly string[]
  readonly stateObserved: boolean
}

async function createContaminatingCodexExecutable(
  directory: string,
  capturePath: string,
  stateFileName: string,
): Promise<string> {
  return createNodeFixtureExecutable(
    directory,
    'codex-cross-process-contamination',
    [
      '#!/usr/bin/env node',
      'import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"',
      'import { join } from "node:path"',
      'const incoming = process.argv.slice(2)',
      `const capturePath = ${JSON.stringify(capturePath)}`,
      `const stateFileName = ${JSON.stringify(stateFileName)}`,
      `const help = ${JSON.stringify(COMPLETE_HELP)}`,
      `const acceptedBoundary = ${JSON.stringify(CODEX_NO_PROMPT_STDERR)}`,
      `const rejectedBoundary = ${JSON.stringify(CODEX_PROJECT_INVALID_STDERR)}`,
      `const environmentKeys = ${JSON.stringify(PROBE_CAPTURE_ENVIRONMENT_KEYS)}`,
      'const invalid = incoming.some((argument) => argument.includes("rolekit-invalid-value-canary"))',
      'const storePaths = () => {',
      '  const paths = [process.env.CODEX_HOME, process.env.HOME, process.env.USERPROFILE, process.env.APPDATA, process.env.LOCALAPPDATA]',
      '  if (process.platform === "win32" && process.env.HOMEDRIVE && process.env.HOMEPATH) paths.push(process.env.HOMEDRIVE + process.env.HOMEPATH)',
      '  return [...new Set(paths.filter((value) => typeof value === "string" && value.length > 0))]',
      '}',
      'const observesState = async () => {',
      '  for (const storePath of storePaths()) {',
      '    try { await readFile(join(storePath, stateFileName), "utf8"); return true } catch {}',
      '  }',
      '  return false',
      '}',
      'const capture = async (phase) => {',
      '  const environment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key] ?? null]))',
      '  const stateObserved = await observesState()',
      '  await appendFile(capturePath, JSON.stringify({ phase, environment, storePaths: storePaths(), stateObserved }) + "\\n", "utf8")',
      '  return stateObserved',
      '}',
      'const writeCredentialState = async () => {',
      '  const state = JSON.stringify({ explicit: process.env.OPENAI_API_KEY ?? null, ambient: process.env.ROLEKIT_CANARY_TOKEN ?? null })',
      '  for (const storePath of storePaths()) { await mkdir(storePath, { recursive: true }); await writeFile(join(storePath, stateFileName), state, "utf8") }',
      '}',
      'if (incoming.includes("--version")) {',
      '  await capture("version")',
      '  await writeCredentialState()',
      '  process.stdout.write("fake-codex 0.146.0\\n")',
      '}',
      'else if (incoming.includes("--help")) {',
      '  await capture("help")',
      '  await writeCredentialState()',
      '  process.stdout.write(help)',
      '}',
      'else if (incoming[0] === "exec" && incoming.includes("--strict-config")) {',
      '  const stateObserved = await capture(invalid ? "invalid-value" : "accepted-value")',
      '  if (stateObserved) {',
      '    process.stderr.write("credential/config/cache state leaked from version/help\\n")',
      '    process.exitCode = 1',
      '  } else {',
      '    process.stderr.write(invalid ? rejectedBoundary : acceptedBoundary)',
      '    process.exitCode = 1',
      '  }',
      '}',
      'else { throw new Error("Unexpected contamination fixture arguments: " + incoming.join(" ")) }',
      '',
    ].join('\n'),
  )
}

async function exerciseAdapter(
  adapter: ExecutorAdapter,
  mode: 'cursor' | 'pi' | 'codex',
  exerciseOptions: AdapterExerciseOptions = {},
): Promise<{
  readonly capture: FixtureCapture
  readonly commandEvidence: string | undefined
  readonly model: string | undefined
  readonly resultSurface: string
  readonly usage: TokenUsage
}> {
  const executionRole = exerciseOptions.role ?? role
  const executionTask = exerciseOptions.task ?? task
  const directory = await mkdtemp(join(tmpdir(), `rolekit-${mode}-test-`))
  const capturePath = join(directory, 'capture.json')
  try {
    const providedOptions = exerciseOptions.adapterOptions ?? {}
    const providedEnvironment =
      typeof providedOptions.environment === 'object' &&
      providedOptions.environment !== null &&
      !Array.isArray(providedOptions.environment)
        ? (providedOptions.environment as Readonly<Record<string, string>>)
        : {}
    const options = {
      command: await createFixtureExecutable(directory, mode),
      timeoutMs: 10_000,
      ...providedOptions,
      environment: {
        ROLEKIT_FAKE_CAPTURE: capturePath,
        ...providedEnvironment,
      },
    }
    const rolekit = new Rolekit({
      roles: [executionRole],
      adapters: [adapter],
      createRunId: () => `${mode}-run`,
    })
    const result = await rolekit.run(executionTask, {
      executorId: adapter.id,
      cwd: exerciseOptions.cwd ?? process.cwd(),
      adapterOptions: options,
    })
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, { message: mode })
    assert.equal(result.artifacts[0]?.provenance.executorId, adapter.id)
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as FixtureCapture
    const commandEvidence = result.evidence.find((entry) => entry.kind === 'command')?.value
    return {
      capture,
      commandEvidence,
      model: result.executor.actualModel,
      resultSurface: JSON.stringify(result),
      usage: result.usage,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function collectSurfaceText(value: unknown): string {
  const strings: string[] = []
  const visited = new WeakSet<object>()
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      strings.push(candidate)
      return
    }
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
      return
    }
    if (visited.has(candidate)) {
      return
    }
    visited.add(candidate)
    for (const key of Reflect.ownKeys(candidate)) {
      try {
        visit(Reflect.get(candidate, key))
      } catch {
        // Hostile/native getters are not required to participate in the assertion.
      }
    }
  }
  visit(value)
  return strings.join('\n')
}

function operationError(code: string, operation: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${operation} failed with ${code}`), {
    code,
    syscall: operation,
  })
}

async function exerciseCodexMode(
  adapter: CodexCliAdapter,
  mode: 'codex' | 'codex-missing-output' | 'codex-malformed-output' = 'codex',
): Promise<{
  readonly code: string | undefined
  readonly retryable: boolean | undefined
  readonly status: string
  readonly message: string | undefined
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-codex-mode-'))
  try {
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    const result = await rolekit.run(task, {
      executorId: adapter.id,
      cwd: process.cwd(),
      adapterOptions: {
        command: await createFixtureExecutable(directory, mode),
        environment: {},
      },
    })
    return {
      code: result.error?.code,
      retryable: result.error?.retryable,
      status: result.status,
      message: result.error?.message,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function probeWithHelp(
  adapter: ExecutorAdapter,
  mode: string,
  adapterOptions: Readonly<Record<string, unknown>>,
  helpTokens: readonly string[],
) {
  const directory = await mkdtemp(join(tmpdir(), `rolekit-${mode}-probe-`))
  try {
    const command = await createFixtureExecutable(
      directory,
      `${mode}-probe`,
      fixturePath,
      [mode],
      `${helpTokens.join(' ')}\n`,
    )
    const prepared = adapter.prepareOptions({ command, ...adapterOptions })
    return await adapter.probe(prepared, { cwd: directory })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

interface ProbeEnvironmentCapture {
  readonly phase: 'version' | 'help' | 'accepted-value' | 'invalid-value'
  readonly environment: Readonly<Record<string, string | null>>
}

async function captureProbeEnvironments(
  adapter: ExecutorAdapter,
  mode: 'cursor' | 'pi' | 'codex',
  adapterOptions: Readonly<Record<string, unknown>> = {},
): Promise<{
  readonly captures: readonly ProbeEnvironmentCapture[]
  readonly prepared: PreparedExecutorOptions
}> {
  const directory = await mkdtemp(join(tmpdir(), `rolekit-${mode}-probe-environment-`))
  const capturePath = join(directory, 'probe-environment.jsonl')
  try {
    const providedEnvironment =
      typeof adapterOptions.environment === 'object' &&
      adapterOptions.environment !== null &&
      !Array.isArray(adapterOptions.environment)
        ? (adapterOptions.environment as Readonly<Record<string, string>>)
        : {}
    const command = await createFixtureExecutable(
      directory,
      `${mode}-environment-probe`,
      fixturePath,
      [mode],
      COMPLETE_HELP,
      capturePath,
    )
    const prepared = adapter.prepareOptions({
      ...adapterOptions,
      command,
      environment: providedEnvironment,
    })
    const probe = await adapter.probe(prepared, { cwd: directory })
    assert.equal(probe.available, true, probe.diagnostic)
    const captures = (await readFile(capturePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ProbeEnvironmentCapture)
    assert.deepEqual(
      captures.map((capture) => capture.phase),
      ['version', 'help', 'accepted-value', 'invalid-value'],
    )
    return { captures, prepared }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function capturedProbeEnvironment(
  captures: readonly ProbeEnvironmentCapture[],
  phase: ProbeEnvironmentCapture['phase'] = 'version',
): Readonly<Record<string, string | null>> {
  const environment = captures.find((capture) => capture.phase === phase)?.environment
  assert.ok(environment, phase)
  return environment
}

function isolatedProbeHome(environment: Readonly<Record<string, string | null>>): string {
  const values = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].map((key) => environment[key])
  assert.ok(values.every((value): value is string => typeof value === 'string'))
  assert.equal(new Set(values).size, 1)
  const home = values[0]
  if (typeof home !== 'string') {
    throw new Error('Probe user home was not isolated.')
  }
  return home
}

function assertInheritedProbeHome(environment: Readonly<Record<string, string | null>>): void {
  const keys =
    process.platform === 'win32'
      ? (['USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const)
      : (['HOME'] as const)
  for (const key of keys) {
    assert.equal(environment[key], process.env[key] ?? null, key)
  }
}

type InvalidBehaviorOutcome =
  | { readonly kind: 'throw'; readonly error: unknown }
  | { readonly kind: 'resolve'; readonly result: CliProcessResult }

class DifferentialCanaryAdapter extends CliAdapterBase<CommonCliProcessOptions> {
  readonly id = 'differential-canary'
  protected readonly displayName = 'Differential canary fixture'
  protected readonly defaultCommand = 'differential-canary'
  protected readonly defaultCapabilities = ['repository.read'] as const
  readonly #invalidOutcome: InvalidBehaviorOutcome

  constructor(invalidOutcome: InvalidBehaviorOutcome) {
    super()
    this.#invalidOutcome = invalidOutcome
  }

  protected override compatibilityBehaviorChecks() {
    return [
      {
        feature: 'behavior:typed-invalid-rejection',
        acceptedArgs: ['--rolekit-behavior-accepted'],
        rejectedArgs: ['--rolekit-behavior-rejected', 'rolekit-invalid-value-canary'],
        matchesAcceptedResult: (result: CliProcessResult) =>
          result.exitCode === 0 &&
          result.stdout === 'accepted differential value\n' &&
          result.stderr === '',
        matchesRejectedError: (error: unknown) =>
          error instanceof CliExitError &&
          error.exitCode === 2 &&
          error.stdout === '' &&
          error.stderr === 'typed invalid value rolekit-invalid-value-canary\n',
      },
    ]
  }

  protected override runCompatibilityBehaviorProcess(
    options: CliProcessOptions,
  ): Promise<CliProcessResult> {
    if (options.args[0] !== '--rolekit-behavior-rejected') {
      return runCliProcess(options)
    }
    if (this.#invalidOutcome.kind === 'throw') {
      return Promise.reject(this.#invalidOutcome.error)
    }
    return Promise.resolve(this.#invalidOutcome.result)
  }

  protected async executeCli(
    _role: RoleSpec,
    _task: TaskPacket,
    _context: ExecutionContext<CommonCliProcessOptions>,
    _options: CommonCliProcessOptions,
    _signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    throw new Error('Differential canary fixture does not execute tasks.')
  }
}

async function exerciseEnvironmentFailure(adapter: ExecutorAdapter, key: string, secret: string) {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-environment-failure-'))
  try {
    const command = await createFixtureExecutable(
      directory,
      `fail-environment-${key}`,
      longRunningFixturePath,
      ['fail-environment', key],
    )
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    return await rolekit.run(task, {
      executorId: adapter.id,
      cwd: process.cwd(),
      adapterOptions: {
        command,
        environment: { [key]: secret },
      },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function exerciseCursorFailure(fixtureArgs: readonly string[]): Promise<{
  readonly code: string | undefined
  readonly message: string | undefined
  readonly retryable: boolean | undefined
  readonly status: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-cursor-failure-'))
  try {
    const command = await createFixtureExecutable(
      directory,
      'cursor-failure',
      longRunningFixturePath,
      fixtureArgs,
    )
    const rolekit = new Rolekit({ roles: [role], adapters: [new CursorCliAdapter()] })
    const result = await rolekit.run(task, {
      executorId: 'cursor',
      cwd: process.cwd(),
      adapterOptions: { command },
    })
    return {
      code: result.error?.code,
      message: result.error?.message,
      retryable: result.error?.retryable,
      status: result.status,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

class FailureProbeAdapter extends CliAdapterBase {
  readonly id = 'failure-probe'
  protected readonly displayName = 'Failure probe'
  protected readonly defaultCommand = process.execPath
  protected readonly defaultCapabilities = ['repository.read'] as const

  readonly #failure: unknown

  constructor(failure: unknown) {
    super()
    this.#failure = failure
  }

  protected async executeCli(
    _role: RoleSpec,
    _task: TaskPacket,
    _context: ExecutionContext,
    _options: CommonCliProcessOptions,
    _signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    throw this.#failure
  }
}

class TypedBoundaryProbeAdapter extends CliAdapterBase {
  readonly id = 'typed-boundary-probe'
  protected readonly displayName = 'Typed boundary probe'
  protected readonly defaultCommand = process.execPath
  protected readonly defaultCapabilities = ['repository.read'] as const
  protected override readonly authenticationEnvironmentKeys = ['PROBE_API_KEY'] as const

  readonly #failure: unknown

  constructor(failure: unknown) {
    super()
    this.#failure = failure
  }

  rethrowExistingProtocol(secret: string): void {
    this.parseProtocol({ environment: { PROBE_API_KEY: secret } }, [secret], () => {
      throw new CliProtocolError(`existing protocol error exposed ${secret}`)
    })
  }

  protected async executeCli(
    _role: RoleSpec,
    _task: TaskPacket,
    _context: ExecutionContext,
    _options: CommonCliProcessOptions,
    _signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    throw this.#failure
  }
}

class InflightProbeAdapter extends CliAdapterBase {
  readonly id = 'inflight-probe'
  protected readonly displayName = 'Inflight probe'
  protected readonly defaultCommand = process.execPath
  protected readonly defaultCapabilities = ['repository.read'] as const
  invocationCount = 0

  readonly #firstGate: Promise<void>
  #releaseFirst: (() => void) | undefined

  constructor() {
    super()
    this.#firstGate = new Promise<void>((resolvePromise) => {
      this.#releaseFirst = resolvePromise
    })
  }

  releaseFirst(): void {
    this.#releaseFirst?.()
  }

  protected async executeCli(
    _role: RoleSpec,
    _task: TaskPacket,
    _context: ExecutionContext,
    _options: CommonCliProcessOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    this.invocationCount += 1
    if (this.invocationCount === 1) {
      await this.#firstGate
      return {
        status: 'completed',
        summary: 'First direct execution completed.',
        output: { message: 'first' },
        artifacts: [{ name: 'report', kind: 'text', content: 'first' }],
        evidence: [],
      }
    }

    await new Promise<void>((resolvePromise) => {
      if (signal.aborted) {
        resolvePromise()
        return
      }
      signal.addEventListener('abort', () => resolvePromise(), { once: true })
    })
    return {
      status: 'cancelled',
      summary: 'Second direct execution cancelled.',
      artifacts: [],
      evidence: [],
      error: { code: 'cancelled', message: 'Cancelled.', retryable: false },
    }
  }
}

describe('CLI adapters', () => {
  it('runs Cursor in forced headless stream mode for a write task', async () => {
    const { capture, model } = await exerciseAdapter(new CursorCliAdapter(), 'cursor')
    assert.equal(model, 'cursor/actual-model')
    assert.ok(capture.args.includes('--print'))
    assert.ok(capture.args.includes('stream-json'))
    assert.ok(capture.args.includes('--force'))
    assert.ok(!capture.args.includes('plan'))
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Final response JSON Schema/u)
    assert.match(capture.prompt, /Write only within the declared task boundary\./u)
  })

  it('preserves root-local output references through the Cursor prompt schema path', async () => {
    const localReferenceOutputSchema: JsonSchema<{ readonly message: string }> = {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { $ref: '#/$defs/leaf' },
      },
      $defs: {
        leaf: { type: 'string' },
      },
    }
    const localReferenceRole: RoleSpec<{ readonly source: string }, { readonly message: string }> =
      {
        ...role,
        id: 'local-reference-writer',
        outputSchema: localReferenceOutputSchema,
      }
    const localReferenceTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: localReferenceRole.id,
    }

    const { capture } = await exerciseAdapter(new CursorCliAdapter(), 'cursor', {
      role: localReferenceRole,
      task: localReferenceTask,
    })

    assert.match(capture.prompt, /Final response JSON Schema/u)
    assert.match(capture.prompt, /#\/\$defs\/leaf/u)
  })

  it('runs Cursor in plan mode for a read-only task', async () => {
    const readOnlyRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'reader',
      requiredCapabilities: ['repository.read'],
    }
    const readOnlyTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: readOnlyRole.id,
    }
    const { capture } = await exerciseAdapter(new CursorCliAdapter(), 'cursor', {
      role: readOnlyRole,
      task: readOnlyTask,
    })
    assert.ok(capture.args.includes('plan'))
    assert.ok(!capture.args.includes('--force'))
  })

  it('runs Pi in ephemeral JSON mode with tools derived from capabilities', async () => {
    const { capture, model } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: { model: 'anthropic/claude-sonnet-4' },
    })
    assert.equal(model, 'fixture/pi-model')
    assert.ok(capture.args.includes('--no-session'))
    const toolsIndex = capture.args.indexOf('--tools')
    assert.equal(capture.args[toolsIndex + 1], 'read,grep,find,ls,edit,write,bash')
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Final response JSON Schema/u)
    assert.ok(!capture.args.includes('--append-system-prompt'))
    assert.ok(!capture.args.includes('--thinking'))
  })

  it('runs Codex exec with a temporary output schema and workspace sandbox', async () => {
    const { capture, model } = await exerciseAdapter(new CodexCliAdapter(), 'codex')
    assert.equal(model, undefined)
    assert.ok(capture.args.includes('exec'))
    assert.ok(capture.args.includes('--output-schema'))
    assert.ok(capture.args.includes('workspace-write'))
    assert.ok(!capture.args.includes('-'))

    assert.equal(capture.outputSchema?.type, 'object')
    assert.equal(Object.hasOwn(capture.outputSchema ?? {}, 'anyOf'), false)
    assert.equal(capture.outputSchema?.additionalProperties, false)
    const properties = capture.outputSchema?.properties as Readonly<Record<string, unknown>>
    assert.deepEqual(
      new Set(capture.outputSchema?.required as string[]),
      new Set(Object.keys(properties)),
    )
    assert.equal(Object.hasOwn(properties, 'usage'), false)
    assert.equal(Object.hasOwn(properties, 'model'), false)

    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.match(capture.prompt, /Role output JSON Schema/u)
    assert.doesNotMatch(capture.prompt, /Final response JSON Schema/u)
    assert.match(capture.prompt, /Return exactly one JSON object as the final response\./u)
    assert.match(capture.prompt, /output.*null unless status is `completed`/u)
    assert.match(capture.prompt, /error.*null when status is `completed`/u)
    assert.match(capture.prompt, /contentJson.*detailsJson.*JSON text/su)
    assert.match(capture.prompt, /all fields.*required/iu)
  })

  it('uses the last documented Codex turn usage, ignores spoofed events, and keeps host duration', async () => {
    const { usage } = await exerciseAdapter(new CodexCliAdapter(), 'codex')
    const { durationMs, ...tokenUsage } = usage

    assert.deepEqual(tokenUsage, {
      inputTokens: 12,
      outputTokens: 7,
      cachedInputTokens: 4,
    })
    assert.equal(typeof durationMs, 'number')
    assert.notEqual(durationMs, 9_876_543)
    assert.ok((durationMs ?? Number.POSITIVE_INFINITY) < 10_000)
  })

  it('blocks before invoking Codex when the role output schema is unsupported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-codex-unsupported-schema-'))
    const capturePath = join(directory, 'capture.json')
    try {
      const unsupportedRole: RoleSpec<{ readonly source: string }, { readonly maybe?: string }> = {
        ...role,
        id: 'optional-output-writer',
        outputSchema: Type.Object(
          { maybe: Type.Optional(Type.String()) },
          { additionalProperties: false },
        ),
      }
      const unsupportedTask: TaskPacket<{ readonly source: string }> = {
        ...task,
        roleId: unsupportedRole.id,
      }
      const adapter = new CodexCliAdapter()
      const rolekit = new Rolekit({ roles: [unsupportedRole], adapters: [adapter] })
      const result = await rolekit.run(unsupportedTask, {
        executorId: adapter.id,
        cwd: process.cwd(),
        adapterOptions: {
          command: await createFixtureExecutable(directory, 'codex'),
          environment: { ROLEKIT_FAKE_CAPTURE: capturePath },
        },
      })

      assert.equal(result.status, 'blocked')
      assert.equal(result.error?.code, 'unsupported_output_schema')
      await assert.rejects(access(capturePath))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails differential canaries closed for every indeterminate invalid-side outcome', async () => {
    const cases: readonly [string, InvalidBehaviorOutcome][] = [
      ['timeout', { kind: 'throw', error: new CliTimeoutError('invalid canary timed out') }],
      ['cancelled', { kind: 'throw', error: new CliAbortedError('invalid canary aborted') }],
      [
        'output-limit',
        { kind: 'throw', error: new CliOutputLimitError('invalid canary exceeded output') },
      ],
      ['spawn', { kind: 'throw', error: new CliSpawnError('invalid canary did not spawn') }],
      ['io', { kind: 'throw', error: new CliIoError('invalid canary I/O failed') }],
      [
        'unrelated-exit',
        {
          kind: 'throw',
          error: new CliExitError('invalid canary exited for an unrelated reason', {
            exitCode: 7,
            stdout: 'unrelated stdout\n',
            stderr: 'provider unavailable\n',
          }),
        },
      ],
      [
        'signal-like-exit',
        {
          kind: 'throw',
          error: new CliExitError('invalid canary terminated without a trustworthy exit code', {
            stderr: 'terminated by signal\n',
          }),
        },
      ],
      ['malformed-throw', { kind: 'throw', error: { malformed: true } }],
      [
        'malformed-result',
        {
          kind: 'resolve',
          result: {
            exitCode: 0,
            stdout: 'not a typed rejection\n',
            stderr: '',
            durationMs: 1,
            executablePath: 'fixture',
            commandDisplay: 'fixture --rolekit-behavior-rejected',
          },
        },
      ],
    ]
    const readRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'differential-reader',
      requiredCapabilities: ['repository.read'],
    }
    const readTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: readRole.id,
    }

    for (const [name, invalidOutcome] of cases) {
      const directory = await mkdtemp(join(tmpdir(), `rolekit-differential-${name}-`))
      try {
        const adapter = new DifferentialCanaryAdapter(invalidOutcome)
        const command = await createFixtureExecutable(directory, `differential-${name}`)
        const prepared = adapter.prepareOptions({ command })
        const probe = await adapter.probe(prepared, { cwd: directory })
        assert.equal(probe.featureChecks['behavior:typed-invalid-rejection'], false, name)
        assert.equal(probe.available, false, name)
        assert.equal(adapter.admit(readRole, readTask, prepared, probe).allowed, false, name)

        const result = await new Rolekit({ roles: [readRole], adapters: [adapter] }).run(readTask, {
          executorId: adapter.id,
          cwd: directory,
          adapterOptions: { command },
          runId: `differential-${name}`,
        })
        assert.equal(result.status, 'blocked', name)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  it('fails real signaled Codex accepted and rejected boundaries closed', {
    skip: process.platform === 'win32',
  }, async () => {
    for (const signalSide of ['accepted', 'rejected'] as const) {
      const directory = await mkdtemp(join(tmpdir(), `rolekit-codex-${signalSide}-signal-`))
      try {
        const adapter = new CodexCliAdapter()
        const command = await createCodexSignalCanaryExecutable(directory, signalSide)
        const prepared = adapter.prepareOptions({ command })
        const probe = await adapter.probe(prepared, { cwd: directory })

        assert.equal(
          probe.featureChecks['behavior:typed-config-project-doc-max-bytes-zero'],
          false,
          signalSide,
        )
        assert.equal(probe.available, false, signalSide)
        assert.equal(adapter.admit(role, task, prepared, probe).allowed, false, signalSide)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  it('rejects sentinel-bearing unrelated exits through the Cursor exact-value canary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-cursor-unrelated-sentinel-'))
    try {
      const adapter = new CursorCliAdapter()
      const command = await createSentinelUnrelatedCursorExecutable(directory)
      const prepared = adapter.prepareOptions({ command })
      const probe = await adapter.probe(prepared, { cwd: directory })

      assert.equal(probe.featureChecks['output:stream-json'], false)
      assert.equal(probe.available, false)
      assert.equal(adapter.admit(role, task, prepared, probe).allowed, false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('matches the complete Codex no-prompt boundary and rejects every extra diagnostic', async () => {
    const cases = [
      ['exact', true],
      ['extra-stdout', false],
      ['extra-stderr', false],
      ['authentication', false],
      ['changed-wording', false],
      ['wrong-exit', false],
    ] as const

    for (const [boundary, expectedAvailable] of cases) {
      const directory = await mkdtemp(join(tmpdir(), `rolekit-codex-boundary-${boundary}-`))
      try {
        const command = await createFixtureExecutable(
          directory,
          `codex-boundary-${boundary}`,
          fixturePath,
          ['codex'],
          COMPLETE_HELP,
          undefined,
          boundary,
        )
        const adapter = new CodexCliAdapter()
        const prepared = adapter.prepareOptions({ command })
        const probe = await adapter.probe(prepared, { cwd: directory })
        assert.equal(
          probe.featureChecks['behavior:typed-config-project-doc-max-bytes-zero'],
          expectedAvailable,
          boundary,
        )
        assert.equal(probe.available, expectedAvailable, boundary)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  it('keeps Codex descriptor and admissions capability-consistent before and after probing', () => {
    const readOnlyRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'codex-reader',
      requiredCapabilities: ['repository.read'],
    }
    const readOnlyTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: readOnlyRole.id,
    }
    const webRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...readOnlyRole,
      id: 'codex-web-reader',
      requiredCapabilities: ['repository.read', 'web'],
    }
    const webTask: TaskPacket<{ readonly source: string }> = {
      ...readOnlyTask,
      roleId: webRole.id,
    }
    const adapter = new CodexCliAdapter()
    const prepared = adapter.prepareOptions({ webSearch: true })
    const descriptor = adapter.inspect(prepared)
    const successfulProbe = {
      available: true,
      featureChecks: {
        'behavior:typed-config-project-doc-max-bytes-zero': true,
        'behavior:typed-config-web-search-live': true,
      },
    } as const
    const staticNonWebAdmission = adapter.admit(readOnlyRole, readOnlyTask, prepared)
    const runtimeNonWebAdmission = adapter.admit(
      readOnlyRole,
      readOnlyTask,
      prepared,
      successfulProbe,
    )
    const staticWebAdmission = adapter.admit(webRole, webTask, prepared)
    const runtimeWebAdmission = adapter.admit(webRole, webTask, prepared, successfulProbe)
    const failedWebAdmission = adapter.admit(webRole, webTask, prepared, {
      available: true,
      featureChecks: {
        'behavior:typed-config-project-doc-max-bytes-zero': true,
        'behavior:typed-config-web-search-live': false,
      },
    })

    assert.deepEqual(descriptor.capabilities, [
      'repository.read',
      'repository.write',
      'shell',
      'web',
    ])
    assert.ok(descriptor.features.permissionCombinations.includes('repository.read+web'))
    assert.equal(descriptor.features.contextIsolation.projectInstructions, 'unknown')
    for (const admission of [staticNonWebAdmission, staticWebAdmission]) {
      assert.deepEqual(
        {
          allowed: admission.allowed,
          effectiveCapabilities: admission.effectiveCapabilities,
          projectInstructions: admission.contextIsolation.projectInstructions,
          projectDocMaxBytes: admission.effectivePublicOptions.projectDocMaxBytes,
          sandbox: admission.effectivePublicOptions.sandbox,
        },
        {
          allowed: true,
          effectiveCapabilities: ['repository.read', 'shell', 'web'],
          projectInstructions: 'unknown',
          projectDocMaxBytes: 'unknown',
          sandbox: 'read-only',
        },
      )
    }
    for (const admission of [runtimeNonWebAdmission, runtimeWebAdmission]) {
      assert.deepEqual(
        {
          allowed: admission.allowed,
          effectiveCapabilities: admission.effectiveCapabilities,
          projectInstructions: admission.contextIsolation.projectInstructions,
          projectDocMaxBytes: admission.effectivePublicOptions.projectDocMaxBytes,
          sandbox: admission.effectivePublicOptions.sandbox,
        },
        {
          allowed: true,
          effectiveCapabilities: ['repository.read', 'shell', 'web'],
          projectInstructions: 'isolated',
          projectDocMaxBytes: 0,
          sandbox: 'read-only',
        },
      )
    }
    assert.equal(failedWebAdmission.allowed, false)
    assert.equal(failedWebAdmission.effectiveCapabilities.includes('web'), false)
  })

  it('reports exact Codex workspace-write capabilities in static and runtime admission', () => {
    const adapter = new CodexCliAdapter()
    const prepared = adapter.prepareOptions({})
    const staticAdmission = adapter.admit(role, task, prepared)
    const runtimeAdmission = adapter.admit(role, task, prepared, {
      available: true,
      featureChecks: { 'behavior:typed-config-project-doc-max-bytes-zero': true },
    })

    for (const admission of [staticAdmission, runtimeAdmission]) {
      assert.deepEqual(
        {
          allowed: admission.allowed,
          effectiveCapabilities: admission.effectiveCapabilities,
          sandbox: admission.effectivePublicOptions.sandbox,
        },
        {
          allowed: true,
          effectiveCapabilities: ['repository.read', 'repository.write', 'shell'],
          sandbox: 'workspace-write',
        },
      )
    }
  })

  it('isolates Pi from project context by default', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi')
    assert.ok(capture.args.includes('--no-context-files'))
    assert.equal(
      capture.args.some((argument) => /approve/iu.test(argument)),
      false,
    )
    assert.equal(
      new PiCliAdapter().admit(role, task, new PiCliAdapter().prepareOptions({}))
        .effectivePublicOptions.authorization,
      'tool-allowlist',
    )
  })

  it('isolates Codex user config, project instructions, and execpolicy rules by default', async () => {
    const { capture } = await exerciseAdapter(new CodexCliAdapter(), 'codex')
    assert.ok(capture.args.includes('--ignore-user-config'))
    assert.ok(capture.args.includes('--ignore-rules'))
    assert.ok(capture.args.includes('project_doc_max_bytes=0'))
  })

  it('rejects provider on Codex instead of silently ignoring it', () => {
    assert.throws(() => new CodexCliAdapter().prepareOptions({ provider: 'xai' }), /provider/u)
  })

  it('blocks Cursor shell-only execution because write isolation cannot be guaranteed', async () => {
    const shellOnlyRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'shell-reader',
      requiredCapabilities: ['repository.read', 'shell'],
    }
    const shellOnlyTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: shellOnlyRole.id,
    }
    const adapter = new CursorCliAdapter()
    const rolekit = new Rolekit({ roles: [shellOnlyRole], adapters: [adapter] })
    const result = await rolekit.run(shellOnlyTask, {
      executorId: adapter.id,
      cwd: process.cwd(),
      adapterOptions: { command: 'must-not-be-probed' },
    })

    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'unsupported_permission_combination')
  })

  it('blocks Pi shell-only execution because bash cannot guarantee write isolation', async () => {
    const shellOnlyRole: RoleSpec<{ readonly source: string }, { readonly message: string }> = {
      ...role,
      id: 'pi-shell-reader',
      requiredCapabilities: ['repository.read', 'shell'],
    }
    const shellOnlyTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      roleId: shellOnlyRole.id,
    }
    const adapter = new PiCliAdapter()
    const prepared = adapter.prepareOptions({ command: 'must-not-be-probed' })
    const descriptor = adapter.inspect(prepared)
    const admission = adapter.admit(shellOnlyRole, shellOnlyTask, prepared)

    assert.ok(!descriptor.features.permissionCombinations.includes('repository.read+shell'))
    assert.equal(admission.allowed, false)
    assert.equal(admission.blockedError.code, 'unsupported_permission_combination')
    assert.ok(admission.effectiveCapabilities.includes('repository.write'))
    assert.deepEqual(admission.effectivePublicOptions.tools, ['read', 'grep', 'find', 'ls', 'bash'])

    const rolekit = new Rolekit({ roles: [shellOnlyRole], adapters: [adapter] })
    const result = await rolekit.run(shellOnlyTask, {
      executorId: adapter.id,
      cwd: process.cwd(),
      adapterOptions: { command: 'must-not-be-probed' },
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'unsupported_permission_combination')
  })

  it('uses execution cwd when resolving a relative adapter command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-relative-probe-'))
    try {
      const toolsDirectory = join(directory, 'tools')
      await mkdir(toolsDirectory)
      const executable = await createFixtureExecutable(toolsDirectory, 'relative-pi')
      const relativeCommand = `./tools/${executable.slice(toolsDirectory.length + 1)}`
      const adapter = new PiCliAdapter()
      const prepared = adapter.prepareOptions({ command: relativeCommand })
      const probe = await adapter.probe(prepared, { cwd: directory })

      assert.equal(probe.available, true, probe.diagnostic)
      assert.equal(probe.featureChecks.version, true)
      assert.equal(probe.featureChecks.help, true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('probes Pi mandatory flags as exact help tokens', async () => {
    const helpTokens = COMPLETE_HELP_TOKENS.filter(
      (token) => token !== '--mode' && token !== '--no-session',
    )
    const probe = await probeWithHelp(
      new PiCliAdapter(),
      'pi',
      { model: 'anthropic/claude-sonnet-4' },
      helpTokens,
    )

    assert.equal(probe.available, false)
    assert.equal(probe.featureChecks['flag:--mode'], false)
    assert.equal(probe.featureChecks['flag:--no-session'], false)
    assert.equal(probe.featureChecks['flag:--model'], true)
    assert.match(probe.diagnostic ?? '', /--mode/u)
    assert.match(probe.diagnostic ?? '', /--no-session/u)
  })

  it('probes every conditional Pi option used by the prepared execution', async () => {
    const helpTokens = COMPLETE_HELP_TOKENS.filter((token) => token !== '--offline')
    const probe = await probeWithHelp(
      new PiCliAdapter(),
      'pi',
      {
        provider: 'xai',
        model: 'xai/grok-4.5',
        thinking: 'xhigh',
        extensions: ['./extension.ts'],
        skills: ['./skill'],
        promptTemplates: ['./prompt.md'],
        offline: true,
      },
      helpTokens,
    )

    assert.equal(probe.available, false)
    for (const token of [
      '--extension',
      '--skill',
      '--prompt-template',
      '--provider',
      '--model',
      '--thinking',
      '--append-system-prompt',
    ]) {
      assert.equal(probe.featureChecks[`flag:${token}`], true, token)
    }
    assert.equal(probe.featureChecks['flag:--offline'], false)
  })

  it('probes Codex mandatory workspace and output flags', async () => {
    const helpTokens = COMPLETE_HELP_TOKENS.filter((token) => token !== '-C' && token !== '-o')
    const probe = await probeWithHelp(new CodexCliAdapter(), 'codex', {}, helpTokens)

    assert.equal(probe.available, false)
    for (const token of [
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--color',
      '--skip-git-repo-check',
      '-c',
      '--output-schema',
    ]) {
      assert.equal(probe.featureChecks[`flag:${token}`], true, token)
    }
    assert.equal(probe.featureChecks['flag:-C'], false)
    assert.equal(probe.featureChecks['flag:-o'], false)
  })

  it('probes every conditional Codex option used by the prepared execution', async () => {
    const helpTokens = COMPLETE_HELP_TOKENS.filter((token) => token !== '--profile')
    const probe = await probeWithHelp(
      new CodexCliAdapter(),
      'codex',
      {
        model: 'gpt-5.2-codex',
        profile: 'work',
        reasoningEffort: 'xhigh',
        webSearch: true,
        inheritUserConfig: true,
      },
      helpTokens,
    )

    assert.equal(probe.available, false)
    assert.equal(probe.featureChecks['flag:--model'], true)
    assert.equal(probe.featureChecks['flag:-c'], true)
    assert.equal(probe.featureChecks['flag:--profile'], false)
  })

  it('probes Cursor mandatory headless and permission-mode flags', async () => {
    const helpTokens = COMPLETE_HELP_TOKENS.filter((token) => token !== '--print')
    const probe = await probeWithHelp(new CursorCliAdapter(), 'cursor', {}, helpTokens)

    assert.equal(probe.available, false)
    for (const token of ['--workspace', '--trust', '--sandbox', '--force', '--mode']) {
      assert.equal(probe.featureChecks[`flag:${token}`], true, token)
    }
    assert.equal(probe.featureChecks['flag:--print'], false)
  })

  it('probes every conditional Cursor option used by the prepared execution', async () => {
    const helpTokens = COMPLETE_HELP_TOKENS.filter((token) => token !== '--approve-mcps')
    const probe = await probeWithHelp(
      new CursorCliAdapter(),
      'cursor',
      { model: 'cursor/typed-model', approveMcps: true },
      helpTokens,
    )

    assert.equal(probe.available, false)
    assert.equal(probe.featureChecks['flag:--model'], true)
    assert.equal(probe.featureChecks['flag:--approve-mcps'], false)
  })

  it('uses the claimed Pi home, store, and credential policy for version and help probes', async () => {
    const adapter = new PiCliAdapter()
    const customPiDirectory = await mkdtemp(join(tmpdir(), 'rolekit-selected-pi-store-'))
    const ambientXaiCredential = 'ambient-pi-xai-credential'
    const ambientAnthropicCredential = 'ambient-pi-anthropic-credential'
    const ambientSentinel = 'ambient-pi-probe-sentinel'
    const originals = new Map([
      ['PI_CODING_AGENT_DIR', process.env.PI_CODING_AGENT_DIR],
      ['XAI_API_KEY', process.env.XAI_API_KEY],
      ['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY],
      ['ROLEKIT_AMBIENT_SENTINEL', process.env.ROLEKIT_AMBIENT_SENTINEL],
    ])
    process.env.PI_CODING_AGENT_DIR = customPiDirectory
    process.env.XAI_API_KEY = ambientXaiCredential
    process.env.ANTHROPIC_API_KEY = ambientAnthropicCredential
    process.env.ROLEKIT_AMBIENT_SENTINEL = ambientSentinel

    try {
      const isolated = await captureProbeEnvironments(adapter, 'pi')
      const isolatedEnvironment = capturedProbeEnvironment(isolated.captures)
      const isolatedHome = isolatedProbeHome(isolatedEnvironment)
      assert.equal(isolatedEnvironment.PI_CODING_AGENT_DIR, isolatedHome)
      assert.notEqual(isolatedEnvironment.PI_CODING_AGENT_DIR, customPiDirectory)
      assert.equal(isolatedEnvironment.XAI_API_KEY, null)
      assert.equal(isolatedEnvironment.ANTHROPIC_API_KEY, null)
      assert.equal(isolatedEnvironment.ROLEKIT_AMBIENT_SENTINEL, null)
      const isolatedAdmission = adapter.admit(role, task, isolated.prepared)
      assert.equal(
        adapter.inspect(isolated.prepared).features.contextIsolation.userConfig,
        'isolated',
      )
      assert.equal(isolatedAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(isolatedAdmission.effectivePublicOptions.credentialSources, [])

      const selected = await captureProbeEnvironments(adapter, 'pi', {
        inheritUserAgentDirectory: true,
      })
      const selectedEnvironment = capturedProbeEnvironment(selected.captures)
      assert.equal(selectedEnvironment.PI_CODING_AGENT_DIR, customPiDirectory)
      assertInheritedProbeHome(selectedEnvironment)
      assert.equal(selectedEnvironment.XAI_API_KEY, null)
      assert.equal(selectedEnvironment.ANTHROPIC_API_KEY, null)
      assert.equal(selectedEnvironment.ROLEKIT_AMBIENT_SENTINEL, null)
      const selectedAdmission = adapter.admit(role, task, selected.prepared)
      assert.equal(
        adapter.inspect(selected.prepared).features.contextIsolation.userConfig,
        'inherited',
      )
      assert.equal(selectedAdmission.contextIsolation.credentials, 'user-store')
      assert.deepEqual(selectedAdmission.effectivePublicOptions.credentialSources, ['user-store'])

      const explicitCredential = 'explicit-pi-probe-credential'
      const explicit = await captureProbeEnvironments(adapter, 'pi', {
        environment: { XAI_API_KEY: explicitCredential },
      })
      const explicitEnvironment = capturedProbeEnvironment(explicit.captures)
      const explicitHome = isolatedProbeHome(explicitEnvironment)
      assert.equal(explicitEnvironment.PI_CODING_AGENT_DIR, explicitHome)
      assert.equal(explicitEnvironment.XAI_API_KEY, explicitCredential)
      assert.equal(explicitEnvironment.ANTHROPIC_API_KEY, null)
      assert.equal(explicitEnvironment.ROLEKIT_AMBIENT_SENTINEL, null)
      const explicitAdmission = adapter.admit(role, task, explicit.prepared)
      assert.equal(explicitAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(explicitAdmission.effectivePublicOptions.credentialSources, ['explicit'])

      const mixedCredential = 'mixed-pi-probe-credential'
      const mixed = await captureProbeEnvironments(adapter, 'pi', {
        inheritUserAgentDirectory: true,
        environment: { XAI_API_KEY: mixedCredential },
      })
      const mixedEnvironment = capturedProbeEnvironment(mixed.captures)
      assert.equal(mixedEnvironment.PI_CODING_AGENT_DIR, customPiDirectory)
      assertInheritedProbeHome(mixedEnvironment)
      assert.equal(mixedEnvironment.XAI_API_KEY, mixedCredential)
      assert.equal(mixedEnvironment.ANTHROPIC_API_KEY, null)
      assert.equal(mixedEnvironment.ROLEKIT_AMBIENT_SENTINEL, null)
      const mixedAdmission = adapter.admit(role, task, mixed.prepared)
      assert.equal(adapter.inspect(mixed.prepared).features.contextIsolation.credentials, 'unknown')
      assert.equal(mixedAdmission.contextIsolation.credentials, 'unknown')
      assert.deepEqual(mixedAdmission.effectivePublicOptions.credentialSources, [
        'user-store',
        'explicit',
      ])
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      await rm(customPiDirectory, { recursive: true, force: true })
    }
  })

  it('isolates Codex behavior canaries from version/help filesystem contamination', async () => {
    const adapter = new CodexCliAdapter()
    const inheritedRoot = await mkdtemp(join(tmpdir(), 'rolekit-selected-codex-contamination-'))
    const inheritedCodexHome = join(inheritedRoot, 'codex-home')
    const inheritedAppData = join(inheritedRoot, 'AppData', 'Roaming')
    const inheritedLocalAppData = join(inheritedRoot, 'AppData', 'Local')
    const explicitCredential = 'cross-process-explicit-openai-sentinel'
    const ambientToken = 'cross-process-ambient-token-sentinel'
    const keys = [
      'CODEX_HOME',
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'HOMEDRIVE',
      'HOMEPATH',
      'OPENAI_API_KEY',
      'ROLEKIT_CANARY_TOKEN',
    ] as const
    const originals = new Map(keys.map((key) => [key, process.env[key]]))
    process.env.CODEX_HOME = inheritedCodexHome
    process.env.HOME = inheritedRoot
    process.env.USERPROFILE = inheritedRoot
    process.env.APPDATA = inheritedAppData
    process.env.LOCALAPPDATA = inheritedLocalAppData
    if (process.platform === 'win32') {
      process.env.HOMEDRIVE = inheritedRoot.slice(0, 2)
      process.env.HOMEPATH = inheritedRoot.slice(2)
    }
    process.env.OPENAI_API_KEY = 'cross-process-ambient-openai-sentinel'
    process.env.ROLEKIT_CANARY_TOKEN = ambientToken

    try {
      for (const testCase of [
        { label: 'default-isolation', inheritUserConfig: false },
        { label: 'inherited-user-config', inheritUserConfig: true },
      ] as const) {
        const directory = await mkdtemp(join(tmpdir(), `rolekit-codex-${testCase.label}-`))
        const capturePath = join(directory, 'probe-stores.jsonl')
        const stateFileName = `.rolekit-probe-state-${testCase.label}`
        try {
          const command = await createContaminatingCodexExecutable(
            directory,
            capturePath,
            stateFileName,
          )
          const prepared = adapter.prepareOptions({
            command,
            environment: { OPENAI_API_KEY: explicitCredential },
            inheritAmbientEnvironment: true,
            ...(testCase.inheritUserConfig ? { inheritUserConfig: true } : {}),
          })
          const probe = await adapter.probe(prepared, { cwd: directory })
          const captures = (await readFile(capturePath, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as ProbeStoreCapture)

          assert.equal(probe.available, true, `${testCase.label}: ${probe.diagnostic}`)
          assert.deepEqual(
            captures.map((capture) => capture.phase),
            ['version', 'help', 'accepted-value', 'invalid-value'],
            testCase.label,
          )
          const version = captures[0]
          const help = captures[1]
          const accepted = captures[2]
          const invalid = captures[3]
          assert.ok(version && help && accepted && invalid)
          assert.equal(version.environment.OPENAI_API_KEY, explicitCredential, testCase.label)
          assert.equal(version.environment.ROLEKIT_CANARY_TOKEN, ambientToken, testCase.label)
          assert.equal(help.stateObserved, true, testCase.label)
          assert.equal(accepted.stateObserved, false, testCase.label)
          assert.equal(invalid.stateObserved, false, testCase.label)
          assert.deepEqual(accepted.storePaths, invalid.storePaths, testCase.label)
          assert.ok(
            version.storePaths.every((storePath) => !accepted.storePaths.includes(storePath)),
            `${testCase.label}: behavior stores overlapped version/help stores`,
          )
          const behaviorHome = isolatedProbeHome(accepted.environment)
          assert.equal(accepted.environment.CODEX_HOME, behaviorHome, testCase.label)
          assert.equal(accepted.environment.OPENAI_API_KEY, null, testCase.label)
          assert.equal(accepted.environment.ROLEKIT_CANARY_TOKEN, null, testCase.label)
          if (process.platform === 'win32') {
            assert.equal(
              `${accepted.environment.HOMEDRIVE}${accepted.environment.HOMEPATH}`,
              behaviorHome,
              testCase.label,
            )
          }
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      await rm(inheritedRoot, { recursive: true, force: true })
    }
  })

  it('uses claimed Codex probe policy while keeping every behavior canary credential-free', async () => {
    const adapter = new CodexCliAdapter()
    const customCodexHome = await mkdtemp(join(tmpdir(), 'rolekit-selected-codex-store-'))
    const ambientOpenAiCredential = 'ambient-codex-openai-credential'
    const ambientCodexCredential = 'ambient-codex-api-credential'
    const ambientAnthropicCredential = 'ambient-codex-anthropic-credential'
    const ambientOpenRouterCredential = 'ambient-codex-openrouter-credential'
    const ambientRolekitToken = 'ambient-rolekit-canary-token'
    const ambientSentinel = 'ambient-codex-probe-sentinel'
    const originals = new Map([
      ['CODEX_HOME', process.env.CODEX_HOME],
      ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
      ['CODEX_API_KEY', process.env.CODEX_API_KEY],
      ['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY],
      ['OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY],
      ['ROLEKIT_CANARY_TOKEN', process.env.ROLEKIT_CANARY_TOKEN],
      ['ROLEKIT_AMBIENT_SENTINEL', process.env.ROLEKIT_AMBIENT_SENTINEL],
    ])
    process.env.CODEX_HOME = customCodexHome
    process.env.OPENAI_API_KEY = ambientOpenAiCredential
    process.env.CODEX_API_KEY = ambientCodexCredential
    process.env.ANTHROPIC_API_KEY = ambientAnthropicCredential
    process.env.OPENROUTER_API_KEY = ambientOpenRouterCredential
    process.env.ROLEKIT_CANARY_TOKEN = ambientRolekitToken
    process.env.ROLEKIT_AMBIENT_SENTINEL = ambientSentinel

    const credentialKeys = [
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'ROLEKIT_CANARY_TOKEN',
      'ROLEKIT_AMBIENT_SENTINEL',
    ] as const
    const assertCredentialFreeCanaries = (
      captures: readonly ProbeEnvironmentCapture[],
    ): Readonly<Record<string, string | null>> => {
      const acceptedEnvironment = capturedProbeEnvironment(captures, 'accepted-value')
      const invalidEnvironment = capturedProbeEnvironment(captures, 'invalid-value')
      assert.deepEqual(invalidEnvironment, acceptedEnvironment)
      const canaryHome = isolatedProbeHome(acceptedEnvironment)
      assert.equal(acceptedEnvironment.CODEX_HOME, canaryHome)
      assert.notEqual(acceptedEnvironment.CODEX_HOME, customCodexHome)
      if (process.platform === 'win32') {
        const homeDrive = win32.parse(canaryHome).root.replace(/[\\/]$/u, '')
        const homePath = canaryHome.slice(homeDrive.length) || '\\'
        assert.equal(acceptedEnvironment.HOMEDRIVE, homeDrive)
        assert.equal(acceptedEnvironment.HOMEPATH, homePath)
        assert.equal(`${acceptedEnvironment.HOMEDRIVE}${acceptedEnvironment.HOMEPATH}`, canaryHome)
      }
      for (const key of credentialKeys) {
        assert.equal(acceptedEnvironment[key], null, key)
      }
      return acceptedEnvironment
    }

    try {
      const isolated = await captureProbeEnvironments(adapter, 'codex')
      const isolatedEnvironment = capturedProbeEnvironment(isolated.captures)
      const isolatedHome = isolatedProbeHome(isolatedEnvironment)
      assert.equal(isolatedEnvironment.CODEX_HOME, isolatedHome)
      assert.notEqual(isolatedEnvironment.CODEX_HOME, customCodexHome)
      for (const key of credentialKeys) {
        assert.equal(isolatedEnvironment[key], null, key)
      }
      assertCredentialFreeCanaries(isolated.captures)
      const isolatedAdmission = adapter.admit(role, task, isolated.prepared)
      assert.equal(
        adapter.inspect(isolated.prepared).features.contextIsolation.userConfig,
        'isolated',
      )
      assert.equal(isolatedAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(isolatedAdmission.effectivePublicOptions.credentialSources, [])

      const selected = await captureProbeEnvironments(adapter, 'codex', {
        inheritUserConfig: true,
      })
      const selectedEnvironment = capturedProbeEnvironment(selected.captures)
      assert.equal(selectedEnvironment.CODEX_HOME, customCodexHome)
      assertInheritedProbeHome(selectedEnvironment)
      for (const key of credentialKeys) {
        assert.equal(selectedEnvironment[key], null, key)
      }
      assertCredentialFreeCanaries(selected.captures)
      const selectedAdmission = adapter.admit(role, task, selected.prepared)
      assert.equal(
        adapter.inspect(selected.prepared).features.contextIsolation.userConfig,
        'inherited',
      )
      assert.equal(selectedAdmission.contextIsolation.credentials, 'user-store')
      assert.deepEqual(selectedAdmission.effectivePublicOptions.credentialSources, ['user-store'])

      const explicitCredential = 'explicit-codex-probe-credential'
      const explicitRolekitToken = 'explicit-rolekit-canary-token'
      const explicit = await captureProbeEnvironments(adapter, 'codex', {
        environment: {
          OPENAI_API_KEY: explicitCredential,
          ROLEKIT_CANARY_TOKEN: explicitRolekitToken,
        },
      })
      const explicitEnvironment = capturedProbeEnvironment(explicit.captures)
      const explicitHome = isolatedProbeHome(explicitEnvironment)
      assert.equal(explicitEnvironment.CODEX_HOME, explicitHome)
      assert.equal(explicitEnvironment.OPENAI_API_KEY, explicitCredential)
      assert.equal(explicitEnvironment.ROLEKIT_CANARY_TOKEN, explicitRolekitToken)
      assertCredentialFreeCanaries(explicit.captures)
      const explicitAdmission = adapter.admit(role, task, explicit.prepared)
      assert.equal(explicitAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(explicitAdmission.effectivePublicOptions.credentialSources, ['explicit'])

      const inherited = await captureProbeEnvironments(adapter, 'codex', {
        inheritAmbientEnvironment: true,
      })
      const inheritedEnvironment = capturedProbeEnvironment(inherited.captures)
      const inheritedHome = isolatedProbeHome(inheritedEnvironment)
      assert.equal(inheritedEnvironment.CODEX_HOME, inheritedHome)
      assert.notEqual(inheritedEnvironment.CODEX_HOME, customCodexHome)
      assert.equal(inheritedEnvironment.OPENAI_API_KEY, ambientOpenAiCredential)
      assert.equal(inheritedEnvironment.CODEX_API_KEY, ambientCodexCredential)
      assert.equal(inheritedEnvironment.ANTHROPIC_API_KEY, ambientAnthropicCredential)
      assert.equal(inheritedEnvironment.OPENROUTER_API_KEY, ambientOpenRouterCredential)
      assert.equal(inheritedEnvironment.ROLEKIT_CANARY_TOKEN, ambientRolekitToken)
      assert.equal(inheritedEnvironment.ROLEKIT_AMBIENT_SENTINEL, ambientSentinel)
      assertCredentialFreeCanaries(inherited.captures)
      const inheritedAdmission = adapter.admit(role, task, inherited.prepared)
      assert.equal(inheritedAdmission.contextIsolation.credentials, 'inherited')
      assert.deepEqual(inheritedAdmission.effectivePublicOptions.credentialSources, ['inherited'])

      const mixedCredential = 'mixed-codex-probe-credential'
      const mixed = await captureProbeEnvironments(adapter, 'codex', {
        inheritUserConfig: true,
        environment: { OPENAI_API_KEY: mixedCredential },
      })
      const mixedEnvironment = capturedProbeEnvironment(mixed.captures)
      assert.equal(mixedEnvironment.CODEX_HOME, customCodexHome)
      assertInheritedProbeHome(mixedEnvironment)
      assert.equal(mixedEnvironment.OPENAI_API_KEY, mixedCredential)
      assertCredentialFreeCanaries(mixed.captures)
      const mixedAdmission = adapter.admit(role, task, mixed.prepared)
      assert.equal(adapter.inspect(mixed.prepared).features.contextIsolation.credentials, 'unknown')
      assert.equal(mixedAdmission.contextIsolation.credentials, 'unknown')
      assert.deepEqual(mixedAdmission.effectivePublicOptions.credentialSources, [
        'user-store',
        'explicit',
      ])
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      await rm(customCodexHome, { recursive: true, force: true })
    }
  })

  it('keeps Cursor probe homes and credential claims aligned with execution policy', async () => {
    const adapter = new CursorCliAdapter()
    const ambientCredential = 'ambient-cursor-probe-credential'
    const ambientSentinel = 'ambient-cursor-probe-sentinel'
    const originals = new Map([
      ['CURSOR_API_KEY', process.env.CURSOR_API_KEY],
      ['ROLEKIT_AMBIENT_SENTINEL', process.env.ROLEKIT_AMBIENT_SENTINEL],
    ])
    process.env.CURSOR_API_KEY = ambientCredential
    process.env.ROLEKIT_AMBIENT_SENTINEL = ambientSentinel

    try {
      const isolated = await captureProbeEnvironments(adapter, 'cursor')
      const isolatedEnvironment = capturedProbeEnvironment(isolated.captures)
      isolatedProbeHome(isolatedEnvironment)
      assert.equal(isolatedEnvironment.CURSOR_API_KEY, null)
      assert.equal(isolatedEnvironment.ROLEKIT_AMBIENT_SENTINEL, null)
      const isolatedAdmission = adapter.admit(role, task, isolated.prepared)
      assert.equal(
        adapter.inspect(isolated.prepared).features.contextIsolation.userConfig,
        'unknown',
      )
      assert.equal(isolatedAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(isolatedAdmission.effectivePublicOptions.credentialSources, [])

      const explicitCredential = 'explicit-cursor-probe-credential'
      const explicit = await captureProbeEnvironments(adapter, 'cursor', {
        environment: { CURSOR_API_KEY: explicitCredential },
      })
      const explicitEnvironment = capturedProbeEnvironment(explicit.captures)
      isolatedProbeHome(explicitEnvironment)
      assert.equal(explicitEnvironment.CURSOR_API_KEY, explicitCredential)
      assert.equal(explicitEnvironment.ROLEKIT_AMBIENT_SENTINEL, null)
      const explicitAdmission = adapter.admit(role, task, explicit.prepared)
      assert.equal(explicitAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(explicitAdmission.effectivePublicOptions.credentialSources, ['explicit'])

      const inherited = await captureProbeEnvironments(adapter, 'cursor', {
        inheritAmbientEnvironment: true,
      })
      const inheritedEnvironment = capturedProbeEnvironment(inherited.captures)
      assertInheritedProbeHome(inheritedEnvironment)
      assert.equal(inheritedEnvironment.CURSOR_API_KEY, ambientCredential)
      assert.equal(inheritedEnvironment.ROLEKIT_AMBIENT_SENTINEL, ambientSentinel)
      const inheritedAdmission = adapter.admit(role, task, inherited.prepared)
      assert.equal(
        adapter.inspect(inherited.prepared).features.contextIsolation.credentials,
        'inherited',
      )
      assert.equal(inheritedAdmission.contextIsolation.credentials, 'inherited')
      assert.deepEqual(inheritedAdmission.effectivePublicOptions.credentialSources, ['inherited'])
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('does not observe hostile ambient instruction fixtures in safe mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-hostile-context-'))
    const userDirectory = await mkdtemp(join(tmpdir(), 'rolekit-hostile-pi-user-'))
    const projectSentinel = 'HOSTILE_PROJECT_INSTRUCTION_SENTINEL'
    const userSentinel = 'HOSTILE_PI_USER_SENTINEL'
    const originalPiDirectory = process.env.PI_CODING_AGENT_DIR
    try {
      await writeFile(join(directory, 'AGENTS.md'), projectSentinel, 'utf8')
      await writeFile(join(userDirectory, 'SYSTEM.md'), userSentinel, 'utf8')
      await writeFile(
        join(userDirectory, 'settings.json'),
        JSON.stringify({ userSentinel }),
        'utf8',
      )
      process.env.PI_CODING_AGENT_DIR = userDirectory

      const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', { cwd: directory })
      const surface = JSON.stringify(capture)
      assert.ok(capture.args.includes('--no-context-files'))
      assert.ok(capture.args.includes('--no-extensions'))
      assert.ok(capture.args.includes('--no-skills'))
      assert.ok(capture.args.includes('--no-prompt-templates'))
      assert.doesNotMatch(surface, new RegExp(projectSentinel, 'u'))
      assert.doesNotMatch(surface, new RegExp(userSentinel, 'u'))
    } finally {
      if (originalPiDirectory === undefined) {
        delete process.env.PI_CODING_AGENT_DIR
      } else {
        process.env.PI_CODING_AGENT_DIR = originalPiDirectory
      }
      await rm(directory, { recursive: true, force: true })
      await rm(userDirectory, { recursive: true, force: true })
    }
  })

  it('rejects reserved environment keys and unknown option keys before any probe', () => {
    const adapter = new PiCliAdapter()
    assert.throws(
      () => adapter.prepareOptions({ environment: { NODE_OPTIONS: '--require=x' } }),
      /NODE_OPTIONS/u,
    )
    assert.throws(() => adapter.prepareOptions({ timeotMs: 100 }), /timeotMs/u)
    assert.throws(() => adapter.prepareOptions({ commandArgs: ['wrapper'] }), /commandArgs/u)
    assert.throws(() => adapter.prepareOptions({ extraArgs: ['--unsafe'] }), /extraArgs/u)
  })

  it('freezes typed option snapshots and redacts sensitive fields with declared markers', () => {
    const adapter = new PiCliAdapter()
    const secret = 'literal-option-secret'
    const prepared = adapter.prepareOptions(
      {
        provider: 'xai',
        model: 'grok-4.5',
        environment: { XAI_API_KEY: secret },
      },
      {
        replacementsByJsonPointer: {
          '/environment/XAI_API_KEY': {
            source: 'env',
            name: 'XAI_API_KEY',
            redacted: true,
          },
        },
      },
    )

    assert.equal(prepared.requestedProvider, 'xai')
    assert.equal(prepared.requestedModel, 'grok-4.5')
    assert.deepEqual(prepared.publicOptions.environment, {
      XAI_API_KEY: { source: 'env', name: 'XAI_API_KEY', redacted: true },
    })
    assert.deepEqual(prepared.sensitiveValues, [secret])
    assert.equal(Object.isFrozen(prepared), true)
    assert.equal(Object.isFrozen(prepared.executionOptions), true)
    assert.equal(Object.isFrozen(prepared.publicOptions), true)
    assert.doesNotMatch(JSON.stringify(prepared.publicOptions), new RegExp(secret, 'u'))
    assert.throws(
      () =>
        adapter.prepareOptions(
          { model: 'grok-4.5' },
          {
            replacementsByJsonPointer: {
              '/model': { source: 'literal', redacted: true },
            },
          },
        ),
      /\/model/u,
    )
    assert.throws(
      () =>
        adapter.prepareOptions(
          { environment: { XAI_API_KEY: secret } },
          {
            replacementsByJsonPointer: {
              '/environment/XAI_API_KEY': {
                source: 'env',
                name: secret,
                redacted: true,
              },
            },
          },
        ),
      /marker|sensitive/iu,
    )
  })

  it('reports honest static isolation and advisory path enforcement', () => {
    const pi = new PiCliAdapter()
    const codex = new CodexCliAdapter()
    const cursor = new CursorCliAdapter()
    const piDescriptor = pi.inspect(pi.prepareOptions({}))
    const codexDescriptor = codex.inspect(codex.prepareOptions({}))
    const cursorDescriptor = cursor.inspect(cursor.prepareOptions({}))

    assert.equal(piDescriptor.schema, 'rolekit/executor-descriptor@2')
    assert.equal(piDescriptor.adapterProtocol, 'rolekit/executor-adapter@1')
    assert.equal(piDescriptor.features.contextIsolation.userConfig, 'isolated')
    assert.equal(piDescriptor.features.contextIsolation.projectInstructions, 'isolated')
    assert.equal(piDescriptor.features.contextIsolation.projectResources, 'isolated')
    assert.equal(codexDescriptor.features.contextIsolation.userConfig, 'isolated')
    assert.equal(codexDescriptor.features.contextIsolation.projectInstructions, 'unknown')
    assert.equal(codexDescriptor.features.contextIsolation.projectResources, 'unknown')
    assert.equal(cursorDescriptor.features.contextIsolation.projectInstructions, 'unknown')
    assert.equal(piDescriptor.features.contextIsolation.credentials, 'explicit')
    assert.equal(codexDescriptor.features.contextIsolation.credentials, 'explicit')
    assert.equal(cursorDescriptor.features.contextIsolation.credentials, 'explicit')
    assert.equal(
      pi.inspect(pi.prepareOptions({ inheritUserAgentDirectory: true })).features.contextIsolation
        .credentials,
      'user-store',
    )
    assert.equal(
      codex.inspect(codex.prepareOptions({ inheritUserConfig: true })).features.contextIsolation
        .credentials,
      'user-store',
    )
    assert.equal(
      pi.inspect(
        pi.prepareOptions({
          inheritUserAgentDirectory: true,
          environment: { XAI_API_KEY: 'explicit-pi-key' },
        }),
      ).features.contextIsolation.credentials,
      'unknown',
    )
    assert.equal(
      codex.inspect(
        codex.prepareOptions({
          inheritUserConfig: true,
          environment: { OPENAI_API_KEY: 'explicit-codex-key' },
        }),
      ).features.contextIsolation.credentials,
      'unknown',
    )
    for (const adapter of [pi, codex, cursor]) {
      assert.equal(
        adapter.inspect(adapter.prepareOptions({ inheritAmbientEnvironment: true })).features
          .contextIsolation.credentials,
        'inherited',
      )
    }
    for (const descriptor of [piDescriptor, codexDescriptor, cursorDescriptor]) {
      assert.deepEqual(descriptor.features.supportedPathEnforcement, ['advisory'])
    }
  })

  it('applies Pi exact resources, typed tools, thinking, provider, model, and offline mode', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: {
        provider: 'xai',
        model: 'grok-4.5',
        thinking: 'xhigh',
        tools: ['read', 'grep', 'edit', 'bash'],
        excludeTools: ['grep'],
        extensions: ['./extensions/only.ts'],
        skills: ['./skills/only'],
        promptTemplates: ['./prompts/only.md'],
        offline: true,
      },
    })

    assert.equal(capture.args[capture.args.indexOf('--provider') + 1], 'xai')
    assert.equal(capture.args[capture.args.indexOf('--model') + 1], 'grok-4.5')
    assert.equal(capture.args[capture.args.indexOf('--thinking') + 1], 'xhigh')
    assert.equal(capture.args[capture.args.indexOf('--tools') + 1], 'read,edit,bash')
    assert.equal(capture.args[capture.args.indexOf('--extension') + 1], './extensions/only.ts')
    assert.equal(capture.args[capture.args.indexOf('--skill') + 1], './skills/only')
    assert.equal(capture.args[capture.args.indexOf('--prompt-template') + 1], './prompts/only.md')
    assert.ok(capture.args.includes('--no-extensions'))
    assert.ok(capture.args.includes('--no-skills'))
    assert.ok(capture.args.includes('--no-prompt-templates'))
    assert.ok(capture.args.includes('--offline'))
  })

  it('applies Codex typed profile, reasoning, web, and inheritance controls', async () => {
    const { capture } = await exerciseAdapter(new CodexCliAdapter(), 'codex', {
      adapterOptions: {
        model: 'gpt-5.2-codex',
        profile: 'work',
        reasoningEffort: 'xhigh',
        webSearch: true,
        inheritUserConfig: true,
        inheritProjectInstructions: true,
        inheritExecPolicyRules: true,
      },
    })

    assert.equal(capture.args[capture.args.indexOf('--model') + 1], 'gpt-5.2-codex')
    assert.equal(capture.args[capture.args.indexOf('--profile') + 1], 'work')
    assert.ok(capture.args.includes('model_reasoning_effort="xhigh"'))
    assert.ok(capture.args.includes('web_search="live"'))
    assert.ok(!capture.args.includes('--ignore-user-config'))
    assert.ok(!capture.args.includes('--ignore-rules'))
    assert.ok(!capture.args.includes('project_doc_max_bytes=0'))
  })

  it('selectively propagates ambient CODEX_HOME only for the user-config opt-in', async () => {
    const adapter = new CodexCliAdapter()
    const customCodexHome = await mkdtemp(join(tmpdir(), 'rolekit-custom-codex-home-'))
    const ambientCredential = 'ambient-codex-credential'
    const ambientSentinel = 'ambient-codex-sentinel'
    const originals = new Map([
      ['CODEX_HOME', process.env.CODEX_HOME],
      ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
      ['ROLEKIT_AMBIENT_SENTINEL', process.env.ROLEKIT_AMBIENT_SENTINEL],
    ])
    process.env.CODEX_HOME = customCodexHome
    process.env.OPENAI_API_KEY = ambientCredential
    process.env.ROLEKIT_AMBIENT_SENTINEL = ambientSentinel

    try {
      const isolated = await exerciseAdapter(adapter, 'codex')
      assert.equal(typeof isolated.capture.environment.CODEX_HOME, 'string')
      assert.notEqual(isolated.capture.environment.CODEX_HOME, customCodexHome)
      assert.equal(isolated.capture.environment.OPENAI_API_KEY, null)
      assert.equal(isolated.capture.environment.ROLEKIT_AMBIENT_SENTINEL, null)
      const isolatedPrepared = adapter.prepareOptions({})
      const isolatedAdmission = adapter.admit(role, task, isolatedPrepared)
      assert.equal(
        adapter.inspect(isolatedPrepared).features.contextIsolation.userConfig,
        'isolated',
      )
      assert.equal(isolatedAdmission.contextIsolation.credentials, 'explicit')
      assert.deepEqual(isolatedAdmission.effectivePublicOptions.credentialSources, [])

      const inherited = await exerciseAdapter(adapter, 'codex', {
        adapterOptions: { inheritUserConfig: true },
      })
      assert.equal(inherited.capture.environment.CODEX_HOME, customCodexHome)
      assert.equal(inherited.capture.environment.OPENAI_API_KEY, null)
      assert.equal(inherited.capture.environment.ROLEKIT_AMBIENT_SENTINEL, null)
      const inheritedPrepared = adapter.prepareOptions({ inheritUserConfig: true })
      const inheritedAdmission = adapter.admit(role, task, inheritedPrepared)
      assert.equal(
        adapter.inspect(inheritedPrepared).features.contextIsolation.userConfig,
        'inherited',
      )
      assert.equal(inheritedAdmission.contextIsolation.credentials, 'user-store')
      assert.deepEqual(inheritedAdmission.effectivePublicOptions.credentialSources, ['user-store'])

      const explicitCredential = 'explicit-codex-credential'
      const mixed = await exerciseAdapter(adapter, 'codex', {
        adapterOptions: {
          inheritUserConfig: true,
          environment: { OPENAI_API_KEY: explicitCredential },
        },
      })
      assert.equal(mixed.capture.environment.CODEX_HOME, customCodexHome)
      assert.equal(mixed.capture.environment.OPENAI_API_KEY, explicitCredential)
      assert.equal(mixed.capture.environment.ROLEKIT_AMBIENT_SENTINEL, null)
      const mixedPrepared = adapter.prepareOptions({
        inheritUserConfig: true,
        environment: { OPENAI_API_KEY: explicitCredential },
      })
      const mixedAdmission = adapter.admit(role, task, mixedPrepared)
      assert.equal(adapter.inspect(mixedPrepared).features.contextIsolation.credentials, 'unknown')
      assert.equal(mixedAdmission.contextIsolation.credentials, 'unknown')
      assert.deepEqual(mixedAdmission.effectivePublicOptions.credentialSources, [
        'user-store',
        'explicit',
      ])
    } finally {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      await rm(customCodexHome, { recursive: true, force: true })
    }
  })

  it('applies Cursor typed sandbox, MCP approval, and model options', async () => {
    const { capture } = await exerciseAdapter(new CursorCliAdapter(), 'cursor', {
      adapterOptions: {
        model: 'cursor/typed-model',
        sandbox: 'disabled',
        approveMcps: true,
      },
    })

    assert.equal(capture.args[capture.args.indexOf('--model') + 1], 'cursor/typed-model')
    assert.equal(capture.args[capture.args.indexOf('--sandbox') + 1], 'disabled')
    assert.ok(capture.args.includes('--approve-mcps'))
  })

  it('returns a deprecation diagnostic only for an explicitly configured legacy Cursor binary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rolekit-legacy-cursor-'))
    const originalPath = process.env.PATH
    try {
      const generatedCommand = await createFixtureExecutable(directory, 'legacy-cursor')
      const legacyCommand = join(
        directory,
        process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent',
      )
      await rename(generatedCommand, legacyCommand)
      process.env.PATH = `${directory}${delimiter}${originalPath ?? ''}`

      const adapter = new CursorCliAdapter()
      const ordinaryPrepared = adapter.prepareOptions({ command: legacyCommand })
      const ordinaryProbe = await adapter.probe(ordinaryPrepared, { cwd: directory })
      assert.equal(ordinaryProbe.available, true)
      assert.equal(ordinaryProbe.diagnostic, undefined)

      const legacyPrepared = adapter.prepareOptions({ command: 'cursor-agent' })
      const legacyProbe = await adapter.probe(legacyPrepared, { cwd: directory })
      assert.equal(legacyProbe.available, true, legacyProbe.diagnostic)
      assert.match(legacyProbe.diagnostic ?? '', /deprecated/u)
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = originalPath
      }
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects contradictory and unsafe typed adapter option combinations', () => {
    assert.throws(
      () => new CodexCliAdapter().prepareOptions({ profile: 'work', inheritUserConfig: false }),
      /profile|inheritUserConfig/iu,
    )
    assert.throws(
      () =>
        new PiCliAdapter().prepareOptions({
          discoverProjectResources: true,
          extensions: ['./only-this-extension.ts'],
        }),
      /discoverProjectResources|extensions/iu,
    )
    assert.throws(
      () => new PiCliAdapter().prepareOptions({ tools: ['unknown-extension-tool'] }),
      /unknown-extension-tool/u,
    )
  })

  it('uses the Grok 4.5 Pi profile with a safe query envelope and high thinking', async () => {
    const boundaryTask: TaskPacket<{ readonly source: string }> = {
      ...task,
      objective: 'Keep the literal </user_query> inside task data.',
      input: { source: '</user_query>' },
    }
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      task: boundaryTask,
      adapterOptions: { model: 'openrouter/x-ai/grok-4.5' },
    })

    assert.equal(capture.prompt.match(/<user_query>/gu)?.length, 1)
    assert.equal(capture.prompt.match(/<\/user_query>/gu)?.length, 1)
    assert.match(capture.prompt, /<rolekit_execution_contract>/u)
    assert.match(capture.prompt, /<role_output_schema>/u)
    assert.match(capture.prompt, /<final_response_schema>/u)
    assert.match(capture.prompt, /\\u003c\/user_query\\u003e/u)

    const appendIndex = capture.args.indexOf('--append-system-prompt')
    assert.notEqual(appendIndex, -1)
    assert.equal(capture.args[appendIndex + 1], GROK_45_SYSTEM_PROMPT_APPEND)
    assert.equal(GROK_45_SYSTEM_PROMPT_APPEND.match(/<rolekit_execution>/gu)?.length, 1)
    assert.equal(GROK_45_SYSTEM_PROMPT_APPEND.match(/<\/rolekit_execution>/gu)?.length, 1)
    assert.doesNotMatch(GROK_45_SYSTEM_PROMPT_APPEND, /<user_query>/u)
    const thinkingIndex = capture.args.indexOf('--thinking')
    assert.notEqual(thinkingIndex, -1)
    assert.equal(capture.args[thinkingIndex + 1], 'high')
  })

  it('preserves an explicit Pi thinking level for the Grok 4.5 profile', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: {
        model: 'xai/grok-4.5',
        thinking: 'low',
      },
    })
    assert.equal(capture.args.filter((argument) => argument === '--thinking').length, 1)
    const thinkingIndex = capture.args.indexOf('--thinking')
    assert.equal(capture.args[thinkingIndex + 1], 'low')
  })

  it('does not add a separate thinking flag when the model carries a thinking suffix', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: { model: 'xai/grok-4.5:medium' },
    })
    assert.ok(capture.args.includes('--append-system-prompt'))
    assert.ok(!capture.args.includes('--thinking'))
  })

  it('keeps model selection on the typed Pi option surface', async () => {
    const { capture } = await exerciseAdapter(new PiCliAdapter(), 'pi', {
      adapterOptions: { model: 'anthropic/claude-sonnet-4' },
    })
    assert.match(capture.prompt, /RoleKit execution contract/u)
    assert.ok(!capture.args.includes('--append-system-prompt'))
    assert.equal(capture.args.filter((argument) => argument === '--model').length, 1)
    const modelIndex = capture.args.indexOf('--model')
    assert.equal(capture.args[modelIndex + 1], 'anthropic/claude-sonnet-4')
  })

  it('maps recognizable CLI failures and malformed output to stable typed response codes', async () => {
    const secret = 'classification-secret'
    const authentication = await exerciseCursorFailure([
      'fail',
      'authentication failed: invalid api key',
      '--api-key',
      secret,
    ])
    const configuration = await exerciseCursorFailure(['fail', 'unknown option --invalid'])
    const nonzero = await exerciseCursorFailure(['fail', 'ordinary transient failure'])
    const protocol = await exerciseCursorFailure(['malformed-cursor'])

    assert.deepEqual(
      [authentication.code, authentication.retryable],
      ['authentication_failed', false],
    )
    assert.doesNotMatch(authentication.message ?? '', new RegExp(secret, 'u'))
    assert.deepEqual([configuration.code, configuration.retryable], ['configuration_error', false])
    assert.deepEqual([nonzero.code, nonzero.retryable], ['nonzero_exit', true])
    assert.deepEqual([protocol.code, protocol.retryable], ['protocol_error', false])
    assert.equal(protocol.status, 'failed')
  })

  it('keeps signaled CLI failures distinct while preserving public mapping and redaction', async () => {
    const secret = 'signaled-classification-secret'
    const response = await new FailureProbeAdapter(
      new CliExitError(`signaled child mentioned invalid configuration ${secret}`, {
        signal: 'SIGTERM',
        stderr: `invalid configuration ${secret}\n`,
        commandDisplay: `fixture --token ${secret}`,
      }),
    ).execute(role, task, directContext('signaled-classification', {}, [secret]))

    assert.equal(response.status, 'failed')
    assert.deepEqual([response.error?.code, response.error?.retryable], ['nonzero_exit', true])
    assert.equal(response.evidence[0]?.kind, 'command')
    assert.doesNotMatch(JSON.stringify(response), new RegExp(secret, 'u'))
    assert.match(JSON.stringify(response), /\[REDACTED\]/u)
  })

  it('does not infer I/O semantics from errno outside an operation boundary', async () => {
    const failure = Object.assign(new Error('unscoped EIO failure'), {
      code: 'EIO',
      syscall: 'unknown-adapter-operation',
    })
    const response = await new FailureProbeAdapter(failure).execute(
      role,
      task,
      directContext('failure-unscoped-eio'),
    )
    assert.equal(response.status, 'failed')
    assert.equal(response.error?.code, 'adapter_error')
    assert.equal(response.error?.retryable, true)

    const protocol = await exerciseCursorFailure(['malformed-cursor'])
    assert.deepEqual([protocol.code, protocol.retryable], ['protocol_error', false])
  })

  it('classifies real missing and malformed Codex required output as protocol failures', async () => {
    for (const mode of ['codex-missing-output', 'codex-malformed-output'] as const) {
      const failure = await exerciseCodexMode(new CodexCliAdapter(), mode)
      assert.equal(failure.status, 'failed', mode)
      assert.deepEqual([failure.code, failure.retryable], ['protocol_error', false], mode)
    }
  })

  it('maps permanent Codex setup failures to non-retryable configuration errors', async () => {
    for (const code of ['ENOENT', 'EACCES', 'EPERM'] as const) {
      const adapter = new CodexCliAdapter({
        createTemporaryDirectory: async () => {
          throw operationError(code, 'codex temporary directory creation')
        },
      })
      const failure = await exerciseCodexMode(adapter)
      assert.equal(failure.status, 'failed', code)
      assert.deepEqual([failure.code, failure.retryable], ['configuration_error', false], code)
    }
  })

  it('maps a required Codex output directory to non-retryable protocol_error', async () => {
    const failure = await exerciseCodexMode(
      new CodexCliAdapter({
        readRequiredOutput: async () => {
          throw operationError('EISDIR', 'codex required output read')
        },
      }),
    )
    assert.equal(failure.status, 'failed')
    assert.deepEqual([failure.code, failure.retryable], ['protocol_error', false])
  })

  it('maps deterministic Codex schema EFBIG to non-retryable configuration_error', async () => {
    const failure = await exerciseCodexMode(
      new CodexCliAdapter({
        writeSchemaFile: async () => {
          throw operationError('EFBIG', 'codex schema write')
        },
      }),
    )
    assert.equal(failure.status, 'failed')
    assert.deepEqual([failure.code, failure.retryable], ['configuration_error', false])
  })

  it('maps Codex setup collisions and invalid paths to non-retryable configuration_error', async () => {
    for (const code of ['EEXIST', 'ENOTDIR'] as const) {
      const failure = await exerciseCodexMode(
        new CodexCliAdapter({
          createTemporaryDirectory: async () => {
            throw operationError(code, 'codex temporary directory creation')
          },
        }),
      )
      assert.equal(failure.status, 'failed', code)
      assert.deepEqual([failure.code, failure.retryable], ['configuration_error', false], code)
    }
  })

  it('maps transient Codex schema-write and output-read I/O at their boundaries', async () => {
    for (const code of ['ENOSPC', 'EIO'] as const) {
      const writeFailure = await exerciseCodexMode(
        new CodexCliAdapter({
          writeSchemaFile: async () => {
            throw operationError(code, 'codex schema write')
          },
        }),
      )
      assert.deepEqual([writeFailure.code, writeFailure.retryable], ['io_error', true], code)

      const readFailure = await exerciseCodexMode(
        new CodexCliAdapter({
          readRequiredOutput: async () => {
            throw operationError(code, 'codex required output read')
          },
        }),
      )
      assert.deepEqual([readFailure.code, readFailure.retryable], ['io_error', true], code)
    }
  })

  it('maps permanent Codex output-read and cleanup permissions as configuration errors', async () => {
    for (const code of ['EACCES', 'EPERM'] as const) {
      const readFailure = await exerciseCodexMode(
        new CodexCliAdapter({
          readRequiredOutput: async () => {
            throw operationError(code, 'codex required output read')
          },
        }),
      )
      assert.deepEqual(
        [readFailure.code, readFailure.retryable],
        ['configuration_error', false],
        code,
      )

      const cleanupFailure = await exerciseCodexMode(
        new CodexCliAdapter({
          cleanupTemporaryDirectory: async () => {
            throw operationError(code, 'codex cleanup')
          },
        }),
      )
      assert.deepEqual(
        [cleanupFailure.code, cleanupFailure.retryable],
        ['configuration_error', false],
        code,
      )
    }
  })

  it('maps transient Codex cleanup failures as retryable I/O', async () => {
    for (const code of ['ENOSPC', 'EIO'] as const) {
      const failure = await exerciseCodexMode(
        new CodexCliAdapter({
          cleanupTemporaryDirectory: async () => {
            throw operationError(code, 'codex cleanup')
          },
        }),
      )
      assert.equal(failure.status, 'failed', code)
      assert.deepEqual([failure.code, failure.retryable], ['io_error', true], code)
    }
  })

  it('maps unknown adapter implementation failures without asserting protocol corruption', async () => {
    const response = await new FailureProbeAdapter(
      new Error('unexpected adapter implementation failure'),
    ).execute(role, task, directContext('failure-unknown'))

    assert.equal(response.status, 'failed')
    assert.equal(response.error?.code, 'adapter_error')
    assert.equal(response.error?.retryable, true)
  })

  it('redacts every typed failure and command evidence at the final adapter boundary', async () => {
    const secret = 'typed-boundary-per-run-secret'
    const commandDisplay = `agent --token=${secret}`
    const cases = [
      ['timeout', new CliTimeoutError(`typed timeout exposed ${secret}`), 'timeout'],
      ['cancelled', new CliAbortedError(`typed cancellation exposed ${secret}`), 'cancelled'],
      [
        'output limit',
        new CliOutputLimitError(`typed output limit exposed ${secret}`),
        'output_limit_exceeded',
      ],
      [
        'spawn',
        new CliSpawnError(`typed spawn exposed ${secret}`, { commandDisplay }),
        'spawn_failed',
      ],
      [
        'exit',
        new CliExitError(`typed exit exposed ${secret}`, {
          exitCode: 7,
          stdout: `stdout exposed ${secret}`,
          stderr: `stderr exposed ${secret}`,
          commandDisplay,
        }),
        'nonzero_exit',
      ],
      [
        'configuration',
        new CliConfigurationError(`typed configuration exposed ${secret}`),
        'configuration_error',
      ],
      [
        'authentication',
        new CliAuthenticationError(`typed authentication exposed ${secret}`),
        'authentication_failed',
      ],
      ['protocol', new CliProtocolError(`typed protocol exposed ${secret}`), 'protocol_error'],
      ['I/O', new CliIoError(`typed I/O exposed ${secret}`), 'io_error'],
      ['adapter', new CliAdapterError(`typed adapter exposed ${secret}`), 'adapter_error'],
    ] as const

    for (const [name, failure, expectedCode] of cases) {
      const response = await new TypedBoundaryProbeAdapter(failure).execute(
        role,
        task,
        directContext(`typed-boundary-${name}`, { environment: { PROBE_API_KEY: secret } }, [
          secret,
        ]),
      )
      const surface = collectSurfaceText(response)
      assert.equal(response.error?.code, expectedCode, name)
      assert.doesNotMatch(surface, new RegExp(secret, 'u'), name)
      assert.match(surface, /\[REDACTED\]/u, name)
    }
  })

  it('sanitizes an existing CliProtocolError before parseProtocol rethrows it', () => {
    const secret = 'existing-protocol-per-run-secret'
    const adapter = new TypedBoundaryProbeAdapter(undefined)

    assert.throws(
      () => adapter.rethrowExistingProtocol(secret),
      (error: unknown) => {
        assert.ok(error instanceof CliProtocolError)
        assert.doesNotMatch(collectSurfaceText(error), new RegExp(secret, 'u'))
        assert.match(error.message, /\[REDACTED\]/u)
        return true
      },
    )
  })

  it('does not import adapter authentication values from ambient safe-mode state', async () => {
    const cases = [
      {
        adapter: new CursorCliAdapter(),
        mode: 'cursor' as const,
        key: 'CURSOR_API_KEY',
      },
      {
        adapter: new CodexCliAdapter(),
        mode: 'codex' as const,
        key: 'OPENAI_API_KEY',
      },
      {
        adapter: new PiCliAdapter(),
        mode: 'pi' as const,
        key: 'ANTHROPIC_API_KEY',
      },
    ] as const

    for (const { adapter, mode, key } of cases) {
      const original = process.env[key]
      const ambient = `ambient-${mode}-credential`
      process.env[key] = ambient
      try {
        const { capture, resultSurface } = await exerciseAdapter(adapter, mode)
        const prepared = adapter.prepareOptions({})
        const descriptor = adapter.inspect(prepared)
        const admission = adapter.admit(role, task, prepared)

        assert.equal(capture.environment[key], null, mode)
        assert.equal(descriptor.features.contextIsolation.credentials, 'explicit', mode)
        assert.equal(admission.contextIsolation.credentials, 'explicit', mode)
        assert.deepEqual(admission.effectivePublicOptions.credentialSources, [], mode)
        assert.deepEqual(admission.effectivePublicOptions.credentialEnvironmentKeys, [], mode)
        assert.doesNotMatch(resultSurface, new RegExp(ambient, 'u'), mode)
      } finally {
        if (original === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = original
        }
      }
    }
  })

  it('binds built-in per-run credential sources to public markers with no ambient fallback', async () => {
    const cases = [
      {
        adapter: new CursorCliAdapter(),
        mode: 'cursor' as const,
        key: 'CURSOR_API_KEY',
        undeclaredKey: 'OPENAI_API_KEY',
      },
      {
        adapter: new CodexCliAdapter(),
        mode: 'codex' as const,
        key: 'OPENAI_API_KEY',
        undeclaredKey: 'ANTHROPIC_API_KEY',
      },
      {
        adapter: new PiCliAdapter(),
        mode: 'pi' as const,
        key: 'ANTHROPIC_API_KEY',
        undeclaredKey: 'CURSOR_API_KEY',
      },
    ] as const

    for (const { adapter, mode, key, undeclaredKey } of cases) {
      const originals = new Map([
        [key, process.env[key]],
        [undeclaredKey, process.env[undeclaredKey]],
      ])
      const ambient = `ambient-${mode}-credential`
      const explicit = `explicit-${mode}-credential`
      const undeclared = `undeclared-${mode}-credential`
      process.env[key] = ambient
      process.env[undeclaredKey] = undeclared
      try {
        const { capture, resultSurface } = await exerciseAdapter(adapter, mode, {
          adapterOptions: { environment: { [key]: explicit } },
        })
        assert.equal(capture.environment[key], explicit, mode)
        assert.equal(capture.environment[undeclaredKey], null, mode)
        assert.doesNotMatch(resultSurface, new RegExp(explicit, 'u'), mode)
        assert.doesNotMatch(resultSurface, new RegExp(ambient, 'u'), mode)
        assert.doesNotMatch(resultSurface, new RegExp(undeclared, 'u'), mode)

        const prepared = adapter.prepareOptions(
          { environment: { [key]: explicit } },
          {
            replacementsByJsonPointer: {
              [`/environment/${key}`]: { source: 'env', name: key, redacted: true },
            },
          },
        )
        const admission = adapter.admit(role, task, prepared)
        assert.deepEqual(admission.effectivePublicOptions.credentialSources, ['explicit'], mode)
        assert.deepEqual(admission.effectivePublicOptions.credentialEnvironmentKeys, [key], mode)
        assert.deepEqual(admission.effectivePublicOptions.environment, {
          [key]: { source: 'env', name: key, redacted: true },
        })
      } finally {
        for (const [name, value] of originals) {
          if (value === undefined) {
            delete process.env[name]
          } else {
            process.env[name] = value
          }
        }
      }
    }
  })

  it('auto-redacts built-in per-run credentials echoed by failing children', async () => {
    for (const { adapter, key, secret } of [
      {
        adapter: new CursorCliAdapter(),
        key: 'CURSOR_API_KEY',
        secret: 'cursor-per-run-secret',
      },
      {
        adapter: new CodexCliAdapter(),
        key: 'OPENAI_API_KEY',
        secret: 'codex-per-run-secret',
      },
      {
        adapter: new PiCliAdapter(),
        key: 'ANTHROPIC_API_KEY',
        secret: 'pi-per-run-secret',
      },
    ] as const) {
      const response = await exerciseEnvironmentFailure(adapter, key, secret)
      const surface = JSON.stringify(response)
      assert.equal(response.status, 'failed', adapter.id)
      assert.doesNotMatch(surface, new RegExp(secret, 'u'), adapter.id)
      assert.match(response.error?.message ?? '', /\[REDACTED\]/u, adapter.id)
    }
  })

  it('does not expose arbitrary prefix or suffix argument injection', () => {
    const adapter = new CursorCliAdapter()
    assert.throws(() => adapter.prepareOptions({ commandArgs: ['wrapper'] }), /commandArgs/u)
    assert.throws(() => adapter.prepareOptions({ extraArgs: ['--token', 'secret'] }), /extraArgs/u)
  })

  it('keeps a newer same-id inflight controller cancellable when an older call finishes', async () => {
    const adapter = new InflightProbeAdapter()
    const context = directContext('direct-shared-run')
    const firstExecution = adapter.execute(role, task, context)
    while (adapter.invocationCount < 1) {
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    }
    const secondExecution = adapter.execute(role, task, context)
    while (adapter.invocationCount < 2) {
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    }

    adapter.releaseFirst()
    assert.equal((await firstExecution).status, 'completed')
    await adapter.cancel(context.runId)

    let timeout: NodeJS.Timeout | undefined
    try {
      const secondResult = await Promise.race([
        secondExecution,
        new Promise<never>((_resolvePromise, rejectPromise) => {
          timeout = setTimeout(
            () => rejectPromise(new Error('Newer inflight controller was lost.')),
            1_000,
          )
        }),
      ])
      assert.equal(secondResult.status, 'cancelled')
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
    }
  })

  it('rejects process-control and adapter-isolation keys in the safe environment profile', () => {
    for (const key of [
      'NODE_OPTIONS',
      'DYLD_INSERT_LIBRARIES',
      'LD_PRELOAD',
      'HOME',
      'PATH',
      'Path',
      'CODEX_HOME',
      'PI_CODING_AGENT_DIR',
      'BASH_ENV',
      'ENV',
      'PYTHONHOME',
      'PYTHONPATH',
      'RUBYOPT',
      'PERL5OPT',
      'SSLKEYLOGFILE',
      'NODE_EXTRA_CA_CERTS',
      'pYtHoNpAtH',
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'PSModulePath',
      'NPM_CONFIG_NODE_OPTIONS',
      'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CONFIG_FILE',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'AZURE_CONFIG_DIR',
      'KUBECONFIG',
      'DOCKER_CONFIG',
      'GNUPGHOME',
      'SSH_AUTH_SOCK',
    ]) {
      assert.throws(
        () => new CursorCliAdapter().prepareOptions({ environment: { [key]: 'unsafe' } }),
        /reserved|process control|isolation/iu,
        key,
      )
    }
  })

  it('rejects misspelled adapter options', () => {
    assert.throws(
      () => new CursorCliAdapter().prepareOptions({ timeotMs: 100 }),
      /Unsupported adapter options/u,
    )
  })
})

describe('Pi prompt profile selection', () => {
  it('matches only an explicit Grok 4.5 final model segment', () => {
    for (const model of [
      'grok-4.5',
      'xai/grok-4.5',
      'openrouter/x-ai/grok-4.5',
      'xai/grok-4.5:high',
    ]) {
      assert.equal(resolvePiPromptProfile({ model }), 'grok-4.5')
    }

    for (const options of [
      {},
      { provider: 'xai' },
      { model: 'grok-4.5-preview' },
      { model: 'custom-grok-4.5' },
      { model: 'xai/GROK-4.5' },
      { model: 'xai/grok-4' },
    ] satisfies readonly PiCliAdapterOptions[]) {
      assert.equal(resolvePiPromptProfile(options), 'neutral')
    }
  })

  it('detects explicit thinking in the typed option or model suffix', () => {
    assert.equal(hasExplicitPiThinking({ model: 'xai/grok-4.5:xhigh' }), true)
    assert.equal(hasExplicitPiThinking({ thinking: 'medium' }), true)
    assert.equal(hasExplicitPiThinking({ model: 'xai/grok-4.5' }), false)
  })
})

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RolekitError } from '../../core/errors.ts'
import { freezeJsonSnapshot } from '../../core/json.ts'
import type {
  Capability,
  ContextIsolation,
  ExecutionAdmission,
  ExecutionContext,
  ExecutorProbe,
  ExecutorResponse,
  ExecutorSupportFeatures,
  JsonObject,
  PreparedExecutorOptions,
  PublicOptionContext,
  RoleSpec,
  TaskPacket,
  TokenUsage,
} from '../../core/types.ts'
import {
  buildCliArgumentPlan,
  CliAdapterBase,
  type CliArgumentPlan,
  type CliCompatibilityBehaviorCheck,
  type CliProbeEnvironment,
} from '../cli/base.ts'
import { CliConfigurationError, CliExitError, CliIoError, CliProtocolError } from '../cli/errors.ts'
import { isolatedUserEnvironment, prepareCliEnvironment } from '../cli/options.ts'
import { firstString, isRecord } from '../cli/parse.ts'
import {
  CODEX_AUTHENTICATION_ENVIRONMENT_KEYS,
  type CodexCliAdapterOptions,
  prepareCodexCliAdapterOptions,
} from './options.ts'
import { createCodexWireResponseSchema, parseCodexWireResponse } from './output-schema.ts'
import { buildCodexExecutionPrompt } from './prompt.ts'

export interface CodexEventData {
  readonly terminal: 'completed'
  readonly usage?: TokenUsage
}

export interface CodexFileOperations {
  readonly createTemporaryDirectory: (prefix: string) => Promise<string>
  readonly writeSchemaFile: (path: string, content: string) => Promise<void>
  readonly readRequiredOutput: (path: string) => Promise<string>
  readonly cleanupTemporaryDirectory: (path: string) => Promise<void>
}

const DEFAULT_FILE_OPERATIONS: CodexFileOperations = {
  createTemporaryDirectory: (prefix) => mkdtemp(prefix),
  writeSchemaFile: async (path, content) => {
    await writeFile(path, content, 'utf8')
  },
  readRequiredOutput: (path) => readFile(path, 'utf8'),
  cleanupTemporaryDirectory: async (path) => {
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    })
  },
}

type CodexFileOperation =
  | 'temporary_directory'
  | 'schema_write'
  | 'required_output_read'
  | 'cleanup'

type FilesystemDecision = 'configuration' | 'io' | 'protocol' | 'ignore'

const FILESYSTEM_DECISIONS: Readonly<
  Record<CodexFileOperation, Readonly<Record<string, FilesystemDecision>>>
> = {
  temporary_directory: {
    EACCES: 'configuration',
    EEXIST: 'configuration',
    EFBIG: 'configuration',
    EINVAL: 'configuration',
    EISDIR: 'configuration',
    ENOENT: 'configuration',
    ENOTDIR: 'configuration',
    EPERM: 'configuration',
    EROFS: 'configuration',
    EAGAIN: 'io',
    EBUSY: 'io',
    EIO: 'io',
    EMFILE: 'io',
    ENFILE: 'io',
    ENOSPC: 'io',
    ENOTEMPTY: 'io',
    ETIMEDOUT: 'io',
  },
  schema_write: {
    EACCES: 'configuration',
    EEXIST: 'configuration',
    EFBIG: 'configuration',
    EINVAL: 'configuration',
    EISDIR: 'configuration',
    ENOENT: 'configuration',
    ENOTDIR: 'configuration',
    EPERM: 'configuration',
    EROFS: 'configuration',
    EAGAIN: 'io',
    EBUSY: 'io',
    EIO: 'io',
    EMFILE: 'io',
    ENFILE: 'io',
    ENOSPC: 'io',
    ENOTEMPTY: 'io',
    ETIMEDOUT: 'io',
  },
  required_output_read: {
    EISDIR: 'protocol',
    ENOENT: 'protocol',
    ENOTDIR: 'protocol',
    EACCES: 'configuration',
    EEXIST: 'configuration',
    EINVAL: 'configuration',
    EPERM: 'configuration',
    EROFS: 'configuration',
    EAGAIN: 'io',
    EBUSY: 'io',
    EFBIG: 'io',
    EIO: 'io',
    EMFILE: 'io',
    ENFILE: 'io',
    ENOSPC: 'io',
    ENOTEMPTY: 'io',
    ETIMEDOUT: 'io',
  },
  cleanup: {
    ENOENT: 'ignore',
    EACCES: 'configuration',
    EEXIST: 'configuration',
    EINVAL: 'configuration',
    EISDIR: 'configuration',
    ENOTDIR: 'configuration',
    EPERM: 'configuration',
    EROFS: 'configuration',
    EAGAIN: 'io',
    EBUSY: 'io',
    EFBIG: 'io',
    EIO: 'io',
    EMFILE: 'io',
    ENFILE: 'io',
    ENOSPC: 'io',
    ENOTEMPTY: 'io',
    ETIMEDOUT: 'io',
  },
}

const FILESYSTEM_OPERATION_LABELS: Readonly<Record<CodexFileOperation, string>> = {
  temporary_directory: 'Codex temporary directory creation',
  schema_write: 'Codex schema write',
  required_output_read: 'Codex required output read',
  cleanup: 'Codex cleanup',
}

function filesystemErrorCode(error: unknown): string | undefined {
  try {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code
      return typeof code === 'string' ? code : undefined
    }
  } catch {
    // Hostile thrown values are classified as unknown adapter failures below.
  }
  return undefined
}

function classifyFilesystemFailure(
  error: unknown,
  operation: CodexFileOperation,
): Error | undefined {
  const code = filesystemErrorCode(error)
  const decision = code === undefined ? undefined : FILESYSTEM_DECISIONS[operation][code]
  const label = FILESYSTEM_OPERATION_LABELS[operation]
  const suffix = code === undefined ? '' : ` (${code})`
  switch (decision) {
    case 'ignore':
      return undefined
    case 'protocol':
      return new CliProtocolError(`Codex required output was missing or invalid${suffix}.`)
    case 'configuration':
      return new CliConfigurationError(`${label} failed${suffix}.`)
    case 'io':
      return new CliIoError(`${label} failed${suffix}.`)
    default:
      return new Error(`${label} failed.`)
  }
}

function readCodexTurnUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const tokenCount = (key: string): number | undefined => {
    const count = value[key]
    return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : undefined
  }
  const inputTokens = tokenCount('input_tokens')
  const outputTokens = tokenCount('output_tokens')
  const cachedInputTokens = tokenCount('cached_input_tokens')
  if (inputTokens === undefined && outputTokens === undefined && cachedInputTokens === undefined) {
    return undefined
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
  }
}

function parseCodexJsonLines(stdout: string): readonly Readonly<Record<string, unknown>>[] {
  const records: Readonly<Record<string, unknown>>[] = []
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    } catch {
      throw new CliProtocolError('Codex JSON event stream was malformed or truncated.')
    }
    if (!isRecord(value)) {
      throw new CliProtocolError('Codex JSON event stream contained a non-object record.')
    }
    records.push(value)
  }
  return records
}

function codexTerminalFailure(event: Readonly<Record<string, unknown>>): CliProtocolError {
  const error = isRecord(event.error) ? event.error : undefined
  const message = error === undefined ? undefined : firstString(error, 'message')
  return new CliProtocolError(
    message === undefined
      ? `Codex JSON event stream reported ${String(event.type)}.`
      : `Codex JSON event stream reported ${String(event.type)}: ${message}`,
  )
}

export function parseCodexEvents(stdout: string): CodexEventData {
  let usage: TokenUsage | undefined
  let completed = false
  for (const event of parseCodexJsonLines(stdout)) {
    if (event.type === 'turn.failed' || event.type === 'error') {
      throw codexTerminalFailure(event)
    }
    if (event.type === 'turn.completed') {
      completed = true
      // A later documented completion supersedes an earlier one from the same invocation.
      usage = readCodexTurnUsage(event.usage) ?? usage
    }
  }
  if (!completed) {
    throw new CliProtocolError(
      'Codex JSON event stream did not contain terminal completion and may be truncated.',
    )
  }
  return {
    terminal: 'completed',
    ...(usage === undefined ? {} : { usage }),
  }
}

function mergeUsage(detected: TokenUsage | undefined, durationMs: number): TokenUsage {
  return {
    ...detected,
    durationMs,
  }
}

function buildCodexArgumentPlan(
  options: Readonly<CodexCliAdapterOptions>,
  cwd: string,
  schemaPath: string,
  outputPath: string,
  sandbox: 'read-only' | 'workspace-write',
): CliArgumentPlan {
  return buildCliArgumentPlan([
    'exec',
    { flag: '--json' },
    { flag: '--ephemeral' },
    { flag: '--color', values: ['never'] },
    { flag: '--skip-git-repo-check' },
    ...(options.inheritUserConfig === true ? [] : [{ flag: '--ignore-user-config' }]),
    ...(options.inheritExecPolicyRules === true ? [] : [{ flag: '--ignore-rules' }]),
    ...(options.inheritProjectInstructions === true
      ? []
      : [{ flag: '-c', values: [CODEX_PROJECT_DOC_CONFIG] }]),
    { flag: '-C', values: [cwd] },
    { flag: '--sandbox', values: [sandbox] },
    { flag: '--output-schema', values: [schemaPath] },
    { flag: '-o', values: [outputPath] },
    ...(options.model === undefined ? [] : [{ flag: '--model', values: [options.model] }]),
    ...(options.profile === undefined ? [] : [{ flag: '--profile', values: [options.profile] }]),
    ...(options.reasoningEffort === undefined
      ? []
      : [{ flag: '-c', values: [`model_reasoning_effort="${options.reasoningEffort}"`] }]),
    ...(options.webSearch === true ? [{ flag: '-c', values: [CODEX_WEB_SEARCH_CONFIG] }] : []),
  ])
}

const CODEX_PROJECT_DOC_CONFIG = 'project_doc_max_bytes=0'
const CODEX_INVALID_PROJECT_DOC_CONFIG = 'project_doc_max_bytes="rolekit-invalid-value-canary"'
const CODEX_WEB_SEARCH_CONFIG = 'web_search="live"'
const CODEX_INVALID_WEB_SEARCH_CONFIG = 'web_search="rolekit-invalid-value-canary"'
const CODEX_PROJECT_DOC_BEHAVIOR = 'behavior:typed-config-project-doc-max-bytes-zero'
const CODEX_WEB_SEARCH_BEHAVIOR = 'behavior:typed-config-web-search-live'
const CODEX_NO_PROMPT_STDERR = 'Reading prompt from stdin...\nNo prompt provided via stdin.\n'
const CODEX_INVALID_CONFIG_DIAGNOSTICS: Readonly<Record<string, string>> = {
  [CODEX_INVALID_PROJECT_DOC_CONFIG]:
    'Error loading config.toml: invalid type: string "rolekit-invalid-value-canary", expected usize\nin `project_doc_max_bytes`\n\n',
  [CODEX_INVALID_WEB_SEARCH_CONFIG]:
    'Error loading config.toml: unknown variant `rolekit-invalid-value-canary`, expected one of `disabled`, `cached`, `indexed`, `live`\nin `web_search`\n\n',
}

function normalizeCodexProcessBoundary(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/gu, '\n')
}

function matchesCodexAcceptedTypedConfigError(error: unknown): boolean {
  return (
    error instanceof CliExitError &&
    error.exitCode === 1 &&
    error.signal === undefined &&
    normalizeCodexProcessBoundary(error.stdout) === '' &&
    normalizeCodexProcessBoundary(error.stderr) === CODEX_NO_PROMPT_STDERR
  )
}

function matchesCodexRejectedTypedConfigError(error: unknown, invalidValue: string): boolean {
  const diagnostic = CODEX_INVALID_CONFIG_DIAGNOSTICS[invalidValue]
  return (
    diagnostic !== undefined &&
    error instanceof CliExitError &&
    error.exitCode === 1 &&
    error.signal === undefined &&
    normalizeCodexProcessBoundary(error.stdout) === '' &&
    normalizeCodexProcessBoundary(error.stderr) === diagnostic
  )
}

function codexTypedConfigBehaviorCheck(
  feature: string,
  plan: CliArgumentPlan,
  productionValue: string,
  invalidValue: string,
): CliCompatibilityBehaviorCheck {
  const valueIndex = plan.args.findIndex(
    (argument, index) => argument === '-c' && plan.args[index + 1] === productionValue,
  )
  const exactProductionValue = plan.args[valueIndex + 1]
  if (valueIndex < 0 || exactProductionValue === undefined) {
    throw new TypeError(`Codex argument plan does not contain -c ${productionValue}.`)
  }
  if (CODEX_INVALID_CONFIG_DIAGNOSTICS[invalidValue] === undefined) {
    throw new TypeError(`Codex typed-config canary is not recognized: ${invalidValue}.`)
  }
  return {
    feature,
    acceptedArgs: ['exec', '--strict-config', '-c', exactProductionValue],
    rejectedArgs: ['exec', '--strict-config', '-c', invalidValue],
    matchesAcceptedError: matchesCodexAcceptedTypedConfigError,
    matchesRejectedError: (error: unknown) =>
      matchesCodexRejectedTypedConfigError(error, invalidValue),
  }
}

function codexEnvironmentOverrides(
  options: Readonly<CodexCliAdapterOptions>,
  isolatedDirectory?: string,
): Readonly<Record<string, string>> | undefined {
  if (options.inheritUserConfig === true) {
    const inheritedCodexHome = process.env.CODEX_HOME
    return inheritedCodexHome === undefined ? undefined : { CODEX_HOME: inheritedCodexHome }
  }
  if (isolatedDirectory === undefined) {
    throw new Error('Codex isolation requires a temporary user directory.')
  }
  return {
    CODEX_HOME: isolatedDirectory,
    ...isolatedUserEnvironment(isolatedDirectory),
  }
}

async function createCodexProbeEnvironment(
  options: Readonly<CodexCliAdapterOptions>,
): Promise<CliProbeEnvironment> {
  const temporaryDirectories: string[] = []
  const cleanup = async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    )
  }

  try {
    const probeDirectory =
      options.inheritUserConfig === true
        ? undefined
        : await mkdtemp(join(tmpdir(), 'rolekit-codex-probe-'))
    if (probeDirectory !== undefined) {
      temporaryDirectories.push(probeDirectory)
    }
    const behaviorDirectory = await mkdtemp(join(tmpdir(), 'rolekit-codex-behavior-'))
    temporaryDirectories.push(behaviorDirectory)
    const behaviorEnvironment = prepareCliEnvironment(
      undefined,
      {
        authenticationEnvironmentKeys: CODEX_AUTHENTICATION_ENVIRONMENT_KEYS,
        configHomeEnvironmentKeys: ['CODEX_HOME'],
      },
      {
        overrides: {
          CODEX_HOME: behaviorDirectory,
          ...isolatedUserEnvironment(behaviorDirectory),
        },
      },
    )
    const overrides =
      options.inheritUserConfig === true
        ? codexEnvironmentOverrides(options)
        : codexEnvironmentOverrides(options, probeDirectory)
    return {
      ...(overrides === undefined ? {} : { overrides }),
      behaviorEnvironment,
      cleanup,
    }
  } catch (error: unknown) {
    await cleanup()
    throw error
  }
}

type CodexSandbox = 'read-only' | 'workspace-write'

function codexSandbox(role: RoleSpec, task: TaskPacket): CodexSandbox {
  const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
  return required.has('repository.write') ? 'workspace-write' : 'read-only'
}

function truthfulCodexAdmission(
  admission: ExecutionAdmission,
  options: Readonly<CodexCliAdapterOptions>,
  probe: ExecutorProbe | undefined,
): ExecutionAdmission {
  const projectInstructions =
    options.inheritProjectInstructions === true
      ? 'inherited'
      : probe?.featureChecks[CODEX_PROJECT_DOC_BEHAVIOR] === true
        ? 'isolated'
        : 'unknown'
  const webVerified =
    options.webSearch === true &&
    (probe === undefined || probe.featureChecks[CODEX_WEB_SEARCH_BEHAVIOR] === true)
  const claims = {
    effectiveCapabilities: admission.effectiveCapabilities.filter(
      (capability) => capability !== 'web' || webVerified,
    ),
    effectivePublicOptions: {
      ...admission.effectivePublicOptions,
      projectDocMaxBytes:
        projectInstructions === 'inherited'
          ? 'inherited'
          : projectInstructions === 'isolated'
            ? 0
            : 'unknown',
    },
    pathEnforcement: admission.pathEnforcement,
    contextIsolation: {
      ...admission.contextIsolation,
      projectInstructions,
    },
  } as const
  return freezeJsonSnapshot(
    admission.allowed
      ? { allowed: true, ...claims }
      : { allowed: false, ...claims, blockedError: admission.blockedError },
    'Truthful Codex execution admission',
  ) as ExecutionAdmission
}

export class CodexCliAdapter extends CliAdapterBase<CodexCliAdapterOptions> {
  readonly id = 'codex'
  protected readonly displayName = 'Codex CLI'
  protected readonly defaultCommand = 'codex'
  protected readonly defaultCapabilities: readonly Capability[] = [
    'repository.read',
    'repository.write',
    'shell',
  ]
  protected override readonly authenticationEnvironmentKeys = CODEX_AUTHENTICATION_ENVIRONMENT_KEYS
  protected override readonly configHomeEnvironmentKeys = ['CODEX_HOME'] as const
  protected override readonly probeHelpArguments = ['exec', '--help'] as const
  protected override readonly minimumTestedVersion = '0.146.0'

  readonly #fileOperations: CodexFileOperations

  constructor(fileOperations: Partial<CodexFileOperations> = {}) {
    super()
    this.#fileOperations = { ...DEFAULT_FILE_OPERATIONS, ...fileOperations }
  }

  override prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<CodexCliAdapterOptions> {
    return prepareCodexCliAdapterOptions(options, publicContext)
  }

  override admit(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<CodexCliAdapterOptions>,
    probe?: ExecutorProbe,
  ): ExecutionAdmission {
    const options = prepared.executionOptions
    const admission = truthfulCodexAdmission(
      super.admit(role, task, prepared, probe),
      options,
      probe,
    )
    if (!admission.allowed) {
      return admission
    }

    if (probe?.available === true) {
      const missingBehaviorChecks = [
        ...(options.inheritProjectInstructions === true ||
        probe.featureChecks[CODEX_PROJECT_DOC_BEHAVIOR] === true
          ? []
          : [CODEX_PROJECT_DOC_BEHAVIOR]),
        ...(options.webSearch !== true || probe.featureChecks[CODEX_WEB_SEARCH_BEHAVIOR] === true
          ? []
          : [CODEX_WEB_SEARCH_BEHAVIOR]),
      ]
      if (missingBehaviorChecks.length > 0) {
        return freezeJsonSnapshot(
          {
            allowed: false,
            effectiveCapabilities: admission.effectiveCapabilities,
            effectivePublicOptions: admission.effectivePublicOptions,
            pathEnforcement: admission.pathEnforcement,
            contextIsolation: admission.contextIsolation,
            blockedError: {
              code: 'executor_unavailable',
              message: `Codex CLI did not certify required runtime behavior: ${missingBehaviorChecks.join(', ')}.`,
              retryable: true,
              details: { missingBehaviorChecks },
            },
          },
          'Codex behavior-check admission',
        ) as ExecutionAdmission
      }
    }

    try {
      createCodexWireResponseSchema(role.outputSchema)
    } catch (error: unknown) {
      if (!(error instanceof RolekitError) || error.code !== 'unsupported_output_schema') {
        throw error
      }
      return freezeJsonSnapshot(
        {
          allowed: false,
          effectiveCapabilities: admission.effectiveCapabilities,
          effectivePublicOptions: admission.effectivePublicOptions,
          pathEnforcement: admission.pathEnforcement,
          contextIsolation: admission.contextIsolation,
          blockedError: {
            code: error.code,
            message: error.message,
            retryable: false,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        'Codex output-schema admission',
      ) as ExecutionAdmission
    }

    return admission
  }

  protected override prepareProbeEnvironment(
    options: Readonly<CodexCliAdapterOptions>,
  ): Promise<CliProbeEnvironment> {
    return createCodexProbeEnvironment(options)
  }

  protected override requiredProbeHelpTokens(
    prepared: PreparedExecutorOptions<CodexCliAdapterOptions>,
  ): readonly string[] {
    return buildCodexArgumentPlan(
      prepared.executionOptions,
      '.',
      'response.schema.json',
      'response.json',
      'read-only',
    ).helpTokens
  }

  protected override compatibilityProbeFeatures(
    _prepared: PreparedExecutorOptions<CodexCliAdapterOptions>,
  ): Readonly<Record<string, readonly string[]>> {
    return {
      'exec:json': ['--json'],
      'structured-output:output-schema': ['--output-schema'],
      ephemeral: ['--ephemeral'],
      'isolation:user-config': ['--ignore-user-config'],
      'isolation:rules': ['--ignore-rules'],
    }
  }

  protected override compatibilityBehaviorChecks(
    prepared: PreparedExecutorOptions<CodexCliAdapterOptions>,
  ): readonly CliCompatibilityBehaviorCheck[] {
    const options = prepared.executionOptions
    const plan = buildCodexArgumentPlan(
      options,
      '.',
      'response.schema.json',
      'response.json',
      'read-only',
    )
    return [
      ...(options.inheritProjectInstructions === true
        ? []
        : [
            codexTypedConfigBehaviorCheck(
              CODEX_PROJECT_DOC_BEHAVIOR,
              plan,
              CODEX_PROJECT_DOC_CONFIG,
              CODEX_INVALID_PROJECT_DOC_CONFIG,
            ),
          ]),
      ...(options.webSearch === true
        ? [
            codexTypedConfigBehaviorCheck(
              CODEX_WEB_SEARCH_BEHAVIOR,
              plan,
              CODEX_WEB_SEARCH_CONFIG,
              CODEX_INVALID_WEB_SEARCH_CONFIG,
            ),
          ]
        : []),
    ]
  }

  protected override inspectedCapabilities(
    options: Readonly<CodexCliAdapterOptions>,
  ): readonly Capability[] {
    return [...this.defaultCapabilities, ...(options.webSearch === true ? (['web'] as const) : [])]
  }

  protected override effectiveCapabilities(
    role: RoleSpec,
    task: TaskPacket,
    options: Readonly<CodexCliAdapterOptions>,
  ): readonly Capability[] {
    const sandbox = codexSandbox(role, task)
    return [
      ...this.defaultCapabilities,
      ...(options.webSearch === true ? (['web'] as const) : []),
    ].filter((capability) => capability !== 'repository.write' || sandbox === 'workspace-write')
  }

  protected override supportFeatures(
    options: Readonly<CodexCliAdapterOptions>,
  ): ExecutorSupportFeatures {
    return {
      structuredOutput: 'native',
      events: true,
      cancellation: 'process',
      contextIsolation: this.contextIsolation(options),
      supportedPathEnforcement: ['advisory'],
      permissionCombinations: [
        'repository.read',
        'repository.read+repository.write',
        'repository.read+shell',
        'repository.read+repository.write+shell',
        ...(options.webSearch === true
          ? [
              'repository.read+web',
              'repository.read+repository.write+web',
              'repository.read+shell+web',
              'repository.read+repository.write+shell+web',
            ]
          : []),
      ],
    }
  }

  protected override contextIsolation(options: Readonly<CodexCliAdapterOptions>): ContextIsolation {
    const hasExplicitCredential = CODEX_AUTHENTICATION_ENVIRONMENT_KEYS.some(
      (key) => options.environment?.[key] !== undefined,
    )
    return {
      userConfig: options.inheritUserConfig === true ? 'inherited' : 'isolated',
      projectInstructions: options.inheritProjectInstructions === true ? 'inherited' : 'unknown',
      projectResources: 'unknown',
      environment: options.inheritAmbientEnvironment === true ? 'inherited' : 'minimal',
      credentials:
        options.inheritAmbientEnvironment === true
          ? 'inherited'
          : options.inheritUserConfig === true
            ? hasExplicitCredential
              ? 'unknown'
              : 'user-store'
            : 'explicit',
    }
  }

  protected override effectivePublicOptions(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<CodexCliAdapterOptions>,
  ): JsonObject {
    const options = prepared.executionOptions
    return {
      ...prepared.publicOptions,
      ...this.credentialPublicOptions(options, options.inheritUserConfig === true),
      command: options.command ?? this.defaultCommand,
      inheritAmbientEnvironment: options.inheritAmbientEnvironment ?? false,
      inheritUserConfig: options.inheritUserConfig ?? false,
      inheritProjectInstructions: options.inheritProjectInstructions ?? false,
      inheritExecPolicyRules: options.inheritExecPolicyRules ?? false,
      webSearch: options.webSearch ?? false,
      sandbox: codexSandbox(role, task),
      projectDocMaxBytes: options.inheritProjectInstructions === true ? 'inherited' : 'unknown',
      execPolicyRules: options.inheritExecPolicyRules === true ? 'inherited' : 'ignored',
      userConfig: options.inheritUserConfig === true ? 'inherited' : 'ignored',
      pathEnforcement: 'advisory',
    }
  }

  protected async executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<CodexCliAdapterOptions>,
    options: CodexCliAdapterOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    const wireSchema = createCodexWireResponseSchema(role.outputSchema)
    let temporaryDirectory: string
    try {
      temporaryDirectory = await this.#fileOperations.createTemporaryDirectory(
        join(tmpdir(), 'rolekit-codex-'),
      )
    } catch (error: unknown) {
      throw classifyFilesystemFailure(error, 'temporary_directory')
    }

    const schemaPath = join(temporaryDirectory, 'response.schema.json')
    const outputPath = join(temporaryDirectory, 'response.json')
    let primaryFailure: unknown
    let executorResponse: ExecutorResponse | undefined
    try {
      try {
        await this.#fileOperations.writeSchemaFile(
          schemaPath,
          `${JSON.stringify(wireSchema, null, 2)}\n`,
        )
      } catch (error: unknown) {
        throw classifyFilesystemFailure(error, 'schema_write')
      }

      const argumentPlan = buildCodexArgumentPlan(
        options,
        context.cwd,
        schemaPath,
        outputPath,
        codexSandbox(role, task),
      )
      const environmentOverrides = codexEnvironmentOverrides(options, temporaryDirectory)
      const processResult = await this.run(
        context,
        options,
        argumentPlan.args,
        buildCodexExecutionPrompt(role, task),
        signal,
        environmentOverrides,
      )
      if (processResult.exitCode !== 0) {
        throw new Error(
          processResult.stderr.trim() || `Codex CLI exited with code ${processResult.exitCode}.`,
        )
      }

      let finalText: string
      try {
        finalText = await this.#fileOperations.readRequiredOutput(outputPath)
      } catch (error: unknown) {
        throw classifyFilesystemFailure(error, 'required_output_read')
      }
      const { eventData, response } = this.parseProtocol(options, context.sensitiveValues, () => ({
        eventData: parseCodexEvents(processResult.stdout),
        response: parseCodexWireResponse(JSON.parse(finalText.trim())),
      }))
      executorResponse = {
        ...response,
        evidence: [
          ...(Array.isArray(response.evidence) ? response.evidence : []),
          {
            kind: 'command',
            value: processResult.commandDisplay,
            description: 'Codex CLI invocation',
          },
        ],
        usage: mergeUsage(eventData.usage, processResult.durationMs),
      }
    } catch (error: unknown) {
      primaryFailure = error
    }

    let cleanupFailure: Error | undefined
    try {
      await this.#fileOperations.cleanupTemporaryDirectory(temporaryDirectory)
    } catch (error: unknown) {
      cleanupFailure = classifyFilesystemFailure(error, 'cleanup')
    }

    if (primaryFailure !== undefined) {
      throw primaryFailure
    }
    if (cleanupFailure !== undefined) {
      throw cleanupFailure
    }
    if (executorResponse === undefined) {
      throw new Error('Codex execution completed without an executor response.')
    }
    return executorResponse
  }
}

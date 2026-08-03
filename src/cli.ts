import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

import {
  createBuiltInAdapter,
  createBuiltInAdapterRegistry,
  createConfiguredRun,
  UnknownBuiltInAdapterError,
} from './composition.ts'
import {
  compileRoleBinding,
  compileTaskExecutionTarget,
  inspectExecutorProfile,
  loadRolekitConfig,
  probeExecutorProfile,
  validateLoadedRolekitConfig,
} from './config/index.ts'
import type { CompiledExecutorProfile } from './config/types.ts'
import { RolekitConfigError } from './config/types.ts'
import {
  AnyRunResultSchema,
  assertCompilableSchema,
  assertExecutionPlanIntegrity,
  assertValid,
  createExecutionPlan,
  finalizeExecution,
  Rolekit,
  RolekitError,
  RoleSpecSchema,
  TaskPacketSchema,
} from './core/index.ts'
import type {
  AnyRunResult,
  ExecutionPlan,
  ExecutionReceipt,
  JsonObject,
  JsonSchema,
  ResolvedExecutionPlan,
  RoleSpec,
  RunResultV2,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TaskPacket,
} from './core/types.ts'

const HELP = `RoleKit

Portable role and task contracts for invoking coding agents across hosts.

Usage:
  rolekit config validate --config <file> [--json]
  rolekit compile --config <file> --role <role-id> --task <file>
                  [--executor <profile-id>] [--cwd <path>] [--run-id <id>]
                  [--created-at <iso>] [--json]
  rolekit run --config <file> --role <role-id> --task <file>
              [--executor <profile-id>] [--cwd <path>] [--json]
  rolekit finalize --plan <file> --receipt <file> [--json]
  rolekit executors list --config <file> [--json]
  rolekit executors describe --config <file> --executor <profile-id>
                             [--cwd <path>] [--probe] [--json]
  rolekit validate role <file> [--json]
  rolekit validate task <file> [--json]
  rolekit validate result <file> [--json]
  rolekit --version

Legacy compatibility: rolekit run --role <file> --task <file> --executor <built-in-id>
                      [--cwd <path>] [--options <file>] [--json]
`

const LEGACY_RUN_WARNING = Object.freeze({
  code: 'legacy_run_deprecated',
  message:
    'Legacy run flags are deprecated; use run --config <file> --role <role-id> --task <file>.',
})

export interface CliWarning {
  readonly code: string
  readonly message: string
}

export interface CliErrorEnvelope {
  readonly code: string
  readonly message: string
  readonly sourcePath?: string
  readonly pointer?: string
  readonly details?: JsonObject
}

export type CliJsonEnvelope<T> =
  | { readonly ok: true; readonly data: T; readonly warnings: readonly CliWarning[] }
  | {
      readonly ok: false
      readonly error: CliErrorEnvelope
      readonly warnings: readonly CliWarning[]
    }

class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

interface ParsedArguments {
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string | true>
}

interface CommandResult<T = unknown> {
  readonly exitCode: number
  readonly data: T
  readonly text: string
}

type CliSignal = 'SIGINT' | 'SIGTERM'

interface CommandContext {
  readonly warnings: CliWarning[]
  readonly signal: AbortSignal
  receivedSignal?: CliSignal
}

const BOOLEAN_FLAGS = new Set(['help', 'json', 'probe', 'version'])

function parseArguments(args: readonly string[]): ParsedArguments {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) {
      continue
    }
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const name = argument.slice(2)
    if (name.length === 0) {
      throw new CliUsageError('Flag name cannot be empty.')
    }
    if (flags.has(name)) {
      throw new CliUsageError(`Flag "--${name}" was provided more than once.`)
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true)
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CliUsageError(`Flag "--${name}" requires a value.`)
    }
    flags.set(name, value)
    index += 1
  }
  return { positional, flags }
}

function assertAllowedFlags(parsed: ParsedArguments, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  const unsupported = [...parsed.flags.keys()].filter((flag) => !allowedSet.has(flag))
  if (unsupported.length > 0) {
    throw new CliUsageError(
      `Unsupported flags: ${unsupported.map((flag) => `--${flag}`).join(', ')}.`,
    )
  }
}

function assertPositionalLength(parsed: ParsedArguments, expected: number, message: string): void {
  if (parsed.positional.length !== expected) {
    throw new CliUsageError(message)
  }
}

function stringFlag(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function requireStringFlag(parsed: ParsedArguments, name: string): string {
  const value = stringFlag(parsed, name)
  if (value === undefined) {
    throw new CliUsageError(`Missing required flag "--${name}".`)
  }
  return value
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadData(filePath: string, label: string): Promise<unknown> {
  const absolutePath = resolve(filePath)
  let source: string
  try {
    source = await readFile(absolutePath, 'utf8')
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? ` (${error.code})`
        : ''
    throw new RolekitError(
      'invalid_contract',
      `Unable to read ${label} file ${absolutePath}${code}.`,
    )
  }
  try {
    const extension = extname(absolutePath).toLowerCase()
    return extension === '.yaml' || extension === '.yml'
      ? parseYaml(source)
      : (JSON.parse(source) as unknown)
  } catch {
    throw new RolekitError('invalid_contract', `Unable to parse ${label} file ${absolutePath}.`)
  }
}

function validateRole(value: unknown): asserts value is RoleSpec {
  assertValid(RoleSpecSchema as JsonSchema, value, 'Role')
  const role = value as RoleSpec
  assertCompilableSchema(role.inputSchema, `Role "${role.id}" inputSchema`)
  assertCompilableSchema(role.outputSchema, `Role "${role.id}" outputSchema`)
}

function validateTask(value: unknown): asserts value is TaskPacket {
  assertValid(TaskPacketSchema as JsonSchema, value, 'Task')
}

function validateResult(value: unknown): asserts value is AnyRunResult {
  assertValid(AnyRunResultSchema as JsonSchema, value, 'Run result')
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function resultExitCode(result: RunResultV2, receivedSignal?: CliSignal): number {
  switch (result.status) {
    case 'completed':
      return 0
    case 'blocked':
      return 4
    case 'failed':
      return 1
    case 'cancelled':
      if (receivedSignal === 'SIGINT') {
        return 130
      }
      if (receivedSignal === 'SIGTERM') {
        return 143
      }
      return 1
  }
}

function signalExitCode(signal: CliSignal): 130 | 143 {
  return signal === 'SIGINT' ? 130 : 143
}

function assertCommandActive(context: CommandContext): void {
  if (context.receivedSignal !== undefined) {
    throw new Error(`CLI command interrupted by ${context.receivedSignal}.`)
  }
}

function cancellationError(signal: CliSignal): CliErrorEnvelope {
  return {
    code: 'cancelled',
    message: `CLI command interrupted by ${signal}.`,
  }
}

function isCancelledRunResult(value: unknown): value is RunResultV2 {
  return isRecord(value) && value.schema === 'rolekit/run-result@2' && value.status === 'cancelled'
}

async function packageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as Readonly<Record<string, unknown>>
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('Package version is unavailable.')
  }
  return packageJson.version
}

function processEnvironmentSnapshot(): Readonly<Record<string, string | undefined>> {
  return Object.freeze(Object.fromEntries(Object.entries(process.env)))
}

async function validateCommand(parsed: ParsedArguments): Promise<CommandResult> {
  assertAllowedFlags(parsed, ['json'])
  assertPositionalLength(parsed, 3, 'Validate requires a kind and a file path.')
  const kind = parsed.positional[1]
  const file = parsed.positional[2]
  if (kind === undefined || file === undefined) {
    throw new CliUsageError('Validate requires a kind and a file path.')
  }
  const value = await loadData(file, kind)
  switch (kind) {
    case 'role':
      validateRole(value)
      break
    case 'task':
      validateTask(value)
      break
    case 'result':
      validateResult(value)
      break
    default:
      throw new CliUsageError(`Unknown contract kind "${kind}".`)
  }
  const data = { valid: true, kind, file: resolve(file) }
  return { exitCode: 0, data, text: `Valid ${kind}: ${resolve(file)}\n` }
}

async function configValidateCommand(parsed: ParsedArguments): Promise<CommandResult> {
  assertAllowedFlags(parsed, ['config', 'json'])
  assertPositionalLength(parsed, 2, 'Config validate accepts flags only.')
  if (parsed.positional[1] !== 'validate') {
    throw new CliUsageError(`Unknown config command "${parsed.positional[1] ?? ''}".`)
  }
  const configPath = requireStringFlag(parsed, 'config')
  const registry = createBuiltInAdapterRegistry()
  const loaded = await loadRolekitConfig(configPath)
  await validateLoadedRolekitConfig(loaded, registry)
  const executorIds = Object.keys(loaded.executors).sort()
  const roleIds = Object.keys(loaded.roles).sort()
  const data = {
    valid: true,
    config: loaded.rootPath,
    sourcePaths: loaded.sourcePaths,
    roles: roleIds,
    executors: executorIds,
  }
  return { exitCode: 0, data, text: `Valid config: ${loaded.rootPath}\n` }
}

async function compileCommand(parsed: ParsedArguments): Promise<CommandResult> {
  assertAllowedFlags(parsed, [
    'config',
    'role',
    'task',
    'executor',
    'cwd',
    'run-id',
    'created-at',
    'json',
  ])
  assertPositionalLength(parsed, 1, 'Compile accepts flags only.')
  const configPath = requireStringFlag(parsed, 'config')
  const roleId = requireStringFlag(parsed, 'role')
  const taskPath = requireStringFlag(parsed, 'task')
  const taskValue = await loadData(taskPath, 'task')
  validateTask(taskValue)
  const registry = createBuiltInAdapterRegistry()
  const loaded = await loadRolekitConfig(configPath)
  const binding = await compileRoleBinding(loaded, roleId, registry, stringFlag(parsed, 'executor'))
  const target = compileTaskExecutionTarget(binding, taskValue)
  const resolvedPlan = await createExecutionPlan({
    role: binding.role as unknown as SnapshotRoleSpec,
    task: taskValue as unknown as SnapshotTaskPacket,
    target,
    workspace: { root: resolve(stringFlag(parsed, 'cwd') ?? process.cwd()) },
    runId: stringFlag(parsed, 'run-id') ?? randomUUID(),
    createdAt: stringFlag(parsed, 'created-at') ?? new Date().toISOString(),
  })
  const exitCode = target.admission.allowed ? 0 : 4
  return { exitCode, data: resolvedPlan, text: prettyJson(resolvedPlan) }
}

async function legacyRunCommand(
  parsed: ParsedArguments,
  context: CommandContext,
): Promise<CommandResult> {
  assertAllowedFlags(parsed, ['role', 'task', 'executor', 'cwd', 'options', 'json'])
  assertPositionalLength(parsed, 1, 'Run accepts flags only.')
  context.warnings.push(LEGACY_RUN_WARNING)
  const rolePath = requireStringFlag(parsed, 'role')
  const taskPath = requireStringFlag(parsed, 'task')
  const executorId = requireStringFlag(parsed, 'executor')
  let adapter: ReturnType<typeof createBuiltInAdapter>
  try {
    adapter = createBuiltInAdapter(executorId)
  } catch (error: unknown) {
    if (error instanceof UnknownBuiltInAdapterError) {
      throw new CliUsageError(error.message)
    }
    throw error
  }
  const roleValue = await loadData(rolePath, 'role')
  const taskValue = await loadData(taskPath, 'task')
  validateRole(roleValue)
  validateTask(taskValue)
  const adapterOptionsPath = stringFlag(parsed, 'options')
  const adapterOptions =
    adapterOptionsPath === undefined ? {} : await loadData(adapterOptionsPath, 'adapter options')
  const rolekit = new Rolekit({ roles: [roleValue], adapters: [adapter] })
  assertCommandActive(context)
  const result = await rolekit.run(taskValue, {
    executorId,
    cwd: resolve(stringFlag(parsed, 'cwd') ?? process.cwd()),
    adapterOptions,
    signal: context.signal,
  })
  return {
    exitCode: resultExitCode(result, context.receivedSignal),
    data: result,
    text: `[${result.status}] ${result.runId}: ${result.summary}\n`,
  }
}

async function configuredRunCommand(
  parsed: ParsedArguments,
  context: CommandContext,
): Promise<CommandResult> {
  assertAllowedFlags(parsed, ['config', 'role', 'task', 'executor', 'cwd', 'json'])
  assertPositionalLength(parsed, 1, 'Run accepts flags only.')
  const configPath = requireStringFlag(parsed, 'config')
  const roleId = requireStringFlag(parsed, 'role')
  const taskPath = requireStringFlag(parsed, 'task')
  const taskValue = await loadData(taskPath, 'task')
  validateTask(taskValue)
  assertCommandActive(context)
  const configured = await createConfiguredRun({
    configPath,
    roleId,
    environment: processEnvironmentSnapshot(),
    ...(stringFlag(parsed, 'executor') === undefined
      ? {}
      : { executorProfileId: stringFlag(parsed, 'executor') as string }),
  })
  assertCommandActive(context)
  const result = await configured.run(taskValue, {
    cwd: resolve(stringFlag(parsed, 'cwd') ?? process.cwd()),
    signal: context.signal,
  })
  return {
    exitCode: resultExitCode(result, context.receivedSignal),
    data: result,
    text: `[${result.status}] ${result.runId}: ${result.summary}\n`,
  }
}

async function runCommand(
  parsed: ParsedArguments,
  context: CommandContext,
): Promise<CommandResult> {
  return parsed.flags.has('config')
    ? configuredRunCommand(parsed, context)
    : legacyRunCommand(parsed, context)
}

async function loadResolvedPlan(filePath: string): Promise<ResolvedExecutionPlan> {
  const value = await loadData(filePath, 'execution plan')
  if (!isRecord(value)) {
    throw new RolekitError(
      'invalid_contract',
      'Resolved execution plan must be an object containing plan and planDigest.',
    )
  }
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'plan' || keys[1] !== 'planDigest') {
    throw new RolekitError(
      'invalid_contract',
      'Resolved execution plan must contain exactly plan and planDigest.',
    )
  }
  if (typeof value.planDigest !== 'string') {
    throw new RolekitError('invalid_contract', 'Resolved execution plan planDigest is invalid.')
  }
  const checked = await assertExecutionPlanIntegrity(value.plan as ExecutionPlan)
  if (checked.planDigest !== value.planDigest) {
    throw new RolekitError(
      'invalid_contract',
      'Resolved execution plan planDigest does not match the plan instance.',
    )
  }
  return checked
}

async function finalizeCommand(parsed: ParsedArguments): Promise<CommandResult> {
  assertAllowedFlags(parsed, ['plan', 'receipt', 'json'])
  assertPositionalLength(parsed, 1, 'Finalize accepts flags only.')
  const resolvedPlan = await loadResolvedPlan(requireStringFlag(parsed, 'plan'))
  const receipt = (await loadData(
    requireStringFlag(parsed, 'receipt'),
    'execution receipt',
  )) as ExecutionReceipt
  const result = await finalizeExecution(resolvedPlan, receipt)
  return {
    exitCode: resultExitCode(result),
    data: result,
    text: `[${result.status}] ${result.runId}: ${result.summary}\n`,
  }
}

function describeExecutorProfile(
  profile: CompiledExecutorProfile,
): Readonly<Record<string, unknown>> {
  const common = {
    profileId: profile.executorProfileId,
    mode: profile.profile.mode,
    executorId: profile.executorId,
    transport: profile.descriptor.transport,
    capabilitySource: profile.capabilitySource,
    capabilities: profile.descriptor.capabilities,
    contextIsolation:
      profile.capabilitySource === 'adapter-verified'
        ? profile.descriptor.features.contextIsolation
        : profile.descriptor.contextIsolation,
    supportedPathEnforcement:
      profile.capabilitySource === 'adapter-verified'
        ? profile.descriptor.features.supportedPathEnforcement
        : [profile.descriptor.pathEnforcement],
    publicOptions: profile.profilePublicOptions,
    requiredSecrets: profile.requiredSecrets,
    profileDigest: profile.profileDigest,
  }
  return Object.freeze(
    profile.capabilitySource === 'adapter-verified'
      ? {
          ...common,
          adapterProtocol: profile.descriptor.adapterProtocol,
          adapterVersion: profile.descriptor.adapterVersion,
          ...(profile.inspectionPreparedOptions.requestedProvider === undefined
            ? {}
            : { requestedProvider: profile.inspectionPreparedOptions.requestedProvider }),
          ...(profile.inspectionPreparedOptions.requestedModel === undefined
            ? {}
            : { requestedModel: profile.inspectionPreparedOptions.requestedModel }),
        }
      : {
          ...common,
          ...(profile.profile.requestedProvider === undefined
            ? {}
            : { requestedProvider: profile.profile.requestedProvider }),
          ...(profile.profile.requestedModel === undefined
            ? {}
            : { requestedModel: profile.profile.requestedModel }),
        },
  )
}

async function executorsCommand(
  parsed: ParsedArguments,
  context: CommandContext,
): Promise<CommandResult> {
  const subcommand = parsed.positional[1]
  if (subcommand === 'list') {
    assertAllowedFlags(parsed, ['config', 'json'])
    assertPositionalLength(parsed, 2, 'Executors list accepts flags only.')
    const registry = createBuiltInAdapterRegistry()
    const loaded = await loadRolekitConfig(requireStringFlag(parsed, 'config'))
    const executors: {
      readonly profileId: string
      readonly mode: string
      readonly executorId: string
    }[] = []
    for (const profileId of Object.keys(loaded.executors).sort()) {
      const profile = await inspectExecutorProfile(loaded, profileId, registry)
      executors.push({
        profileId,
        mode: profile.profile.mode,
        executorId: profile.executorId,
      })
    }
    const data = { executors }
    return {
      exitCode: 0,
      data,
      text: `${executors.map((entry) => `${entry.profileId}\t${entry.mode}\t${entry.executorId}`).join('\n')}\n`,
    }
  }

  if (subcommand === 'describe') {
    assertAllowedFlags(parsed, ['config', 'executor', 'cwd', 'probe', 'json'])
    assertPositionalLength(parsed, 2, 'Executors describe accepts flags only.')
    const registry = createBuiltInAdapterRegistry()
    const loaded = await loadRolekitConfig(requireStringFlag(parsed, 'config'))
    const profile = await inspectExecutorProfile(
      loaded,
      requireStringFlag(parsed, 'executor'),
      registry,
    )
    const description = describeExecutorProfile(profile)
    let data: Readonly<Record<string, unknown>> = description
    if (parsed.flags.has('probe')) {
      assertCommandActive(context)
      const probe =
        profile.capabilitySource === 'adapter-verified'
          ? await probeExecutorProfile(
              profile,
              resolve(stringFlag(parsed, 'cwd') ?? process.cwd()),
              context.signal,
            )
          : {
              available: false,
              featureChecks: {},
              diagnostic: 'Host-native profiles do not expose an adapter executable to probe.',
            }
      data = Object.freeze({ ...description, probe })
    }
    return { exitCode: 0, data, text: prettyJson(data) }
  }

  throw new CliUsageError(`Unknown executors command "${subcommand ?? ''}".`)
}

async function executeCommand(
  parsed: ParsedArguments,
  context: CommandContext,
): Promise<CommandResult> {
  if (parsed.flags.has('help') || parsed.positional[0] === 'help') {
    assertAllowedFlags(parsed, ['help', 'json'])
    return { exitCode: 0, data: { help: HELP }, text: HELP }
  }
  if (parsed.flags.has('version')) {
    assertAllowedFlags(parsed, ['version', 'json'])
    assertPositionalLength(parsed, 0, '--version does not accept positional arguments.')
    const version = await packageVersion()
    return { exitCode: 0, data: { version }, text: `${version}\n` }
  }
  switch (parsed.positional[0]) {
    case 'validate':
      return validateCommand(parsed)
    case 'config':
      return configValidateCommand(parsed)
    case 'compile':
      return compileCommand(parsed)
    case 'run':
      return runCommand(parsed, context)
    case 'finalize':
      return finalizeCommand(parsed)
    case 'executors':
      return executorsCommand(parsed, context)
    case undefined:
      return { exitCode: 0, data: { help: HELP }, text: HELP }
    default:
      throw new CliUsageError(`Unknown command "${parsed.positional[0]}".`)
  }
}

function cliError(error: unknown): { readonly error: CliErrorEnvelope; readonly exitCode: number } {
  if (error instanceof CliUsageError) {
    return { error: { code: 'usage_error', message: error.message }, exitCode: 2 }
  }
  if (error instanceof RolekitConfigError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.sourcePath === undefined ? {} : { sourcePath: error.sourcePath }),
        ...(error.pointer === undefined ? {} : { pointer: error.pointer }),
      },
      exitCode: error.code === 'host_execution_required' ? 4 : 3,
    }
  }
  if (error instanceof RolekitError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      exitCode: 3,
    }
  }
  let message = 'Unexpected CLI failure.'
  try {
    if (error instanceof Error && error.message.length > 0) {
      message = error.message
    } else if (typeof error === 'string' && error.length > 0) {
      message = error
    }
  } catch {
    // Hostile thrown values use the fixed message.
  }
  return { error: { code: 'unexpected_error', message }, exitCode: 1 }
}

async function writeStdout(value: string): Promise<void> {
  await new Promise<void>((resolveWrite, rejectWrite) =>
    process.stdout.write(value, (error) => (error == null ? resolveWrite() : rejectWrite(error))),
  )
}

async function writeStderr(value: string): Promise<void> {
  await new Promise<void>((resolveWrite, rejectWrite) =>
    process.stderr.write(value, (error) => (error == null ? resolveWrite() : rejectWrite(error))),
  )
}

function textWarnings(warnings: readonly CliWarning[]): string {
  return warnings.map((warning) => `Warning [${warning.code}]: ${warning.message}\n`).join('')
}

async function renderFailure(
  json: boolean,
  failure: { readonly error: CliErrorEnvelope; readonly exitCode: number },
  warnings: readonly CliWarning[],
): Promise<void> {
  if (json) {
    const envelope: CliJsonEnvelope<never> = {
      ok: false,
      error: failure.error,
      warnings,
    }
    await writeStdout(prettyJson(envelope))
    return
  }
  await writeStderr(`${textWarnings(warnings)}[${failure.error.code}] ${failure.error.message}\n`)
}

export async function runCli(args: readonly string[]): Promise<number> {
  const json = args.includes('--json')
  const controller = new AbortController()
  const context: CommandContext = { warnings: [], signal: controller.signal }
  const captureSignal = (signal: CliSignal): void => {
    context.receivedSignal ??= signal
    controller.abort()
  }
  const onSigint = (): void => captureSignal('SIGINT')
  const onSigterm = (): void => captureSignal('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  try {
    let result: CommandResult
    try {
      const parsed = parseArguments(args)
      result = await executeCommand(parsed, context)
    } catch (error: unknown) {
      const receivedSignal = context.receivedSignal
      const failure =
        receivedSignal === undefined
          ? cliError(error)
          : {
              error: cancellationError(receivedSignal),
              exitCode: signalExitCode(receivedSignal),
            }
      await renderFailure(json, failure, context.warnings)
      return context.receivedSignal === undefined
        ? failure.exitCode
        : signalExitCode(context.receivedSignal)
    }

    const receivedSignal = context.receivedSignal
    if (receivedSignal !== undefined && !isCancelledRunResult(result.data)) {
      const failure = {
        error: cancellationError(receivedSignal),
        exitCode: signalExitCode(receivedSignal),
      }
      await renderFailure(json, failure, context.warnings)
      return signalExitCode(context.receivedSignal ?? receivedSignal)
    }

    if (json) {
      const envelope: CliJsonEnvelope<unknown> = {
        ok: true,
        data: result.data,
        warnings: context.warnings,
      }
      await writeStdout(prettyJson(envelope))
    } else {
      const warnings = textWarnings(context.warnings)
      if (warnings.length > 0) {
        await writeStderr(warnings)
      }
      await writeStdout(result.text)
    }
    return context.receivedSignal === undefined
      ? result.exitCode
      : signalExitCode(context.receivedSignal)
  } finally {
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
  }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runCli(args)
}

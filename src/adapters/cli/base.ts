import { mergeCapabilities, missingCapabilities } from '../../core/capabilities.ts'
import { freezeJsonSnapshot } from '../../core/json.ts'
import type {
  Capability,
  ContextIsolation,
  ExecutionAdmission,
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorProbe,
  ExecutorResponse,
  ExecutorSupportFeatures,
  JsonObject,
  PreparedExecutorOptions,
  ProbeContext,
  PublicOptionContext,
  RoleSpec,
  TaskPacket,
} from '../../core/types.ts'
import {
  CliAdapterError,
  CliAuthenticationError,
  CliConfigurationError,
  type CliExecutionError,
  CliExitError,
  CliProtocolError,
  CliSpawnError,
  isCliExecutionError,
} from './errors.ts'
import {
  assertSupportedOptionKeys,
  type CliEnvironmentControls,
  type CommonCliProcessOptions,
  type PreparedCliEnvironment,
  parseCommonCliProcessOptions,
  prepareCliEnvironment,
  prepareExecutorOptions,
  readOptionRecord,
} from './options.ts'
import { type CliProcessOptions, type CliProcessResult, runCliProcess } from './process.ts'
import { type RedactionContext, redactText } from './redaction.ts'
import { createCliCompatibilityReport } from './version.ts'

const AUTHENTICATION_FAILURE =
  /(?:\b401\b|\b403\b|unauthori[sz]ed|unauthenticated|authentication (?:failed|required)|invalid (?:api[- ]?key|access token|token|credential)|expired (?:access token|token|credential))/iu
const CONFIGURATION_FAILURE =
  /(?:configuration (?:error|failed|invalid)|invalid configuration|not configured|unknown (?:option|argument|flag)|invalid (?:option|argument|flag)|missing required (?:option|argument|configuration)|config(?:uration)? file .*not found)/iu

function safeErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error && error.message.length > 0) {
      return error.message
    }
    if (typeof error === 'string' && error.length > 0) {
      return error
    }
  } catch {
    // Hostile thrown values must not escape adapter-failure normalization.
  }
  return 'CLI adapter execution failed.'
}

function classifyCliFailure(error: unknown, redaction: RedactionContext): CliExecutionError {
  if (error instanceof CliExitError) {
    if (error.signal !== undefined) {
      return error
    }
    const diagnostic = `${error.message}\n${error.stderr ?? ''}`
    if (AUTHENTICATION_FAILURE.test(diagnostic)) {
      return new CliAuthenticationError(error.message)
    }
    if (CONFIGURATION_FAILURE.test(diagnostic)) {
      return new CliConfigurationError(error.message)
    }
    return error
  }
  if (isCliExecutionError(error)) {
    return error
  }
  const message = redactText(safeErrorMessage(error), redaction)
  return new CliAdapterError(message)
}

function commandEvidence(
  error: unknown,
  redaction: RedactionContext,
): ExecutorResponse['evidence'] {
  if (
    (error instanceof CliExitError || error instanceof CliSpawnError) &&
    error.commandDisplay !== undefined
  ) {
    return [
      {
        kind: 'command',
        value: redactText(error.commandDisplay, redaction),
        description: 'CLI invocation',
      },
    ]
  }
  return []
}

function blockedError(code: string, message: string, retryable: boolean, details?: JsonObject) {
  return {
    code,
    message,
    retryable,
    ...(details === undefined ? {} : { details }),
  }
}

function frozenAdmission(admission: ExecutionAdmission): ExecutionAdmission {
  return freezeJsonSnapshot(admission, 'Execution admission') as ExecutionAdmission
}

export type CliArgumentSegment =
  | string
  | {
      readonly flag: string
      readonly values?: readonly string[]
    }

export interface CliArgumentPlan {
  readonly args: readonly string[]
  readonly helpTokens: readonly string[]
}

export interface CliProbeEnvironment {
  readonly overrides?: Readonly<Record<string, string>>
  readonly behaviorEnvironment?: PreparedCliEnvironment
  readonly cleanup?: () => Promise<void>
}

export interface CliCompatibilityBehaviorCheck {
  readonly feature: string
  readonly acceptedArgs: readonly string[]
  readonly rejectedArgs: readonly string[]
  readonly matchesAcceptedResult?: (result: CliProcessResult) => boolean
  readonly matchesAcceptedError?: (error: unknown) => boolean
  readonly matchesRejectedResult?: (result: CliProcessResult) => boolean
  readonly matchesRejectedError?: (error: unknown) => boolean
}

export function buildCliArgumentPlan(segments: readonly CliArgumentSegment[]): CliArgumentPlan {
  const args: string[] = []
  const helpTokens = new Set<string>()
  for (const segment of segments) {
    if (typeof segment === 'string') {
      args.push(segment)
      continue
    }
    args.push(segment.flag, ...(segment.values ?? []))
    helpTokens.add(segment.flag)
  }
  return { args, helpTokens: [...helpTokens] }
}

interface ExactValueBehaviorCheckBaseOptions {
  readonly suffixArgs?: readonly string[]
  readonly matchesAcceptedResult?: (result: CliProcessResult) => boolean
}

type ExactValueBehaviorCheckOptions = ExactValueBehaviorCheckBaseOptions &
  (
    | {
        readonly matchesRejectedResult: (result: CliProcessResult) => boolean
        readonly matchesRejectedError?: (error: unknown) => boolean
      }
    | {
        readonly matchesRejectedResult?: (result: CliProcessResult) => boolean
        readonly matchesRejectedError: (error: unknown) => boolean
      }
  )

export function exactValueBehaviorCheck(
  feature: string,
  plan: CliArgumentPlan,
  flag: string,
  valueCount: number,
  options: ExactValueBehaviorCheckOptions,
): CliCompatibilityBehaviorCheck {
  const index = plan.args.indexOf(flag)
  if (index < 0 || plan.args.length < index + valueCount + 1) {
    throw new TypeError(`CLI argument plan does not contain ${flag} with ${valueCount} value(s).`)
  }
  const acceptedSegment = plan.args.slice(index, index + valueCount + 1)
  const suffixArgs = options.suffixArgs ?? ['--help']
  const rejectedValues = Array.from({ length: valueCount }, (_value, valueIndex) =>
    valueCount === 1
      ? 'rolekit-invalid-value-canary'
      : `rolekit-invalid-value-canary-${valueIndex + 1}`,
  )
  return {
    feature,
    acceptedArgs: [...acceptedSegment, ...suffixArgs],
    rejectedArgs: [flag, ...rejectedValues, ...suffixArgs],
    ...(options.matchesAcceptedResult === undefined
      ? {}
      : { matchesAcceptedResult: options.matchesAcceptedResult }),
    ...(options.matchesRejectedResult === undefined
      ? {}
      : { matchesRejectedResult: options.matchesRejectedResult }),
    ...(options.matchesRejectedError === undefined
      ? {}
      : { matchesRejectedError: options.matchesRejectedError }),
  }
}

function exactHelpTokens(help: string): ReadonlySet<string> {
  const tokens = new Set<string>()
  const pattern = /(?:^|[^A-Za-z0-9_-])(--?[A-Za-z][A-Za-z0-9-]*)(?=$|[^A-Za-z0-9_-])/gu
  for (const match of help.matchAll(pattern)) {
    const token = match[1]
    if (token !== undefined) {
      tokens.add(token)
    }
  }
  return tokens
}

export abstract class CliAdapterBase<
  TOptions extends CommonCliProcessOptions = CommonCliProcessOptions,
> implements ExecutorAdapter<TOptions>
{
  abstract readonly id: string
  readonly sensitiveOptionPointers = ['/environment'] as const
  protected abstract readonly displayName: string
  protected abstract readonly defaultCommand: string
  protected abstract readonly defaultCapabilities: readonly Capability[]
  protected readonly adapterVersion = '1.0.0'
  protected readonly authenticationEnvironmentKeys: readonly string[] = []
  protected readonly configHomeEnvironmentKeys: readonly string[] = []
  protected readonly profileEnvironmentKeys: readonly string[] = []
  protected readonly probeVersionArguments: readonly string[] = ['--version']
  protected readonly probeHelpArguments: readonly string[] = ['--help']
  protected readonly minimumTestedVersion: string = '0.0.0'
  protected readonly emitsProtocolEvents: boolean = false

  readonly #inflight = new Map<string, AbortController>()

  prepareOptions(
    optionsValue: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<TOptions> {
    const record = readOptionRecord(optionsValue)
    assertSupportedOptionKeys(record, [])
    const options = parseCommonCliProcessOptions(record, this.environmentControls()) as TOptions
    return prepareExecutorOptions(options, publicContext)
  }

  inspect(prepared: PreparedExecutorOptions<TOptions>): ExecutorDescriptorV2 {
    const descriptor: ExecutorDescriptorV2 = {
      schema: 'rolekit/executor-descriptor@2',
      adapterProtocol: 'rolekit/executor-adapter@1',
      adapterVersion: this.adapterVersion,
      id: this.id,
      displayName: this.displayName,
      transport: 'cli',
      capabilities: this.inspectedCapabilities(prepared.executionOptions),
      features: this.supportFeatures(prepared.executionOptions),
    }
    return freezeJsonSnapshot(descriptor, `Executor descriptor "${this.id}"`)
  }

  prepareProbeOptions(
    prepared: PreparedExecutorOptions<TOptions>,
  ): PreparedExecutorOptions<TOptions> {
    const probeOptions: Record<string, unknown> = { ...prepared.executionOptions }
    delete probeOptions.environment
    return this.prepareOptions(probeOptions)
  }

  async probe(
    prepared: PreparedExecutorOptions<TOptions>,
    context: ProbeContext,
  ): Promise<ExecutorProbe> {
    const options = prepared.executionOptions
    let probeEnvironment: CliProbeEnvironment
    try {
      probeEnvironment = await this.prepareProbeEnvironment(options)
    } catch (error: unknown) {
      const runtime = this.prepareEnvironment(options)
      const redaction = {
        sensitiveFlags: [],
        sensitiveValues: [...prepared.sensitiveValues, ...runtime.sensitiveValues],
      }
      return freezeJsonSnapshot(
        {
          available: false,
          featureChecks: {},
          diagnostic: redactText(safeErrorMessage(error), redaction),
        },
        `${this.displayName} probe`,
      )
    }

    try {
      const runtime = this.prepareEnvironment(options, probeEnvironment.overrides)
      const behaviorRuntime = probeEnvironment.behaviorEnvironment ?? runtime
      const sensitiveValues = [...prepared.sensitiveValues, ...runtime.sensitiveValues]
      const command = options.command ?? this.defaultCommand
      const timeoutMs = Math.min(options.timeoutMs ?? 5_000, 30_000)
      const maxOutputBytes = Math.min(options.maxOutputBytes ?? 128 * 1024, 128 * 1024)
      const redaction = { sensitiveFlags: [], sensitiveValues }
      const behaviorRedaction = {
        sensitiveFlags: [],
        sensitiveValues: [...prepared.sensitiveValues, ...behaviorRuntime.sensitiveValues],
      }
      const featureChecks: Record<string, boolean> = {}
      let executorVersion: string | undefined

      try {
        const compatibilityProbeFeatures = this.compatibilityProbeFeatures(prepared)
        const compatibilityBehaviorChecks = this.compatibilityBehaviorChecks(prepared)
        const versionResult = await runCliProcess({
          command,
          args: this.probeVersionArguments,
          cwd: context.cwd,
          environment: runtime.environment,
          redaction,
          timeoutMs,
          maxOutputBytes,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        })
        const versionLine = (versionResult.stdout.trim() || versionResult.stderr.trim()).split(
          /\r?\n/u,
        )[0]
        featureChecks.version = versionLine !== undefined && versionLine.length > 0

        const helpResult = await runCliProcess({
          command,
          args: this.probeHelpArguments,
          cwd: context.cwd,
          environment: runtime.environment,
          redaction,
          timeoutMs,
          maxOutputBytes,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        })
        const help = `${helpResult.stdout}\n${helpResult.stderr}`
        featureChecks.help = help.trim().length > 0
        const advertisedHelpTokens = exactHelpTokens(help)
        const requiredHelpTokens = [
          ...new Set([
            ...this.requiredProbeHelpTokens(prepared),
            ...Object.values(compatibilityProbeFeatures).flat(),
          ]),
        ]
        for (const token of requiredHelpTokens) {
          featureChecks[`flag:${token}`] = advertisedHelpTokens.has(token)
        }
        for (const [feature, tokens] of Object.entries(compatibilityProbeFeatures)) {
          featureChecks[feature] = tokens.every((token) => featureChecks[`flag:${token}`] === true)
        }
        Object.assign(featureChecks, this.compatibilityFeatureChecks(prepared))
        for (const check of compatibilityBehaviorChecks) {
          let accepted = false
          let invalidRejected = false
          try {
            const result = await this.runCompatibilityBehaviorProcess({
              command,
              args: check.acceptedArgs,
              cwd: context.cwd,
              environment: behaviorRuntime.environment,
              redaction: behaviorRedaction,
              timeoutMs,
              maxOutputBytes,
              ...(context.signal === undefined ? {} : { signal: context.signal }),
            })
            accepted = check.matchesAcceptedResult?.(result) ?? true
          } catch (error: unknown) {
            accepted = check.matchesAcceptedError?.(error) ?? false
          }
          try {
            const result = await this.runCompatibilityBehaviorProcess({
              command,
              args: check.rejectedArgs,
              cwd: context.cwd,
              environment: behaviorRuntime.environment,
              redaction: behaviorRedaction,
              timeoutMs,
              maxOutputBytes,
              ...(context.signal === undefined ? {} : { signal: context.signal }),
            })
            invalidRejected = check.matchesRejectedResult?.(result) ?? false
          } catch (error: unknown) {
            invalidRejected = check.matchesRejectedError?.(error) ?? false
          }
          featureChecks[check.feature] = accepted && invalidRejected
        }

        const criticalFeatures = [
          'version',
          'help',
          ...requiredHelpTokens.map((token) => `flag:${token}`),
          ...Object.keys(compatibilityProbeFeatures),
          ...compatibilityBehaviorChecks.map((check) => check.feature),
          ...this.additionalCriticalCompatibilityFeatures(prepared),
        ]
        const compatibility = createCliCompatibilityReport({
          command,
          versionOutput: versionLine ?? '',
          minimumTestedVersion: this.minimumTestedVersion,
          featureChecks,
          criticalFeatures,
        })
        featureChecks['version:parsed'] = compatibility.version !== undefined
        featureChecks['version:minimum-tested'] = compatibility.versionMeetsMinimum
        executorVersion = compatibility.version?.version
        const finalCompatibility = createCliCompatibilityReport({
          command,
          versionOutput: versionLine ?? '',
          minimumTestedVersion: this.minimumTestedVersion,
          featureChecks,
          criticalFeatures: [...criticalFeatures, 'version:parsed', 'version:minimum-tested'],
        })
        const missingFlags = requiredHelpTokens.filter(
          (token) => featureChecks[`flag:${token}`] !== true,
        )
        if (!finalCompatibility.compatible) {
          return freezeJsonSnapshot(
            {
              available: false,
              ...(executorVersion === undefined ? {} : { executorVersion }),
              featureChecks: finalCompatibility.featureChecks,
              diagnostic: !featureChecks.version
                ? `${this.displayName} returned no version information.`
                : !featureChecks.help
                  ? `${this.displayName} returned no help output.`
                  : missingFlags.length > 0
                    ? `${this.displayName} does not advertise required flags: ${missingFlags.join(', ')}.`
                    : `${this.displayName} failed compatibility checks: ${finalCompatibility.missingCriticalFeatures.join(', ')}.`,
            },
            `${this.displayName} probe`,
          )
        }

        const diagnostic = this.availableProbeDiagnostic(options)
        return freezeJsonSnapshot(
          {
            available: true,
            ...(executorVersion === undefined ? {} : { executorVersion }),
            featureChecks: finalCompatibility.featureChecks,
            ...(diagnostic === undefined ? {} : { diagnostic }),
          },
          `${this.displayName} probe`,
        )
      } catch (error: unknown) {
        return freezeJsonSnapshot(
          {
            available: false,
            ...(executorVersion === undefined ? {} : { executorVersion }),
            featureChecks,
            diagnostic: redactText(safeErrorMessage(error), redaction),
          },
          `${this.displayName} probe`,
        )
      }
    } finally {
      await probeEnvironment.cleanup?.()
    }
  }

  admit(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<TOptions>,
    probe?: ExecutorProbe,
  ): ExecutionAdmission {
    const capabilities = this.effectiveCapabilities(role, task, prepared.executionOptions)
    const publicOptions = this.effectivePublicOptions(role, task, prepared)
    const isolation = this.supportFeatures(prepared.executionOptions).contextIsolation
    if (probe?.available === false) {
      return frozenAdmission({
        allowed: false,
        effectiveCapabilities: capabilities,
        effectivePublicOptions: publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: isolation,
        blockedError: blockedError('executor_unavailable', probe.diagnostic, true),
      })
    }

    const required = mergeCapabilities(role.requiredCapabilities, task.requiredCapabilities)
    const missing = missingCapabilities(required, capabilities)
    if (missing.length > 0) {
      return frozenAdmission({
        allowed: false,
        effectiveCapabilities: capabilities,
        effectivePublicOptions: publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: isolation,
        blockedError: blockedError(
          'capability_mismatch',
          `Missing capabilities: ${missing.join(', ')}.`,
          false,
          {
            required: [...required],
            available: [...capabilities],
            missing: [...missing],
          },
        ),
      })
    }

    return frozenAdmission({
      allowed: true,
      effectiveCapabilities: capabilities,
      effectivePublicOptions: publicOptions,
      pathEnforcement: 'advisory',
      contextIsolation: isolation,
    })
  }

  async execute(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<TOptions>,
  ): Promise<ExecutorResponse> {
    const options = context.options
    if (!this.emitsProtocolEvents) {
      context.emitEvent?.({
        type: 'diagnostic',
        level: 'info',
        message: `${this.displayName} execution started.`,
      })
    }
    const runtime = this.prepareEnvironment(options)
    const redaction = this.prepareRedaction(context.sensitiveValues, runtime)
    const controller = new AbortController()
    this.#inflight.set(context.runId, controller)
    const signal =
      context.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, context.signal])
    try {
      try {
        return await this.executeCli(role, task, context, options, signal)
      } catch (error: unknown) {
        const failure = classifyCliFailure(error, redaction)
        const cancelled = failure.code === 'cancelled'
        return {
          status: cancelled ? 'cancelled' : 'failed',
          summary: cancelled ? 'Execution was cancelled.' : `${this.displayName} execution failed.`,
          artifacts: [],
          evidence: commandEvidence(error, redaction),
          error: {
            code: failure.code,
            message: redactText(safeErrorMessage(failure), redaction),
            retryable: failure.retryable,
          },
        }
      }
    } finally {
      if (this.#inflight.get(context.runId) === controller) {
        this.#inflight.delete(context.runId)
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    this.#inflight.get(runId)?.abort()
  }

  protected parseProtocol<T>(
    options: TOptions,
    sensitiveValues: readonly string[],
    parser: () => T,
  ): T {
    try {
      return parser()
    } catch (error: unknown) {
      const runtime = this.prepareEnvironment(options)
      const redaction = this.prepareRedaction(sensitiveValues, runtime)
      throw new CliProtocolError(redactText(safeErrorMessage(error), redaction))
    }
  }

  protected abstract executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<TOptions>,
    options: TOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse>

  protected run(
    context: ExecutionContext<TOptions>,
    options: TOptions,
    args: readonly string[],
    input: string,
    signal: AbortSignal,
    environmentOverrides?: Readonly<Record<string, string>>,
  ): Promise<CliProcessResult> {
    const runtime = this.prepareEnvironment(options, environmentOverrides)
    const processOptions: CliProcessOptions = {
      command: options.command ?? this.defaultCommand,
      args,
      cwd: context.cwd,
      input,
      environment: runtime.environment,
      redaction: {
        sensitiveFlags: [],
        sensitiveValues: [...context.sensitiveValues, ...runtime.sensitiveValues],
      },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      signal,
    }
    return runCliProcess(processOptions)
  }

  protected inspectedCapabilities(_options: Readonly<TOptions>): readonly Capability[] {
    return this.defaultCapabilities
  }

  protected effectiveCapabilities(
    _role: RoleSpec,
    _task: TaskPacket,
    options: Readonly<TOptions>,
  ): readonly Capability[] {
    return this.inspectedCapabilities(options)
  }

  protected effectivePublicOptions(
    _role: RoleSpec,
    _task: TaskPacket,
    prepared: PreparedExecutorOptions<TOptions>,
  ): JsonObject {
    return prepared.publicOptions
  }

  protected supportFeatures(options: Readonly<TOptions>): ExecutorSupportFeatures {
    return {
      structuredOutput: 'prompt',
      events: true,
      cancellation: 'process',
      contextIsolation: this.contextIsolation(options),
      supportedPathEnforcement: ['advisory'],
      permissionCombinations: ['repository.read'],
    }
  }

  protected contextIsolation(options: Readonly<TOptions>): ContextIsolation {
    return {
      userConfig: 'unknown',
      projectInstructions: 'unknown',
      projectResources: 'unknown',
      environment: options.inheritAmbientEnvironment === true ? 'inherited' : 'minimal',
      credentials: options.inheritAmbientEnvironment === true ? 'inherited' : 'explicit',
    }
  }

  protected async prepareProbeEnvironment(
    _options: Readonly<TOptions>,
  ): Promise<CliProbeEnvironment> {
    return {}
  }

  protected runCompatibilityBehaviorProcess(options: CliProcessOptions): Promise<CliProcessResult> {
    return runCliProcess(options)
  }

  protected requiredProbeHelpTokens(
    _prepared: PreparedExecutorOptions<TOptions>,
  ): readonly string[] {
    return []
  }

  protected compatibilityProbeFeatures(
    _prepared: PreparedExecutorOptions<TOptions>,
  ): Readonly<Record<string, readonly string[]>> {
    return {}
  }

  protected compatibilityBehaviorChecks(
    _prepared: PreparedExecutorOptions<TOptions>,
  ): readonly CliCompatibilityBehaviorCheck[] {
    return []
  }

  protected compatibilityFeatureChecks(
    _prepared: PreparedExecutorOptions<TOptions>,
  ): Readonly<Record<string, boolean>> {
    return {}
  }

  protected additionalCriticalCompatibilityFeatures(
    _prepared: PreparedExecutorOptions<TOptions>,
  ): readonly string[] {
    return []
  }

  protected availableProbeDiagnostic(_options: Readonly<TOptions>): string | undefined {
    return undefined
  }

  protected credentialPublicOptions(
    options: Readonly<TOptions>,
    userStoreInherited = false,
  ): JsonObject {
    const credentialEnvironmentKeys = this.authenticationEnvironmentKeys
      .filter((key) => options.environment?.[key] !== undefined)
      .sort()
    const credentialSources = [
      ...(options.inheritAmbientEnvironment === true ? ['inherited'] : []),
      ...(userStoreInherited ? ['user-store'] : []),
      ...(credentialEnvironmentKeys.length > 0 ? ['explicit'] : []),
    ]
    return { credentialSources, credentialEnvironmentKeys }
  }

  protected prepareEnvironment(
    options: Readonly<TOptions>,
    overrides?: Readonly<Record<string, string>>,
  ): PreparedCliEnvironment {
    return prepareCliEnvironment(options.environment, this.environmentControls(), {
      ...(options.inheritAmbientEnvironment === undefined
        ? {}
        : { inheritAmbientEnvironment: options.inheritAmbientEnvironment }),
      ...(overrides === undefined ? {} : { overrides }),
    })
  }

  private environmentControls(): CliEnvironmentControls {
    return {
      authenticationEnvironmentKeys: this.authenticationEnvironmentKeys,
      configHomeEnvironmentKeys: this.configHomeEnvironmentKeys,
      profileEnvironmentKeys: this.profileEnvironmentKeys,
    }
  }

  private prepareRedaction(
    preparedSensitiveValues: readonly string[],
    runtime: PreparedCliEnvironment,
  ): RedactionContext {
    return {
      sensitiveFlags: [],
      sensitiveValues: [...new Set([...preparedSensitiveValues, ...runtime.sensitiveValues])].sort(
        (left, right) => right.length - left.length,
      ),
    }
  }
}

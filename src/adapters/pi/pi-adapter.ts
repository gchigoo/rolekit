import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergeCapabilities } from '../../core/capabilities.ts'
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
  type CliArgumentSegment,
  type CliCompatibilityBehaviorCheck,
  type CliProbeEnvironment,
  exactValueBehaviorCheck,
} from '../cli/base.ts'
import { isolatedUserEnvironment } from '../cli/options.ts'
import {
  firstString,
  isRecord,
  parseExecutorPayload,
  parseJsonLines,
  readUsage,
  textFromContent,
  withoutExecutorIdentity,
} from '../cli/parse.ts'
import {
  PI_AUTHENTICATION_ENVIRONMENT_KEYS,
  PI_TOOL_CAPABILITIES,
  type PiCliAdapterOptions,
  preparePiCliAdapterOptions,
} from './options.ts'
import {
  buildPiExecutionPrompt,
  buildPiProfileArguments,
  resolvePiPromptProfile,
} from './prompt.ts'

export interface PiFinalMessage {
  readonly text: string
  readonly provider?: string
  readonly model?: string
  readonly usage?: TokenUsage
}

export const CONTROLLED_PI_SYSTEM_PROMPT = [
  'You are executing exactly one RoleKit task.',
  'Use only explicitly enabled tools and resources.',
  'Do not load or follow undeclared user or project instructions.',
  'Return only the requested machine-readable response.',
].join(' ')

function parseAssistantMessage(value: unknown): PiFinalMessage | undefined {
  if (!isRecord(value) || value.role !== 'assistant') {
    return undefined
  }
  const text = textFromContent(value.content)
  if (text === undefined) {
    return undefined
  }
  const provider = firstString(value, 'provider')
  const rawModel = firstString(value, 'model')
  const model =
    rawModel === undefined
      ? undefined
      : provider === undefined || rawModel.includes('/')
        ? rawModel
        : `${provider}/${rawModel}`
  const usage = readUsage(value.usage)
  return {
    text,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
  }
}

export function parsePiStream(stdout: string): PiFinalMessage {
  let finalMessage: PiFinalMessage | undefined
  for (const event of parseJsonLines(stdout)) {
    const direct = parseAssistantMessage(event.message)
    if (direct !== undefined) {
      finalMessage = direct
    }
    if (Array.isArray(event.messages)) {
      for (const message of event.messages) {
        const parsed = parseAssistantMessage(message)
        if (parsed !== undefined) {
          finalMessage = parsed
        }
      }
    }
  }
  if (finalMessage === undefined) {
    throw new Error('Pi CLI stream did not contain a final assistant message.')
  }
  return finalMessage
}

export function piToolsForExecution(
  role: RoleSpec,
  task: TaskPacket,
  options: Readonly<PiCliAdapterOptions>,
): readonly string[] {
  const required = new Set(mergeCapabilities(role.requiredCapabilities, task.requiredCapabilities))
  const tools =
    options.tools === undefined
      ? [
          ...(required.has('repository.read') ? ['read', 'grep', 'find', 'ls'] : []),
          ...(required.has('repository.write') ? ['edit', 'write'] : []),
          ...(required.has('shell') ? ['bash'] : []),
        ]
      : [...options.tools]
  const excluded = new Set(options.excludeTools ?? [])
  return tools.filter((tool) => !excluded.has(tool))
}

function capabilitiesForTools(tools: readonly string[]): readonly Capability[] {
  const capabilities = new Set<Capability>()
  for (const tool of tools) {
    const capability = PI_TOOL_CAPABILITIES[tool]
    if (capability !== undefined) {
      capabilities.add(capability)
    }
    if (tool === 'bash') {
      capabilities.add('repository.write')
    }
  }
  return [...capabilities].sort()
}

function mergeUsage(
  response: ExecutorResponse,
  detected: TokenUsage | undefined,
  durationMs: number,
): TokenUsage {
  const responseUsage = readUsage(response.usage) ?? {}
  return {
    ...detected,
    ...responseUsage,
    durationMs: responseUsage.durationMs ?? detected?.durationMs ?? durationMs,
  }
}

function exactPathSegments(
  flag: string,
  paths: readonly string[] | undefined,
): readonly CliArgumentSegment[] {
  return (paths ?? []).map((path) => ({ flag, values: [path] }))
}

function containsPiSessionEvent(output: string): boolean {
  return output.split(/\r?\n/u).some((line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      return false
    }
    try {
      const value: unknown = JSON.parse(trimmed)
      return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Reflect.get(value, 'type') === 'session' &&
        typeof Reflect.get(value, 'version') === 'number' &&
        typeof Reflect.get(value, 'id') === 'string'
      )
    } catch {
      return false
    }
  })
}

function pairedArgumentSegments(args: readonly string[]): readonly CliArgumentSegment[] {
  const segments: CliArgumentSegment[] = []
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag !== undefined && value !== undefined) {
      segments.push({ flag, values: [value] })
    }
  }
  return segments
}

function buildPiArgumentPlan(
  options: Readonly<PiCliAdapterOptions>,
  tools: readonly string[],
): CliArgumentPlan {
  const promptProfile = resolvePiPromptProfile(options)
  return buildCliArgumentPlan([
    { flag: '--mode', values: ['json'] },
    { flag: '--print' },
    { flag: '--no-session' },
    ...(options.inheritContextFiles === true ? [] : [{ flag: '--no-context-files' }]),
    ...(options.discoverProjectResources === true
      ? []
      : [{ flag: '--no-extensions' }, { flag: '--no-skills' }, { flag: '--no-prompt-templates' }]),
    ...exactPathSegments('--extension', options.extensions),
    ...exactPathSegments('--skill', options.skills),
    ...exactPathSegments('--prompt-template', options.promptTemplates),
    { flag: '--tools', values: [tools.join(',')] },
    { flag: '--system-prompt', values: [CONTROLLED_PI_SYSTEM_PROMPT] },
    ...(options.provider === undefined ? [] : [{ flag: '--provider', values: [options.provider] }]),
    ...(options.model === undefined ? [] : [{ flag: '--model', values: [options.model] }]),
    ...(options.thinking === undefined ? [] : [{ flag: '--thinking', values: [options.thinking] }]),
    ...pairedArgumentSegments(buildPiProfileArguments(promptProfile, options)),
    ...(options.offline === true ? [{ flag: '--offline' }] : []),
  ])
}

async function createPiEnvironment(
  options: Readonly<PiCliAdapterOptions>,
): Promise<CliProbeEnvironment> {
  if (options.inheritUserAgentDirectory === true) {
    const inheritedDirectory = process.env.PI_CODING_AGENT_DIR
    return {
      ...(inheritedDirectory === undefined
        ? {}
        : { overrides: { PI_CODING_AGENT_DIR: inheritedDirectory } }),
    }
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-pi-'))
  return {
    overrides: {
      PI_CODING_AGENT_DIR: temporaryDirectory,
      ...isolatedUserEnvironment(temporaryDirectory),
    },
    cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
  }
}

export class PiCliAdapter extends CliAdapterBase<PiCliAdapterOptions> {
  readonly id: string = 'pi'
  protected readonly displayName: string = 'Pi CLI'
  protected readonly defaultCommand = 'pi'
  protected readonly defaultCapabilities: readonly Capability[] = [
    'repository.read',
    'repository.write',
    'shell',
  ]
  protected override readonly authenticationEnvironmentKeys = PI_AUTHENTICATION_ENVIRONMENT_KEYS
  protected override readonly minimumTestedVersion = '0.73.1'

  override prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<PiCliAdapterOptions> {
    return preparePiCliAdapterOptions(options, publicContext)
  }

  protected override prepareProbeEnvironment(
    options: Readonly<PiCliAdapterOptions>,
  ): Promise<CliProbeEnvironment> {
    return createPiEnvironment(options)
  }

  protected override requiredProbeHelpTokens(
    prepared: PreparedExecutorOptions<PiCliAdapterOptions>,
  ): readonly string[] {
    return buildPiArgumentPlan(prepared.executionOptions, []).helpTokens
  }

  protected piCompatibilityProbeFeatures(): Readonly<Record<string, readonly string[]>> {
    return {
      'isolation:no-context-files': ['--no-context-files'],
      'isolation:resource-discovery-controls': [
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
      ],
      tools: ['--tools'],
      thinking: ['--thinking'],
    }
  }

  protected piJsonModeBehaviorCheck(plan: CliArgumentPlan): CliCompatibilityBehaviorCheck {
    return exactValueBehaviorCheck('mode:json', plan, '--mode', 1, {
      suffixArgs: [
        '--print',
        '--no-session',
        '--no-context-files',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--tools',
        'read',
        '--offline',
      ],
      matchesAcceptedResult: (result) => containsPiSessionEvent(result.stdout),
      matchesRejectedResult: (result) =>
        result.exitCode === 0 && result.stdout === '' && result.stderr === '',
    })
  }

  protected override compatibilityProbeFeatures(
    _prepared: PreparedExecutorOptions<PiCliAdapterOptions>,
  ): Readonly<Record<string, readonly string[]>> {
    return this.piCompatibilityProbeFeatures()
  }

  protected override compatibilityBehaviorChecks(
    prepared: PreparedExecutorOptions<PiCliAdapterOptions>,
  ): readonly CliCompatibilityBehaviorCheck[] {
    return [this.piJsonModeBehaviorCheck(buildPiArgumentPlan(prepared.executionOptions, []))]
  }

  protected override inspectedCapabilities(
    options: Readonly<PiCliAdapterOptions>,
  ): readonly Capability[] {
    const excluded = new Set(options.excludeTools ?? [])
    const tools = (options.tools ?? Object.keys(PI_TOOL_CAPABILITIES)).filter(
      (tool) => !excluded.has(tool),
    )
    return capabilitiesForTools(tools)
  }

  protected override supportFeatures(
    options: Readonly<PiCliAdapterOptions>,
  ): ExecutorSupportFeatures {
    return {
      structuredOutput: 'prompt',
      events: true,
      cancellation: 'process',
      contextIsolation: this.contextIsolation(options),
      supportedPathEnforcement: ['advisory'],
      permissionCombinations: [
        'repository.read',
        'repository.read+repository.write',
        'repository.read+repository.write+shell',
      ],
    }
  }

  protected override contextIsolation(options: Readonly<PiCliAdapterOptions>): ContextIsolation {
    const hasExplicitCredential = PI_AUTHENTICATION_ENVIRONMENT_KEYS.some(
      (key) => options.environment?.[key] !== undefined,
    )
    return {
      userConfig: options.inheritUserAgentDirectory === true ? 'inherited' : 'isolated',
      projectInstructions: options.inheritContextFiles === true ? 'inherited' : 'isolated',
      projectResources:
        options.discoverProjectResources === true || options.inheritUserAgentDirectory === true
          ? 'inherited'
          : 'isolated',
      environment: options.inheritAmbientEnvironment === true ? 'inherited' : 'minimal',
      credentials:
        options.inheritAmbientEnvironment === true
          ? 'inherited'
          : options.inheritUserAgentDirectory === true
            ? hasExplicitCredential
              ? 'unknown'
              : 'user-store'
            : 'explicit',
    }
  }

  override admit(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<PiCliAdapterOptions>,
    probe?: ExecutorProbe,
  ): ExecutionAdmission {
    const required = new Set(
      mergeCapabilities(role.requiredCapabilities, task.requiredCapabilities),
    )
    if (required.has('shell') && !required.has('repository.write')) {
      return freezeJsonSnapshot(
        {
          allowed: false,
          effectiveCapabilities: this.effectiveCapabilities(role, task, prepared.executionOptions),
          effectivePublicOptions: this.effectivePublicOptions(role, task, prepared),
          pathEnforcement: 'advisory',
          contextIsolation: this.contextIsolation(prepared.executionOptions),
          blockedError: {
            code: 'unsupported_permission_combination',
            message:
              'Pi shell execution without repository.write cannot guarantee write isolation.',
            retryable: false,
            details: {
              required: [...required],
              unsupportedCombination: 'shell-without-repository.write',
            },
          },
        },
        'Pi execution admission',
      ) as ExecutionAdmission
    }
    return super.admit(role, task, prepared, probe)
  }

  protected override effectiveCapabilities(
    role: RoleSpec,
    task: TaskPacket,
    options: Readonly<PiCliAdapterOptions>,
  ): readonly Capability[] {
    return capabilitiesForTools(piToolsForExecution(role, task, options))
  }

  protected override effectivePublicOptions(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<PiCliAdapterOptions>,
  ): JsonObject {
    const options = prepared.executionOptions
    const promptProfile = resolvePiPromptProfile(options)
    const effectiveThinking =
      options.thinking ??
      (promptProfile === 'grok-4.5' &&
      !options.model?.match(/:(?:off|minimal|low|medium|high|xhigh|max)$/u)
        ? 'high'
        : undefined)
    return {
      ...prepared.publicOptions,
      ...this.credentialPublicOptions(options, options.inheritUserAgentDirectory === true),
      command: options.command ?? this.defaultCommand,
      inheritAmbientEnvironment: options.inheritAmbientEnvironment ?? false,
      inheritContextFiles: options.inheritContextFiles ?? false,
      inheritUserAgentDirectory: options.inheritUserAgentDirectory ?? false,
      discoverProjectResources: options.discoverProjectResources ?? false,
      offline: options.offline ?? false,
      tools: piToolsForExecution(role, task, options),
      extensions: options.extensions ?? [],
      skills: options.skills ?? [],
      promptTemplates: options.promptTemplates ?? [],
      mode: 'json',
      session: false,
      authorization: 'tool-allowlist',
      pathEnforcement: 'advisory',
      ...(effectiveThinking === undefined ? {} : { thinking: effectiveThinking }),
    }
  }

  protected async executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<PiCliAdapterOptions>,
    options: PiCliAdapterOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    const promptProfile = resolvePiPromptProfile(options)
    const tools = piToolsForExecution(role, task, options)
    const argumentPlan = buildPiArgumentPlan(options, tools)

    const environment = await createPiEnvironment(options)

    try {
      const processResult = await this.run(
        context,
        options,
        argumentPlan.args,
        buildPiExecutionPrompt(role, task, promptProfile),
        signal,
        environment.overrides,
      )
      if (processResult.exitCode !== 0) {
        throw new Error(
          processResult.stderr.trim() || `Pi CLI exited with code ${processResult.exitCode}.`,
        )
      }

      const { parsed, response } = this.parseProtocol(options, context.sensitiveValues, () => {
        const parsed = parsePiStream(processResult.stdout)
        const response = withoutExecutorIdentity(parseExecutorPayload(parsed.text))
        return { parsed, response }
      })
      return {
        ...response,
        evidence: [
          ...(Array.isArray(response.evidence) ? response.evidence : []),
          {
            kind: 'command',
            value: processResult.commandDisplay,
            description: 'Pi CLI invocation',
          },
        ],
        usage: mergeUsage(response, parsed.usage, processResult.durationMs),
        ...(parsed.provider === undefined ? {} : { provider: parsed.provider }),
        ...(parsed.model === undefined ? {} : { model: parsed.model }),
      }
    } finally {
      await environment.cleanup?.()
    }
  }
}

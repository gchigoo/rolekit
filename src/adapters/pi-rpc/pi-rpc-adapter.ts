import { performance } from 'node:perf_hooks'

import { freezeJsonSnapshot } from '../../core/json.ts'
import type {
  AdapterEvent,
  ContextIsolation,
  ExecutionContext,
  ExecutorProbe,
  ExecutorResponse,
  ExecutorSupportFeatures,
  JsonObject,
  PreparedExecutorOptions,
  ProbeContext,
  PublicOptionContext,
  RoleSpec,
  TaskPacket,
  TokenUsage,
} from '../../core/types.ts'
import {
  buildCliArgumentPlan,
  type CliArgumentPlan,
  type CliArgumentSegment,
  type CliCompatibilityBehaviorCheck,
} from '../cli/base.ts'
import { CliAbortedError, CliProtocolError, CliTimeoutError } from '../cli/errors.ts'
import { readUsage, textFromContent, withoutExecutorIdentity } from '../cli/parse.ts'
import { redactText } from '../cli/redaction.ts'
import { CONTROLLED_PI_SYSTEM_PROMPT, PiCliAdapter, piToolsForExecution } from '../pi/pi-adapter.ts'
import { buildPiExecutionPrompt, resolvePiPromptProfile } from '../pi/prompt.ts'
import { type PiRpcAdapterOptions, preparePiRpcAdapterOptions } from './options.ts'
import { PiRpcClient } from './rpc-client.ts'

const SETTLEMENT_GRACE_MS = 150
const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60 * 1_000

interface PiRpcState {
  readonly model: Readonly<Record<string, unknown>> | null
  readonly thinkingLevel: string
  readonly isStreaming: boolean
  readonly isCompacting: boolean
  readonly messageCount: number
  readonly pendingMessageCount: number
  readonly sessionFile?: string | null
}

interface PiAssistantMessage {
  readonly text?: string
  readonly provider?: string
  readonly model?: string
  readonly usage?: TokenUsage
  readonly stopReason?: string
  readonly errorMessage?: string
}

type PiTextAssistantMessage = PiAssistantMessage & { readonly text: string }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, milliseconds)
    timeout.unref()
  })
}

function exactPathSegments(
  flag: string,
  paths: readonly string[] | undefined,
): readonly CliArgumentSegment[] {
  return (paths ?? []).map((path) => ({ flag, values: [path] }))
}

function buildPiRpcArgumentPlan(
  options: Readonly<PiRpcAdapterOptions>,
  tools: readonly string[],
): CliArgumentPlan {
  return buildCliArgumentPlan([
    { flag: '--mode', values: ['rpc'] },
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
    ...(options.offline === true ? [{ flag: '--offline' }] : []),
  ])
}

function parseState(value: unknown): PiRpcState {
  if (!isRecord(value)) {
    throw new CliProtocolError('Pi RPC get_state response data was not an object.')
  }
  const model = value.model
  if (model !== null && !isRecord(model)) {
    throw new CliProtocolError('Pi RPC state model must be an object or null.')
  }
  const sessionFile = value.sessionFile
  if (sessionFile !== undefined && sessionFile !== null && typeof sessionFile !== 'string') {
    throw new CliProtocolError('Pi RPC state sessionFile must be a string or null when present.')
  }
  if (
    typeof value.thinkingLevel !== 'string' ||
    typeof value.isStreaming !== 'boolean' ||
    typeof value.isCompacting !== 'boolean' ||
    !Number.isSafeInteger(value.messageCount) ||
    (value.messageCount as number) < 0 ||
    !Number.isSafeInteger(value.pendingMessageCount) ||
    (value.pendingMessageCount as number) < 0
  ) {
    throw new CliProtocolError('Pi RPC state is missing required documented fields.')
  }
  return {
    model,
    thinkingLevel: value.thinkingLevel,
    isStreaming: value.isStreaming,
    isCompacting: value.isCompacting,
    messageCount: value.messageCount as number,
    pendingMessageCount: value.pendingMessageCount as number,
    ...(sessionFile === undefined ? {} : { sessionFile }),
  }
}

function assertFreshInitialState(state: PiRpcState): void {
  if (state.isStreaming || state.isCompacting) {
    throw new CliProtocolError('Pi RPC initial state was not idle for an isolated one-task run.')
  }
  if (state.messageCount !== 0) {
    throw new CliProtocolError(
      `Pi RPC initial state was not fresh: messageCount was ${state.messageCount}.`,
    )
  }
  if (state.pendingMessageCount !== 0) {
    throw new CliProtocolError(
      `Pi RPC initial state was not fresh: pendingMessageCount was ${state.pendingMessageCount}.`,
    )
  }
  if (state.sessionFile !== undefined && state.sessionFile !== null) {
    throw new CliProtocolError(
      'Pi RPC initial state exposed a persisted sessionFile despite --no-session.',
    )
  }
}

function validateToolCall(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (
    !isRecord(value) ||
    value.type !== 'toolCall' ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isRecord(value.arguments)
  ) {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value
}

function assistantTextFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    throw new CliProtocolError('Pi RPC assistant message content was malformed.')
  }
  const text: string[] = []
  for (const block of value) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw new CliProtocolError('Pi RPC assistant message content was malformed.')
    }
    switch (block.type) {
      case 'text':
        if (typeof block.text !== 'string') {
          throw new CliProtocolError('Pi RPC assistant text content was malformed.')
        }
        text.push(block.text)
        break
      case 'thinking':
        if (typeof block.thinking !== 'string') {
          throw new CliProtocolError('Pi RPC assistant thinking content was malformed.')
        }
        break
      case 'toolCall':
        validateToolCall(block, 'Pi RPC assistant tool-call content')
        break
      default:
        throw new CliProtocolError(
          `Pi RPC assistant content type "${String(block.type)}" is unsupported.`,
        )
    }
  }
  return text.length === 0 ? undefined : text.join('')
}

function parseAssistantMessage(value: unknown): PiAssistantMessage | undefined {
  if (!isRecord(value) || value.role !== 'assistant') {
    return undefined
  }
  const text = assistantTextFromContent(value.content)
  if (value.provider !== undefined && typeof value.provider !== 'string') {
    throw new CliProtocolError('Pi RPC assistant provider identity was malformed.')
  }
  if (value.model !== undefined && typeof value.model !== 'string') {
    throw new CliProtocolError('Pi RPC assistant model identity was malformed.')
  }
  const usage = readUsage(value.usage)
  if (value.usage !== undefined && usage === undefined) {
    throw new CliProtocolError('Pi RPC assistant usage was malformed.')
  }
  if (value.stopReason !== undefined && typeof value.stopReason !== 'string') {
    throw new CliProtocolError('Pi RPC assistant stopReason was malformed.')
  }
  if (value.errorMessage !== undefined && typeof value.errorMessage !== 'string') {
    throw new CliProtocolError('Pi RPC assistant errorMessage was malformed.')
  }
  return {
    ...(text === undefined ? {} : { text }),
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(usage === undefined ? {} : { usage }),
    ...(value.stopReason === undefined ? {} : { stopReason: value.stopReason }),
    ...(value.errorMessage === undefined ? {} : { errorMessage: value.errorMessage }),
  }
}

function modelIdentity(
  state: PiRpcState,
): { readonly provider?: string; readonly model?: string } | undefined {
  if (state.model === null) {
    return undefined
  }
  const provider =
    typeof state.model.provider === 'string' && state.model.provider.length > 0
      ? state.model.provider
      : undefined
  const model =
    typeof state.model.id === 'string' && state.model.id.length > 0 ? state.model.id : undefined
  if (
    (provider === undefined && model === undefined) ||
    (provider === 'unknown' && model === 'unknown')
  ) {
    return undefined
  }
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
  }
}

function configuredModelCommand(
  options: Readonly<PiRpcAdapterOptions>,
): { readonly provider: string; readonly modelId: string } | undefined {
  if (options.model === undefined) {
    return undefined
  }
  if (options.provider !== undefined) {
    const prefix = `${options.provider}/`
    return {
      provider: options.provider,
      modelId: options.model.startsWith(prefix)
        ? options.model.slice(prefix.length)
        : options.model,
    }
  }
  const separator = options.model.indexOf('/')
  if (separator <= 0 || separator === options.model.length - 1) {
    return undefined
  }
  return {
    provider: options.model.slice(0, separator),
    modelId: options.model.slice(separator + 1),
  }
}

function usageWithDuration(
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

function eventMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (isRecord(value)) {
    return textFromContent(value.content)
  }
  return undefined
}

function requiredRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | undefined {
  const value = record[key]
  if (value !== undefined && typeof value !== 'string') {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value
}

function requiredBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value
}

function requiredInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): number {
  const value = record[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value as number
}

function requiredStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new CliProtocolError(`${label} was malformed.`)
  }
  return value
}

function requireOwnField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): void {
  if (!Object.hasOwn(record, key)) {
    throw new CliProtocolError(`${label} was malformed.`)
  }
}

function assertOnlyFields(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedFields = new Set(allowed)
  const unsupported = Object.keys(record).filter((key) => !allowedFields.has(key))
  if (unsupported.length > 0) {
    throw new CliProtocolError(
      `${label} contained unsupported field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}.`,
    )
  }
}

const TERMINAL_ASSISTANT_EVENTS = new Set(['done', 'error'])
const ASSISTANT_DONE_REASONS = new Set(['stop', 'length', 'toolUse'])
const ASSISTANT_ERROR_REASONS = new Set(['aborted', 'error'])

function validateAssistantReason(
  event: Readonly<Record<string, unknown>>,
  type: 'done' | 'error',
  supported: ReadonlySet<string>,
): void {
  const reason = requiredString(event, 'reason', `Pi RPC assistant ${type} reason`)
  if (!supported.has(reason)) {
    throw new CliProtocolError(`Pi RPC assistant ${type} reason "${reason}" is unsupported.`)
  }
}

function validateAssistantMessageEvent(value: unknown): Readonly<Record<string, unknown>> {
  const event = requiredRecord(value, 'Pi RPC assistant message event')
  const type = requiredString(event, 'type', 'Pi RPC assistant message event type')
  const only = (fields: readonly string[]): void => {
    assertOnlyFields(event, ['type', ...fields], `Pi RPC assistant ${type} event`)
  }
  const indexed = (): void => {
    requiredInteger(event, 'contentIndex', `Pi RPC assistant ${type} contentIndex`)
  }
  const partial = (): void => {
    requiredRecord(event.partial, `Pi RPC assistant ${type} partial`)
  }

  switch (type) {
    case 'start':
      only(['partial'])
      partial()
      break
    case 'text_start':
    case 'thinking_start':
    case 'toolcall_start':
      only(['contentIndex', 'partial'])
      indexed()
      partial()
      break
    case 'text_delta':
    case 'thinking_delta':
    case 'toolcall_delta':
      only(['contentIndex', 'delta', 'partial'])
      indexed()
      requiredString(event, 'delta', `Pi RPC assistant ${type} delta`)
      partial()
      break
    case 'text_end':
    case 'thinking_end':
      only(['contentIndex', 'content', 'partial'])
      indexed()
      requiredString(event, 'content', `Pi RPC assistant ${type} content`)
      partial()
      break
    case 'toolcall_end':
      only(['contentIndex', 'toolCall', 'partial'])
      indexed()
      validateToolCall(event.toolCall, 'Pi RPC assistant toolcall_end toolCall')
      partial()
      break
    case 'done':
      only(['reason', 'message'])
      validateAssistantReason(event, 'done', ASSISTANT_DONE_REASONS)
      requiredRecord(event.message, 'Pi RPC assistant done message')
      break
    case 'error':
      only(['reason', 'error'])
      validateAssistantReason(event, 'error', ASSISTANT_ERROR_REASONS)
      requiredRecord(event.error, 'Pi RPC assistant error error')
      break
    default:
      throw new CliProtocolError(`Pi RPC assistant message event type "${type}" is unsupported.`)
  }
  return event
}

const COMPACTION_REASONS = new Set(['manual', 'threshold', 'overflow'])

function compactionReason(event: Readonly<Record<string, unknown>>): string {
  const reason = requiredString(event, 'reason', 'Pi RPC compaction reason')
  if (!COMPACTION_REASONS.has(reason)) {
    throw new CliProtocolError(`Pi RPC compaction reason "${reason}" is unsupported.`)
  }
  return reason
}

export class PiRpcAdapter extends PiCliAdapter {
  override readonly id = 'pi-rpc'
  protected override readonly displayName = 'Pi RPC'
  protected override readonly emitsProtocolEvents = true

  override prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<PiRpcAdapterOptions> {
    return preparePiRpcAdapterOptions(options, publicContext)
  }

  override async probe(
    prepared: PreparedExecutorOptions<PiRpcAdapterOptions>,
    context: ProbeContext,
  ): Promise<ExecutorProbe> {
    const cliProbe = await super.probe(prepared, context)
    if (!cliProbe.available) {
      return cliProbe
    }

    const options = prepared.executionOptions
    const probeEnvironment = await this.prepareProbeEnvironment(options)
    let client: PiRpcClient | undefined
    let abortListener: (() => void) | undefined
    const featureChecks: Record<string, boolean> = {
      ...cliProbe.featureChecks,
      'mode:rpc': false,
      'rpc:get_state': false,
      'rpc:set_model': false,
      'rpc:set_thinking_level': false,
      'rpc:abort': false,
      'rpc:request_correlation': false,
    }
    try {
      const runtime = this.prepareEnvironment(options, probeEnvironment.overrides)
      const redaction = {
        sensitiveFlags: [],
        sensitiveValues: [...prepared.sensitiveValues, ...runtime.sensitiveValues],
      }
      const argumentPlan = buildPiRpcArgumentPlan(options, options.tools ?? ['read'])
      client = await PiRpcClient.start({
        command: options.command ?? this.defaultCommand,
        args: argumentPlan.args,
        cwd: context.cwd,
        environment: runtime.environment,
        timeoutMs: Math.min(options.timeoutMs ?? 5_000, 30_000),
        maxOutputBytes: Math.min(options.maxOutputBytes ?? 128 * 1024, 128 * 1024),
        redaction,
        onEvent: () => {},
      })
      void client.completion.catch(() => undefined)
      const runningClient = client
      abortListener = () => {
        void runningClient.close().catch(() => undefined)
      }
      context.signal?.addEventListener('abort', abortListener, { once: true })
      if (context.signal?.aborted === true) {
        abortListener()
        throw new CliAbortedError('Pi RPC probe was aborted.')
      }
      const stateResponse = await runningClient.request({ type: 'get_state' })
      featureChecks['mode:rpc'] = true
      featureChecks['rpc:get_state'] = true
      featureChecks['rpc:request_correlation'] = true
      const initial = parseState(stateResponse.data)
      assertFreshInitialState(initial)
      const initialModel = modelIdentity(initial)
      const configuredModel = configuredModelCommand(options)
      const probeModel =
        configuredModel ??
        (initialModel?.provider === undefined || initialModel.model === undefined
          ? undefined
          : { provider: initialModel.provider, modelId: initialModel.model })
      if (probeModel !== undefined) {
        await runningClient.request({ type: 'set_model', ...probeModel })
        featureChecks['rpc:set_model'] = true
      }
      await runningClient.request({ type: 'set_thinking_level', level: initial.thinkingLevel })
      featureChecks['rpc:set_thinking_level'] = true
      await runningClient.abort()
      featureChecks['rpc:abort'] = true
      return freezeJsonSnapshot(
        {
          ...cliProbe,
          featureChecks,
        },
        'Pi RPC probe',
      ) as ExecutorProbe
    } catch (error: unknown) {
      return freezeJsonSnapshot(
        {
          available: false,
          executorVersion: cliProbe.executorVersion,
          featureChecks,
          diagnostic: redactText(error instanceof Error ? error.message : 'Pi RPC probe failed.', {
            sensitiveFlags: [],
            sensitiveValues: prepared.sensitiveValues,
          }),
        },
        'Pi RPC probe',
      ) as ExecutorProbe
    } finally {
      if (abortListener !== undefined) {
        context.signal?.removeEventListener('abort', abortListener)
      }
      await client?.close().catch(() => undefined)
      await probeEnvironment.cleanup?.()
    }
  }

  protected override requiredProbeHelpTokens(
    prepared: PreparedExecutorOptions<PiRpcAdapterOptions>,
  ): readonly string[] {
    return buildPiRpcArgumentPlan(
      prepared.executionOptions,
      prepared.executionOptions.tools ?? ['read'],
    ).helpTokens
  }

  protected override compatibilityProbeFeatures(
    _prepared: PreparedExecutorOptions<PiRpcAdapterOptions>,
  ): Readonly<Record<string, readonly string[]>> {
    return this.piCompatibilityProbeFeatures()
  }

  protected override compatibilityBehaviorChecks(
    _prepared: PreparedExecutorOptions<PiRpcAdapterOptions>,
  ): readonly CliCompatibilityBehaviorCheck[] {
    return []
  }

  protected override supportFeatures(
    options: Readonly<PiRpcAdapterOptions>,
  ): ExecutorSupportFeatures {
    return {
      structuredOutput: 'prompt',
      events: true,
      cancellation: 'protocol',
      contextIsolation: this.contextIsolation(options),
      supportedPathEnforcement: ['advisory'],
      permissionCombinations: [
        'repository.read',
        'repository.read+repository.write',
        'repository.read+repository.write+shell',
      ],
    }
  }

  protected override contextIsolation(options: Readonly<PiRpcAdapterOptions>): ContextIsolation {
    return super.contextIsolation(options)
  }

  protected override effectivePublicOptions(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<PiRpcAdapterOptions>,
  ): JsonObject {
    const options = prepared.executionOptions
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
      mode: 'rpc',
      session: false,
      authorization: 'tool-allowlist',
      pathEnforcement: 'advisory',
    }
  }

  protected override async executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<PiRpcAdapterOptions>,
    options: PiRpcAdapterOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    const startedAt = performance.now()
    const tools = piToolsForExecution(role, task, options)
    const argumentPlan = buildPiRpcArgumentPlan(options, tools)
    const processEnvironment = await this.prepareProbeEnvironment(options)
    let client: PiRpcClient | undefined
    let abortListener: (() => void) | undefined

    try {
      const runtime = this.prepareEnvironment(options, processEnvironment.overrides)
      const redaction = {
        sensitiveFlags: [],
        sensitiveValues: [...context.sensitiveValues, ...runtime.sensitiveValues],
      }
      let settled = false
      let finalMessage: PiTextAssistantMessage | undefined
      let terminalError: string | undefined
      let lastUsage: string | undefined
      let resolveSettled: (() => void) | undefined
      const settledPromise = new Promise<void>((resolvePromise) => {
        resolveSettled = resolvePromise
      })

      const emit = (event: AdapterEvent): void => {
        context.emitEvent?.(event)
      }
      const recordTerminalError = (message: string): void => {
        const redactedMessage = redactText(message, redaction)
        terminalError ??= redactedMessage
        emit({ type: 'diagnostic', level: 'error', message: redactedMessage })
      }
      const observeAssistant = (value: unknown): void => {
        const assistant = parseAssistantMessage(value)
        if (assistant === undefined) {
          return
        }
        if (assistant.usage !== undefined) {
          const fingerprint = JSON.stringify(assistant.usage)
          if (fingerprint !== lastUsage) {
            lastUsage = fingerprint
            emit({ type: 'usage', usage: assistant.usage })
          }
        }
        if (assistant.stopReason === 'error' || assistant.stopReason === 'aborted') {
          recordTerminalError(
            assistant.errorMessage ?? `Pi assistant stopped with reason ${assistant.stopReason}.`,
          )
        }
        if (assistant.text !== undefined) {
          finalMessage = { ...assistant, text: assistant.text }
        }
      }
      const onRpcEvent = (event: Readonly<Record<string, unknown>>): void => {
        const only = (fields: readonly string[]): void => {
          assertOnlyFields(event, ['type', ...fields], `Pi RPC ${String(event.type)} event`)
        }
        switch (event.type) {
          case 'agent_start':
          case 'turn_start':
            only([])
            break
          case 'message_start':
            only(['message'])
            requiredRecord(event.message, 'Pi RPC message_start message')
            break
          case 'message_update': {
            only(['message', 'assistantMessageEvent'])
            const message = requiredRecord(event.message, 'Pi RPC message_update message')
            const update = validateAssistantMessageEvent(event.assistantMessageEvent)
            if (update.type === 'text_delta') {
              emit({ type: 'assistant.delta', text: update.delta as string })
            }
            if (TERMINAL_ASSISTANT_EVENTS.has(update.type as string)) {
              observeAssistant(message)
            }
            if (update.type === 'error') {
              recordTerminalError(`Pi assistant stream ended with ${String(update.reason)}.`)
            }
            break
          }
          case 'message_end':
            only(['message'])
            observeAssistant(requiredRecord(event.message, 'Pi RPC message_end message'))
            break
          case 'turn_end':
            only(['message', 'toolResults'])
            observeAssistant(requiredRecord(event.message, 'Pi RPC turn_end message'))
            if (!Array.isArray(event.toolResults)) {
              throw new CliProtocolError('Pi RPC turn_end toolResults was malformed.')
            }
            for (const result of event.toolResults) {
              requiredRecord(result, 'Pi RPC turn_end tool result')
            }
            break
          case 'agent_end':
            only(['messages'])
            if (!Array.isArray(event.messages)) {
              throw new CliProtocolError('Pi RPC agent_end messages was malformed.')
            }
            for (const message of event.messages) {
              observeAssistant(requiredRecord(message, 'Pi RPC agent_end message'))
            }
            break
          case 'tool_execution_start': {
            only(['toolCallId', 'toolName', 'args'])
            const tool = requiredString(event, 'toolName', 'Pi RPC tool start toolName')
            const callId = requiredString(event, 'toolCallId', 'Pi RPC tool start toolCallId')
            requireOwnField(event, 'args', 'Pi RPC tool start args')
            emit({ type: 'tool.started', tool, callId })
            break
          }
          case 'tool_execution_update':
            only(['toolCallId', 'toolName', 'args', 'partialResult'])
            requiredString(event, 'toolName', 'Pi RPC tool update toolName')
            requiredString(event, 'toolCallId', 'Pi RPC tool update toolCallId')
            requireOwnField(event, 'args', 'Pi RPC tool update args')
            requireOwnField(event, 'partialResult', 'Pi RPC tool update partialResult')
            break
          case 'tool_execution_end': {
            only(['toolCallId', 'toolName', 'result', 'isError'])
            const tool = requiredString(event, 'toolName', 'Pi RPC tool completion toolName')
            const callId = requiredString(event, 'toolCallId', 'Pi RPC tool completion toolCallId')
            requireOwnField(event, 'result', 'Pi RPC tool completion result')
            const isError = requiredBoolean(event, 'isError', 'Pi RPC tool completion isError')
            emit({ type: 'tool.completed', tool, callId, success: !isError })
            if (isError) {
              emit({
                type: 'diagnostic',
                level: 'error',
                message: redactText(
                  eventMessage(event.result) ?? `Pi tool "${tool}" failed.`,
                  redaction,
                ),
              })
            }
            break
          }
          case 'queue_update': {
            only(['steering', 'followUp'])
            const steering = requiredStringArray(event, 'steering', 'Pi RPC queue_update steering')
            const followUp = requiredStringArray(event, 'followUp', 'Pi RPC queue_update followUp')
            if (steering.length > 0 || followUp.length > 0) {
              throw new CliProtocolError(
                'Pi RPC reported queued steering or follow-up work in a one-task process.',
              )
            }
            break
          }
          case 'compaction_start':
            only(['reason'])
            compactionReason(event)
            break
          case 'compaction_end': {
            only(['reason', 'result', 'aborted', 'willRetry', 'errorMessage'])
            compactionReason(event)
            const aborted = requiredBoolean(event, 'aborted', 'Pi RPC compaction aborted')
            const willRetry = requiredBoolean(event, 'willRetry', 'Pi RPC compaction willRetry')
            const errorMessage = optionalString(
              event,
              'errorMessage',
              'Pi RPC compaction errorMessage',
            )
            if (event.result !== undefined && !isRecord(event.result)) {
              throw new CliProtocolError('Pi RPC compaction result was malformed.')
            }
            if (aborted && !willRetry) {
              recordTerminalError(errorMessage ?? 'Pi RPC compaction was aborted.')
            }
            break
          }
          case 'auto_retry_start':
            only(['attempt', 'maxAttempts', 'delayMs', 'errorMessage'])
            requiredInteger(event, 'attempt', 'Pi RPC auto_retry_start attempt')
            requiredInteger(event, 'maxAttempts', 'Pi RPC auto_retry_start maxAttempts')
            requiredInteger(event, 'delayMs', 'Pi RPC auto_retry_start delayMs')
            recordTerminalError(
              `Pi RPC attempted an implicit automatic retry: ${requiredString(
                event,
                'errorMessage',
                'Pi RPC auto_retry_start errorMessage',
              )}`,
            )
            break
          case 'auto_retry_end': {
            only(['success', 'attempt', 'finalError'])
            requiredInteger(event, 'attempt', 'Pi RPC auto_retry_end attempt')
            const success = requiredBoolean(event, 'success', 'Pi RPC auto_retry_end success')
            const finalError = optionalString(
              event,
              'finalError',
              'Pi RPC auto_retry_end finalError',
            )
            recordTerminalError(
              success
                ? 'Pi RPC completed an implicit automatic retry.'
                : `Pi RPC automatic retry failed: ${finalError ?? 'unknown retry failure'}`,
            )
            break
          }
          case 'summarization_retry_scheduled':
            only(['attempt', 'maxAttempts', 'delayMs', 'errorMessage'])
            requiredInteger(event, 'attempt', 'Pi RPC summarization retry attempt')
            requiredInteger(event, 'maxAttempts', 'Pi RPC summarization retry maxAttempts')
            requiredInteger(event, 'delayMs', 'Pi RPC summarization retry delayMs')
            recordTerminalError(
              `Pi RPC attempted an implicit summarization retry: ${requiredString(
                event,
                'errorMessage',
                'Pi RPC summarization retry errorMessage',
              )}`,
            )
            break
          case 'summarization_retry_attempt_start': {
            only(['source', 'reason'])
            const source = requiredString(event, 'source', 'Pi RPC summarization retry source')
            if (source !== 'branchSummary' && source !== 'compaction') {
              throw new CliProtocolError(
                `Pi RPC summarization retry source "${source}" is unsupported.`,
              )
            }
            if (source === 'compaction') {
              compactionReason(event)
            }
            recordTerminalError('Pi RPC started an implicit summarization retry.')
            break
          }
          case 'summarization_retry_finished':
            only([])
            recordTerminalError('Pi RPC completed an implicit summarization retry.')
            break
          case 'extension_error': {
            only(['extensionPath', 'event', 'error'])
            requiredString(event, 'extensionPath', 'Pi RPC extension_error extensionPath')
            requiredString(event, 'event', 'Pi RPC extension_error event')
            recordTerminalError(
              `Pi extension failed: ${requiredString(
                event,
                'error',
                'Pi RPC extension_error error',
              )}`,
            )
            break
          }
          case 'agent_settled':
            only([])
            settled = true
            resolveSettled?.()
            break
          default:
            throw new CliProtocolError(`Pi RPC event type "${String(event.type)}" is unsupported.`)
        }
      }

      client = await PiRpcClient.start({
        command: options.command ?? this.defaultCommand,
        args: argumentPlan.args,
        cwd: context.cwd,
        environment: runtime.environment,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
        redaction,
        onEvent: onRpcEvent,
      })
      const runningClient = client
      void runningClient.completion.catch(() => undefined)
      let rejectCancellation: ((error: Error) => void) | undefined
      const cancellation = new Promise<never>((_resolvePromise, rejectPromise) => {
        rejectCancellation = rejectPromise
      })
      abortListener = () => {
        void (async () => {
          try {
            await runningClient.abort()
            await delay(SETTLEMENT_GRACE_MS)
          } catch {
            // Bounded process-tree cleanup remains authoritative.
          } finally {
            await runningClient.close().catch(() => undefined)
            rejectCancellation?.(new CliAbortedError('Pi RPC execution was aborted.'))
          }
        })()
      }
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) {
        abortListener()
      }
      const request = (command: Parameters<PiRpcClient['request']>[0]) =>
        Promise.race([runningClient.request(command), cancellation])

      const initialState = parseState((await request({ type: 'get_state' })).data)
      assertFreshInitialState(initialState)
      const modelCommand = configuredModelCommand(options)
      if (modelCommand !== undefined) {
        await request({ type: 'set_model', ...modelCommand })
      }
      if (options.thinking !== undefined) {
        await request({ type: 'set_thinking_level', level: options.thinking })
      }

      await request({
        type: 'prompt',
        message: buildPiExecutionPrompt(role, task, resolvePiPromptProfile(options)),
      })
      const executionTimeoutMs = options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
      const timeout = new Promise<never>((_resolvePromise, rejectPromise) => {
        const timer = setTimeout(
          () =>
            rejectPromise(
              new CliTimeoutError(
                `Pi RPC execution did not settle within ${executionTimeoutMs} ms.`,
              ),
            ),
          executionTimeoutMs,
        )
        timer.unref()
        settledPromise.finally(() => clearTimeout(timer)).catch(() => undefined)
      })
      await Promise.race([
        settledPromise,
        cancellation,
        timeout,
        runningClient.completion.then(() => {
          if (!settled) {
            throw new CliProtocolError('Pi RPC process exited without agent_settled.')
          }
        }),
      ])
      if (signal.aborted) {
        await cancellation
      }

      if (!settled) {
        throw new CliProtocolError('Pi RPC run did not emit agent_settled.')
      }
      if (terminalError !== undefined) {
        throw new CliProtocolError(redactText(terminalError, redaction))
      }
      if (finalMessage === undefined || finalMessage.text.trim().length === 0) {
        throw new CliProtocolError('Pi RPC run settled without a final assistant message.')
      }
      const finalAssistant = finalMessage

      const response = this.parseProtocol(options, context.sensitiveValues, () =>
        withoutExecutorIdentity(JSON.parse(finalAssistant.text) as ExecutorResponse),
      )
      const finalState = parseState((await request({ type: 'get_state' })).data)
      const stateIdentity = modelIdentity(finalState)
      const actualProvider = stateIdentity?.provider ?? finalAssistant.provider
      const actualModel = stateIdentity?.model ?? finalAssistant.model
      return {
        ...response,
        evidence: [
          ...(Array.isArray(response.evidence) ? response.evidence : []),
          {
            kind: 'command',
            value: runningClient.commandDisplay,
            description: 'Pi RPC invocation',
          },
        ],
        usage: usageWithDuration(response, finalAssistant.usage, performance.now() - startedAt),
        ...(actualProvider === undefined ? {} : { provider: actualProvider }),
        ...(actualModel === undefined ? {} : { model: actualModel }),
      }
    } finally {
      if (abortListener !== undefined) {
        signal.removeEventListener('abort', abortListener)
      }
      await client?.close().catch(() => undefined)
      await processEnvironment.cleanup?.()
    }
  }
}

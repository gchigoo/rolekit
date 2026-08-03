#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const capturePath = process.env.ROLEKIT_FAKE_RPC_CAPTURE
const rawMode = process.env.ROLEKIT_FAKE_RPC_MODE ?? 'normal'
const mode =
  rawMode === 'fixture-usage-mode'
    ? 'usage'
    : rawMode === 'fixture-usage-observed-mode'
      ? 'usage-observed'
      : rawMode
const childPidPath = process.env.ROLEKIT_FAKE_RPC_CHILD_PID
const missingFeature = process.env.ROLEKIT_FAKE_MISSING_FEATURE
const modeIndex = args.indexOf('--mode')
const rejectsRpcMode =
  missingFeature === 'pi-rpc-mode-rpc' && modeIndex >= 0 && args[modeIndex + 1] === 'rpc'
const missingAssistantEventPrefix = 'missing-assistant-event-payload-'
const missingAssistantEventType = mode.startsWith(missingAssistantEventPrefix)
  ? mode.slice(missingAssistantEventPrefix.length)
  : undefined
let rpcOrdinal = 0

async function capture(record) {
  if (capturePath !== undefined) {
    await appendFile(
      capturePath,
      `${JSON.stringify({ ...record, ...(rpcOrdinal === 0 ? {} : { rpcOrdinal }) })}\n`,
      'utf8',
    )
  }
}

if (args.includes('--version')) {
  await capture({ phase: 'probe-version', args })
  process.stdout.write('fake-pi-rpc 1.0.0\n')
  process.exit(0)
}

if (args.includes('--help')) {
  await capture({ phase: 'probe-help', args })
  if (rejectsRpcMode) {
    process.stderr.write('unsupported compatibility value: pi-rpc-mode-rpc\n')
    process.exit(2)
  }
  process.stdout.write(
    '--mode --no-session --no-context-files --no-extensions --no-skills --no-prompt-templates --extension --skill --prompt-template --tools --system-prompt --provider --model --thinking --offline\n',
  )
  process.exit(0)
}

if (rejectsRpcMode) {
  process.stderr.write('unsupported execution value: pi-rpc-mode-rpc\n')
  process.exit(2)
}

async function nextRpcOrdinal() {
  if (capturePath === undefined) {
    return 1
  }
  try {
    const records = (await readFile(capturePath, 'utf8'))
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line))
    return records.filter((record) => record.phase === 'startup').length + 1
  } catch {
    return 1
  }
}

rpcOrdinal = await nextRpcOrdinal()
const executionProcess = rpcOrdinal >= 2

await capture({
  phase: 'startup',
  args,
  environment: {
    XAI_API_KEY: process.env.XAI_API_KEY ?? null,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? null,
    HOME: process.env.HOME ?? null,
  },
})

let provider = 'fixture-provider'
let modelId = 'fixture-model'
let thinkingLevel = 'medium'
let input = ''
let descendant
let getStateCount = 0
let heldFirstCommand

function writeRecord(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function response(command, success = true, data, error) {
  writeRecord({
    ...(command.id === undefined ? {} : { id: command.id }),
    type: 'response',
    command: command.type,
    success,
    ...(data === undefined ? {} : { data }),
    ...(error === undefined ? {} : { error }),
  })
}

function state() {
  let model = {
    id: modelId,
    name: 'Fixture model',
    api: 'fixture-api',
    provider,
    reasoning: true,
    input: ['text'],
    contextWindow: 100000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  if (mode === 'probe-insufficient-model' && rpcOrdinal === 1) {
    model = { ...model, provider: 'unknown', id: 'unknown' }
  }
  if (mode === 'probe-null-model-configured' && rpcOrdinal === 1) {
    model = null
  }
  return {
    model,
    thinkingLevel,
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    sessionFile: mode === 'persisted-session' ? '/tmp/persisted-session.jsonl' : null,
    sessionId: 'fake-session',
    autoCompactionEnabled: false,
    messageCount: mode === 'stale-messages' ? 1 : 0,
    pendingMessageCount: mode === 'stale-pending' ? 1 : 0,
  }
}

function completedPayload() {
  return {
    status: 'completed',
    summary: 'Pi RPC completed',
    output: { message: 'pi-rpc' },
    artifacts: [{ name: 'report', kind: 'text', content: 'pi-rpc report' }],
    evidence: [{ kind: 'note', value: 'pi-rpc fixture' }],
  }
}

function assistantMessage(payloadText, stopReason = 'stop', errorMessage) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: payloadText }],
    api: 'fixture-api',
    provider,
    model: modelId,
    ...(mode === 'usage' || mode === 'usage-observed'
      ? {
          usage: {
            input: 13,
            output: 8,
            cacheRead: 2,
            totalTokens: 23,
            cost: { total: 0.02 },
          },
        }
      : {}),
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: Date.now(),
  }
}

function completedToolCall() {
  return {
    type: 'toolCall',
    id: 'tool-1',
    name: 'read',
    arguments: { path: 'README.md' },
  }
}

function toolCallAssistantMessage() {
  return {
    ...assistantMessage('', 'toolUse'),
    ...(mode === 'non-text-usage'
      ? {
          usage: {
            input: 21,
            output: 5,
            cacheRead: 3,
            totalTokens: 29,
            cost: { total: 0.03 },
          },
        }
      : {}),
    content: [
      ...(mode === 'non-text-usage'
        ? [{ type: 'thinking', thinking: 'Inspect the requested file.' }]
        : []),
      completedToolCall(),
    ],
  }
}

function documentedAssistantEvent(type, payloadText) {
  const textMessage = assistantMessage(payloadText)
  const toolMessage = toolCallAssistantMessage()
  switch (type) {
    case 'start':
      return { type, partial: textMessage }
    case 'text_start':
    case 'thinking_start':
      return { type, contentIndex: 0, partial: textMessage }
    case 'text_delta':
    case 'thinking_delta':
      return { type, contentIndex: 0, delta: payloadText, partial: textMessage }
    case 'text_end':
    case 'thinking_end':
      return { type, contentIndex: 0, content: payloadText, partial: textMessage }
    case 'toolcall_start':
      return { type, contentIndex: 0, partial: toolMessage }
    case 'toolcall_delta':
      return {
        type,
        contentIndex: 0,
        delta: JSON.stringify(completedToolCall().arguments),
        partial: toolMessage,
      }
    case 'toolcall_end':
      return { type, contentIndex: 0, toolCall: completedToolCall(), partial: toolMessage }
    case 'done':
      return { type, reason: 'stop', message: textMessage }
    case 'error':
      return { type, reason: 'error', error: assistantMessage('', 'error', 'fixture error') }
    default:
      throw new Error(`unsupported assistant event fixture type: ${String(type)}`)
  }
}

function missingAssistantEventPayload(type, payloadText) {
  const event = documentedAssistantEvent(type, payloadText)
  const missingField = {
    start: 'partial',
    text_start: 'partial',
    text_delta: 'partial',
    text_end: 'content',
    thinking_start: 'partial',
    thinking_delta: 'partial',
    thinking_end: 'content',
    toolcall_start: 'partial',
    toolcall_delta: 'partial',
    toolcall_end: 'toolCall',
    done: 'message',
    error: 'error',
  }[type]
  if (missingField === undefined) {
    throw new Error(`unsupported missing assistant event fixture type: ${String(type)}`)
  }
  delete event[missingField]
  return event
}

function isHeldExecutionCommand(commandType) {
  if (!executionProcess) {
    return false
  }
  return (
    (mode === 'cancel-initial-state' && commandType === 'get_state' && getStateCount === 1) ||
    (mode === 'cancel-model-setup' && commandType === 'set_model') ||
    (mode === 'cancel-thinking-setup' && commandType === 'set_thinking_level') ||
    (mode === 'cancel-prompt-ack' && commandType === 'prompt') ||
    (mode === 'cancel-final-state' && commandType === 'get_state' && getStateCount === 2)
  )
}

async function handleDirectClientMode(command) {
  switch (mode) {
    case 'client-out-of-order':
      if (command.type === 'first') {
        heldFirstCommand = command
        return true
      }
      if (command.type === 'second' && heldFirstCommand !== undefined) {
        response(command, true, { order: 2 })
        response(heldFirstCommand, true, { order: 1 })
        heldFirstCommand = undefined
        return true
      }
      return false
    case 'client-unknown-id':
      writeRecord({
        id: `${String(command.id)}-unknown`,
        type: 'response',
        command: command.type,
        success: true,
      })
      return true
    case 'client-duplicate-id':
      response(command, true)
      response(command, true)
      return true
    case 'client-command-mismatch':
      if (command.type === 'mismatch') {
        writeRecord({
          id: command.id,
          type: 'response',
          command: 'different-command',
          success: true,
        })
        return true
      }
      return false
    case 'client-timeout':
      if (command.type === 'slow') {
        return true
      }
      return false
    case 'client-exit-pending':
      process.exit(0)
      return true
    case 'client-output-overflow':
      writeRecord({ type: 'agent_start' })
      process.stderr.write('x'.repeat(256))
      return true
    default:
      return false
  }
}

function emitAssistantUpdate(message, assistantMessageEvent) {
  writeRecord({ type: 'message_update', message, assistantMessageEvent })
}

function emitToolCallOnlyTurn(payloadText) {
  const toolMessage = toolCallAssistantMessage()
  const finalMessage = assistantMessage(payloadText)

  writeRecord({ type: 'agent_start' })
  writeRecord({ type: 'turn_start' })
  writeRecord({ type: 'message_start', message: toolMessage })
  for (const type of [
    'start',
    'toolcall_start',
    'toolcall_delta',
    'toolcall_end',
    'done',
  ]) {
    const event = documentedAssistantEvent(type, payloadText)
    emitAssistantUpdate(
      toolMessage,
      type === 'start'
        ? { ...event, partial: toolMessage }
        : type === 'done'
          ? { ...event, reason: 'toolUse', message: toolMessage }
          : event,
    )
  }
  writeRecord({ type: 'message_end', message: toolMessage })
  writeRecord({
    type: 'tool_execution_start',
    toolCallId: 'tool-1',
    toolName: 'read',
    args: { path: 'README.md' },
  })
  const toolResult = {
    toolCallId: 'tool-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'read complete' }],
    isError: false,
  }
  writeRecord({
    type: 'tool_execution_end',
    toolCallId: 'tool-1',
    toolName: 'read',
    result: toolResult,
    isError: false,
  })
  writeRecord({ type: 'turn_end', message: toolMessage, toolResults: [toolResult] })

  writeRecord({ type: 'turn_start' })
  writeRecord({ type: 'message_start', message: finalMessage })
  for (const type of ['start', 'text_start', 'text_delta', 'text_end', 'done']) {
    emitAssistantUpdate(finalMessage, documentedAssistantEvent(type, payloadText))
  }
  writeRecord({ type: 'message_end', message: finalMessage })
  writeRecord({ type: 'turn_end', message: finalMessage, toolResults: [] })
  writeRecord({ type: 'agent_end', messages: [toolMessage, finalMessage] })
  writeRecord({ type: 'agent_settled' })
}

function emitScenarioEvents(payloadText) {
  if (mode === 'tool-call-only-turn' || mode === 'non-text-usage') {
    emitToolCallOnlyTurn(payloadText)
    return
  }

  if (mode === 'non-text-terminal-error' || mode === 'non-text-terminal-aborted') {
    const stopReason = mode.endsWith('aborted') ? 'aborted' : 'error'
    const terminalMessage = {
      ...toolCallAssistantMessage(),
      stopReason,
      errorMessage: `fixture non-text assistant stopped with ${stopReason}`,
    }
    const finalMessage = assistantMessage(payloadText)

    writeRecord({ type: 'agent_start' })
    writeRecord({ type: 'turn_start' })
    writeRecord({ type: 'message_start', message: terminalMessage })
    emitAssistantUpdate(terminalMessage, { type: 'start', partial: terminalMessage })
    writeRecord({ type: 'message_end', message: terminalMessage })
    writeRecord({ type: 'turn_end', message: terminalMessage, toolResults: [] })
    writeRecord({ type: 'turn_start' })
    writeRecord({ type: 'message_start', message: finalMessage })
    for (const type of ['start', 'text_start', 'text_delta', 'text_end', 'done']) {
      emitAssistantUpdate(finalMessage, documentedAssistantEvent(type, payloadText))
    }
    writeRecord({ type: 'message_end', message: finalMessage })
    writeRecord({ type: 'turn_end', message: finalMessage, toolResults: [] })
    writeRecord({ type: 'agent_end', messages: [terminalMessage, finalMessage] })
    writeRecord({ type: 'agent_settled' })
    return
  }

  const finalStopReason = mode === 'terminal-error' ? 'error' : 'stop'
  const finalErrorMessage =
    mode === 'terminal-error'
      ? `fixture terminal error ${process.env.XAI_API_KEY ?? ''}`
      : undefined
  const finalMessage = assistantMessage(payloadText, finalStopReason, finalErrorMessage)

  writeRecord({ type: 'agent_start' })
  if (mode === 'benign-events') {
    writeRecord({ type: 'turn_start' })
    writeRecord({ type: 'message_start', message: finalMessage })
    writeRecord({ type: 'queue_update', steering: [], followUp: [] })
    writeRecord({ type: 'compaction_start', reason: 'manual' })
    writeRecord({
      type: 'compaction_end',
      reason: 'manual',
      aborted: false,
      willRetry: false,
    })
  }
  if (mode === 'unknown-event') {
    writeRecord({ type: 'agent_failure', error: 'unrecognized terminal failure' })
  }
  if (mode === 'malformed-event') {
    writeRecord({ type: 'agent_end', messages: 'not-an-array' })
  }
  if (mode === 'unknown-assistant-update') {
    writeRecord({
      type: 'message_update',
      message: finalMessage,
      assistantMessageEvent: { type: 'fatal', reason: 'unknown failure' },
    })
  }
  if (missingAssistantEventType !== undefined) {
    emitAssistantUpdate(
      finalMessage,
      missingAssistantEventPayload(missingAssistantEventType, payloadText),
    )
  }
  if (mode === 'auto-retry-started') {
    writeRecord({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 10,
      errorMessage: 'automatic retry started',
    })
  }
  if (mode === 'auto-retry-failed') {
    writeRecord({
      type: 'auto_retry_end',
      success: false,
      attempt: 3,
      finalError: 'automatic retry exhausted',
    })
  }
  if (mode === 'summarization-retry') {
    writeRecord({
      type: 'summarization_retry_scheduled',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 10,
      errorMessage: 'summarization retry scheduled',
    })
  }
  if (mode === 'queued-work') {
    writeRecord({ type: 'queue_update', steering: ['queued steering'], followUp: [] })
  }
  if (mode === 'compaction-aborted') {
    writeRecord({
      type: 'compaction_end',
      reason: 'overflow',
      aborted: true,
      willRetry: false,
      errorMessage: 'compaction aborted',
    })
  }
  if (mode === 'extension-error') {
    writeRecord({
      type: 'extension_error',
      extensionPath: '/tmp/extension.ts',
      event: 'tool_call',
      error: 'extension failed',
    })
  }

  writeRecord({
    type: 'message_update',
    message: finalMessage,
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta: payloadText,
      partial: finalMessage,
    },
  })
  writeRecord({
    type: 'tool_execution_start',
    toolCallId: 'tool-1',
    toolName: 'read',
    args: { path: 'README.md' },
  })
  if (mode === 'benign-events') {
    writeRecord({
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
      partialResult: { content: [{ type: 'text', text: 'partial' }] },
    })
  }
  writeRecord({
    type: 'tool_execution_end',
    toolCallId: 'tool-1',
    toolName: 'read',
    result: { content: [{ type: 'text', text: 'read complete' }] },
    isError: false,
  })
  writeRecord({ type: 'message_end', message: finalMessage })
  if (mode === 'benign-events') {
    writeRecord({ type: 'turn_end', message: finalMessage, toolResults: [] })
    writeRecord({ type: 'agent_end', messages: [finalMessage] })
  }
  if (mode !== 'missing-terminal') {
    writeRecord(
      mode === 'settled-with-error'
        ? { type: 'agent_settled', error: 'hidden terminal failure' }
        : { type: 'agent_settled' },
    )
  }
}

async function handle(command) {
  await capture({ phase: 'command', command })
  if (await handleDirectClientMode(command)) {
    return
  }

  switch (command.type) {
    case 'get_state':
      getStateCount += 1
      if (isHeldExecutionCommand(command.type)) {
        return
      }
      response(command, true, state())
      return
    case 'set_model':
      if (isHeldExecutionCommand(command.type)) {
        return
      }
      if (mode === 'probe-set-model-failure' && rpcOrdinal === 1) {
        response(command, false, undefined, 'set_model fixture failure')
        return
      }
      if (typeof command.provider !== 'string' || typeof command.modelId !== 'string') {
        response(command, false, undefined, 'provider and modelId are required')
        return
      }
      provider = command.provider
      modelId = command.modelId
      response(command, true, state().model)
      return
    case 'set_thinking_level':
      if (isHeldExecutionCommand(command.type)) {
        return
      }
      thinkingLevel = command.level
      response(command, true)
      return
    case 'prompt': {
      if (isHeldExecutionCommand(command.type)) {
        return
      }
      response(command, true)
      if (mode === 'usage-observed') {
        provider = 'observed-provider'
        modelId = 'observed-model'
      }
      if (childPidPath !== undefined) {
        descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        })
        if (descendant.pid !== undefined) {
          await writeFile(childPidPath, String(descendant.pid), 'utf8')
        }
      }
      if (mode === 'hang') {
        writeRecord({ type: 'agent_start' })
        return
      }
      if (mode === 'malformed') {
        process.stdout.write('not-json\n')
        return
      }
      const payloadText = JSON.stringify(completedPayload())
      emitScenarioEvents(payloadText)
      if (mode === 'missing-terminal') {
        process.exit(0)
      }
      return
    }
    case 'abort':
      response(command, true)
      writeRecord({
        type: 'message_update',
        message: assistantMessage('', 'aborted', 'aborted'),
        assistantMessageEvent: {
          type: 'error',
          reason: 'aborted',
          error: assistantMessage('', 'aborted', 'aborted'),
        },
      })
      writeRecord({ type: 'agent_settled' })
      return
    default:
      response(command, false, undefined, `unsupported command: ${String(command.type)}`)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  while (true) {
    const newline = input.indexOf('\n')
    if (newline === -1) {
      break
    }
    let line = input.slice(0, newline)
    input = input.slice(newline + 1)
    if (line.endsWith('\r')) {
      line = line.slice(0, -1)
    }
    if (line.length === 0) {
      continue
    }
    let command
    try {
      command = JSON.parse(line)
    } catch {
      writeRecord({ type: 'response', command: 'parse', success: false, error: 'invalid JSON' })
      continue
    }
    void handle(command)
  }
})

process.stdin.resume()

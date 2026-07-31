import type {
  Capability,
  ExecutionContext,
  ExecutorResponse,
  RoleSpec,
  TaskPacket,
  TokenUsage,
} from '../../core/types.ts'
import { CliAdapterBase } from '../cli/base.ts'
import type { CliAdapterOptions } from '../cli/options.ts'
import {
  firstString,
  isRecord,
  parseExecutorPayload,
  parseJsonLines,
  readUsage,
  textFromContent,
} from '../cli/parse.ts'
import { buildExecutionPrompt } from '../cli/prompt.ts'

interface PiFinalMessage {
  readonly text: string
  readonly model?: string
  readonly usage?: TokenUsage
}

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
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
  }
}

function parsePiStream(stdout: string): PiFinalMessage {
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

function toolAllowlist(role: RoleSpec, task: TaskPacket): string {
  const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
  const tools = ['read', 'grep', 'find', 'ls']
  if (required.has('repository.write')) {
    tools.push('edit', 'write')
  }
  if (required.has('shell')) {
    tools.push('bash')
  }
  return tools.join(',')
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

export class PiCliAdapter extends CliAdapterBase {
  readonly id = 'pi'
  protected readonly displayName = 'Pi CLI'
  protected readonly defaultCommand = 'pi'
  protected readonly defaultCapabilities: readonly Capability[] = [
    'repository.read',
    'repository.write',
    'shell',
  ]

  protected async executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext,
    options: CliAdapterOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse> {
    const args = [
      '--mode',
      'json',
      '--print',
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--approve',
      '--tools',
      toolAllowlist(role, task),
      ...(options.provider === undefined ? [] : ['--provider', options.provider]),
      ...(options.model === undefined ? [] : ['--model', options.model]),
      ...(options.extraArgs ?? []),
    ]
    const processResult = await this.run(
      context,
      options,
      args,
      buildExecutionPrompt(role, task),
      signal,
    )
    if (processResult.exitCode !== 0) {
      throw new Error(
        processResult.stderr.trim() || `Pi CLI exited with code ${processResult.exitCode}.`,
      )
    }

    const parsed = parsePiStream(processResult.stdout)
    const response = parseExecutorPayload(parsed.text)
    const model = parsed.model ?? options.model
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
      ...(model === undefined ? {} : { model }),
    }
  }
}

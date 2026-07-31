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
  firstNumber,
  firstString,
  parseExecutorPayload,
  parseJsonLines,
  readUsage,
} from '../cli/parse.ts'
import { buildExecutionPrompt } from '../cli/prompt.ts'

interface CursorStreamResult {
  readonly finalText: string
  readonly model?: string
  readonly usage?: TokenUsage
}

function parseCursorStream(stdout: string): CursorStreamResult {
  let finalText: string | undefined
  let model: string | undefined
  let usage: TokenUsage | undefined

  for (const event of parseJsonLines(stdout)) {
    const type = firstString(event, 'type')
    const subtype = firstString(event, 'subtype')
    if (type === 'system' && subtype === 'init') {
      model = firstString(event, 'model') ?? model
    }
    if (type === 'result') {
      finalText = firstString(event, 'result', 'text', 'content') ?? finalText
      model = firstString(event, 'model') ?? model
      usage = readUsage(event.usage) ?? usage
      const durationMs = firstNumber(event, 'duration_ms', 'durationMs')
      if (durationMs !== undefined) {
        usage = { ...usage, durationMs }
      }
    }
  }

  if (finalText === undefined) {
    throw new Error('Cursor CLI stream did not contain a terminal result.')
  }
  return {
    finalText,
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
  }
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

export class CursorCliAdapter extends CliAdapterBase {
  readonly id = 'cursor'
  protected readonly displayName = 'Cursor Agent CLI'
  protected readonly defaultCommand = 'cursor-agent'
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
    const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
    const needsApprovalBypass = required.has('repository.write') || required.has('shell')
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--workspace',
      context.cwd,
      '--trust',
      ...(needsApprovalBypass ? ['--force'] : ['--mode', 'plan']),
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
        processResult.stderr.trim() || `Cursor CLI exited with code ${processResult.exitCode}.`,
      )
    }

    const parsed = parseCursorStream(processResult.stdout)
    const response = parseExecutorPayload(parsed.finalText)
    const model = parsed.model ?? options.model
    return {
      ...response,
      evidence: [
        ...(Array.isArray(response.evidence) ? response.evidence : []),
        {
          kind: 'command',
          value: processResult.commandDisplay,
          description: 'Cursor CLI invocation',
        },
      ],
      usage: mergeUsage(response, parsed.usage, processResult.durationMs),
      ...(model === undefined ? {} : { model }),
    }
  }
}

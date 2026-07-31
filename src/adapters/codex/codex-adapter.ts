import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createExecutorPayloadSchema } from '../../core/schemas.ts'
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
} from '../cli/parse.ts'
import { buildExecutionPrompt } from '../cli/prompt.ts'

interface CodexEventData {
  readonly model?: string
  readonly usage?: TokenUsage
}

function parseCodexEvents(stdout: string): CodexEventData {
  let model: string | undefined
  let usage: TokenUsage | undefined
  for (const event of parseJsonLines(stdout)) {
    model = firstString(event, 'model') ?? model
    usage = readUsage(event.usage) ?? usage
    if (isRecord(event.message)) {
      model = firstString(event.message, 'model') ?? model
      usage = readUsage(event.message.usage) ?? usage
    }
  }
  return {
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

export class CodexCliAdapter extends CliAdapterBase {
  readonly id = 'codex'
  protected readonly displayName = 'Codex CLI'
  protected readonly defaultCommand = 'codex'
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
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rolekit-codex-'))
    const schemaPath = join(temporaryDirectory, 'response.schema.json')
    const outputPath = join(temporaryDirectory, 'response.json')
    try {
      await writeFile(
        schemaPath,
        `${JSON.stringify(createExecutorPayloadSchema(role.outputSchema), null, 2)}\n`,
        'utf8',
      )
      const required = new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])])
      const sandbox = required.has('repository.write') ? 'workspace-write' : 'read-only'
      const args = [
        'exec',
        '--json',
        '--ephemeral',
        '--color',
        'never',
        '--skip-git-repo-check',
        '-C',
        context.cwd,
        '-s',
        sandbox,
        '--output-schema',
        schemaPath,
        '-o',
        outputPath,
        ...(options.model === undefined ? [] : ['--model', options.model]),
        ...(options.extraArgs ?? []),
        '-',
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
          processResult.stderr.trim() || `Codex CLI exited with code ${processResult.exitCode}.`,
        )
      }

      const finalText = await readFile(outputPath, 'utf8')
      const eventData = parseCodexEvents(processResult.stdout)
      const response = parseExecutorPayload(finalText)
      const model = eventData.model ?? options.model
      return {
        ...response,
        evidence: [
          ...(Array.isArray(response.evidence) ? response.evidence : []),
          {
            kind: 'command',
            value: processResult.commandDisplay,
            description: 'Codex CLI invocation',
          },
        ],
        usage: mergeUsage(response, eventData.usage, processResult.durationMs),
        ...(model === undefined ? {} : { model }),
      }
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      })
    }
  }
}

import type {
  Capability,
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptor,
  ExecutorResponse,
  RoleSpec,
  TaskPacket,
} from '../../core/types.ts'
import { type CliAdapterOptions, parseCliAdapterOptions } from './options.ts'
import { type CliProcessOptions, type CliProcessResult, runCliProcess } from './process.ts'

export abstract class CliAdapterBase implements ExecutorAdapter {
  abstract readonly id: string
  protected abstract readonly displayName: string
  protected abstract readonly defaultCommand: string
  protected abstract readonly defaultCapabilities: readonly Capability[]

  readonly #inflight = new Map<string, AbortController>()

  async describe(optionsValue: unknown): Promise<ExecutorDescriptor> {
    const options = parseCliAdapterOptions(optionsValue)
    const command = options.command ?? this.defaultCommand
    try {
      const probe = await runCliProcess({
        command,
        args: [...(options.commandArgs ?? []), '--version'],
        cwd: process.cwd(),
        ...(options.environment === undefined ? {} : { environment: options.environment }),
        timeoutMs: Math.min(options.timeoutMs ?? 5_000, 30_000),
        maxOutputBytes: 128 * 1024,
      })
      const version = (probe.stdout.trim() || probe.stderr.trim()).split(/\r?\n/u)[0]
      const available = probe.exitCode === 0
      return {
        id: this.id,
        displayName: this.displayName,
        transport: 'cli',
        capabilities: options.capabilities ?? this.defaultCapabilities,
        available,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(version === undefined || version.length === 0 ? {} : { version }),
        ...(available
          ? {}
          : {
              diagnostic:
                probe.stderr.trim() ||
                `${this.displayName} version probe exited with code ${probe.exitCode}.`,
            }),
      }
    } catch (error: unknown) {
      return {
        id: this.id,
        displayName: this.displayName,
        transport: 'cli',
        capabilities: options.capabilities ?? this.defaultCapabilities,
        available: false,
        ...(options.model === undefined ? {} : { model: options.model }),
        diagnostic: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async execute(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext,
  ): Promise<ExecutorResponse> {
    const options = parseCliAdapterOptions(context.options)
    const controller = new AbortController()
    this.#inflight.set(context.runId, controller)
    const signal =
      context.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, context.signal])
    try {
      return await this.executeCli(role, task, context, options, signal)
    } finally {
      this.#inflight.delete(context.runId)
    }
  }

  async cancel(runId: string): Promise<void> {
    this.#inflight.get(runId)?.abort()
  }

  protected abstract executeCli(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext,
    options: CliAdapterOptions,
    signal: AbortSignal,
  ): Promise<ExecutorResponse>

  protected run(
    context: ExecutionContext,
    options: CliAdapterOptions,
    args: readonly string[],
    input: string,
    signal: AbortSignal,
  ): Promise<CliProcessResult> {
    const processOptions: CliProcessOptions = {
      command: options.command ?? this.defaultCommand,
      args: [...(options.commandArgs ?? []), ...args],
      cwd: context.cwd,
      input,
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      signal,
    }
    return runCliProcess(processOptions)
  }
}

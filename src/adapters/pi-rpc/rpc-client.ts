import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import {
  CliExitError,
  CliIoError,
  CliOutputLimitError,
  CliProtocolError,
  CliSpawnError,
  CliTimeoutError,
} from '../cli/errors.ts'
import { resolveExecutable } from '../cli/process.ts'
import { type RedactionContext, redactCommand, redactText } from '../cli/redaction.ts'
import { terminateProcessTree } from '../cli/termination.ts'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const CLOSE_GRACE_MS = 250

export interface PiRpcClientOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly redaction: RedactionContext
  readonly onEvent: (event: Readonly<Record<string, unknown>>) => void
}

export interface PiRpcRequest {
  readonly type: string
  readonly [key: string]: unknown
}

export interface PiRpcResponse {
  readonly id: string
  readonly type: 'response'
  readonly command: string
  readonly success: true
  readonly data?: unknown
}

interface PendingRequest {
  readonly command: string
  readonly resolve: (response: PiRpcResponse) => void
  readonly reject: (error: Error) => void
  readonly timeout: NodeJS.Timeout
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error && error.message.length > 0) {
      return error.message
    }
    if (typeof error === 'string' && error.length > 0) {
      return error
    }
  } catch {
    // Hostile process failures use the fixed fallback.
  }
  return 'Unknown Pi RPC process error.'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, milliseconds)
    timeout.unref()
  })
}

export class PiRpcClient {
  readonly commandDisplay: string
  readonly completion: Promise<void>
  readonly #child: ChildProcessWithoutNullStreams
  readonly #options: PiRpcClientOptions
  readonly #pending = new Map<string, PendingRequest>()
  readonly #exit: Promise<void>
  #resolveCompletion: (() => void) | undefined
  #rejectCompletion: ((error: Error) => void) | undefined
  #resolveExit: (() => void) | undefined
  #nextRequestId = 1
  #outputBytes = 0
  #stderr = ''
  #failure: Error | undefined
  #closing = false
  #closed = false

  private constructor(
    child: ChildProcessWithoutNullStreams,
    options: PiRpcClientOptions,
    commandDisplay: string,
  ) {
    this.#child = child
    this.#options = options
    this.commandDisplay = commandDisplay
    this.completion = new Promise<void>((resolvePromise, rejectPromise) => {
      this.#resolveCompletion = resolvePromise
      this.#rejectCompletion = rejectPromise
    })
    this.#exit = new Promise<void>((resolvePromise) => {
      this.#resolveExit = resolvePromise
    })
    this.#attach()
  }

  static async start(options: PiRpcClientOptions): Promise<PiRpcClient> {
    const resolved = await resolveExecutable(options.command, options.cwd, options.environment)
    const args = [...resolved.prefixArgs, ...options.args]
    const commandDisplay = redactCommand(resolved.sourcePath, options.args, options.redaction)
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(resolved.executable, args, {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env: options.environment,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: unknown) {
      throw new CliSpawnError(
        `Failed to spawn ${commandDisplay}: ${redactText(
          safeErrorMessage(error),
          options.redaction,
        )}`,
        { commandDisplay },
      )
    }
    return new PiRpcClient(child, options, commandDisplay)
  }

  request(request: PiRpcRequest, timeoutMs = this.#options.timeoutMs): Promise<PiRpcResponse> {
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure)
    }
    if (this.#closing || this.#closed) {
      return Promise.reject(new CliIoError('Pi RPC process is already closing.'))
    }
    if (typeof request.type !== 'string' || request.type.length === 0) {
      return Promise.reject(new CliProtocolError('Pi RPC request type must be non-empty.'))
    }

    const id = `rolekit-${this.#nextRequestId}`
    this.#nextRequestId += 1
    const effectiveTimeoutMs = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    return new Promise<PiRpcResponse>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        const error = new CliTimeoutError(
          `Pi RPC request "${request.type}" timed out after ${effectiveTimeoutMs} ms.`,
        )
        rejectPromise(error)
        this.#fail(error)
      }, effectiveTimeoutMs)
      timeout.unref()
      this.#pending.set(id, {
        command: request.type,
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout,
      })
      const line = `${JSON.stringify({ ...request, id })}\n`
      this.#child.stdin.write(line, 'utf8', (error) => {
        if (error === null || error === undefined) {
          return
        }
        const pending = this.#pending.get(id)
        if (pending === undefined) {
          return
        }
        this.#pending.delete(id)
        clearTimeout(pending.timeout)
        pending.reject(
          new CliIoError(
            `Pi RPC request "${request.type}" could not be written: ${redactText(
              safeErrorMessage(error),
              this.#options.redaction,
            )}`,
          ),
        )
      })
    })
  }

  async abort(): Promise<void> {
    await this.request({ type: 'abort' }, Math.min(this.#options.timeoutMs ?? 1_000, 1_000))
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }
    this.#closing = true
    try {
      this.#child.stdin.end()
    } catch {
      // Process-tree termination below remains authoritative.
    }
    await Promise.race([this.#exit, delay(CLOSE_GRACE_MS)])
    if (!this.#closed) {
      await terminateProcessTree(this.#child, { graceMs: CLOSE_GRACE_MS })
      await Promise.race([this.#exit, delay(CLOSE_GRACE_MS)])
    }
    this.#child.stdin.destroy()
    this.#child.stdout.destroy()
    this.#child.stderr.destroy()
    this.#child.unref()
  }

  #attach(): void {
    const decoder = new StringDecoder('utf8')
    let stdoutBuffer = ''

    const consumeLine = (rawLine: string): void => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (line.length === 0) {
        this.#fail(new CliProtocolError('Pi RPC stdout contained an empty JSONL record.'))
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error: unknown) {
        this.#fail(
          new CliProtocolError(
            `Pi RPC stdout contained malformed JSONL: ${redactText(
              safeErrorMessage(error),
              this.#options.redaction,
            )}`,
          ),
        )
        return
      }
      if (!isRecord(parsed) || typeof parsed.type !== 'string') {
        this.#fail(new CliProtocolError('Pi RPC stdout record was not a typed JSON object.'))
        return
      }
      if (parsed.type === 'response') {
        this.#handleResponse(parsed)
        return
      }
      try {
        this.#options.onEvent(parsed)
      } catch (error: unknown) {
        this.#fail(
          error instanceof Error
            ? error
            : new CliProtocolError(
                `Pi RPC event handling failed: ${redactText(
                  safeErrorMessage(error),
                  this.#options.redaction,
                )}`,
              ),
        )
      }
    }

    this.#child.stdout.on('data', (chunk: Buffer) => {
      if (!this.#retainOutput(chunk.byteLength)) {
        return
      }
      stdoutBuffer += decoder.write(chunk)
      while (true) {
        const newline = stdoutBuffer.indexOf('\n')
        if (newline === -1) {
          break
        }
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        consumeLine(line)
      }
    })
    this.#child.stdout.once('end', () => {
      stdoutBuffer += decoder.end()
      if (stdoutBuffer.length > 0) {
        consumeLine(stdoutBuffer)
      }
    })
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', (chunk: string) => {
      const bytes = Buffer.byteLength(chunk)
      if (!this.#retainOutput(bytes)) {
        return
      }
      this.#stderr += chunk
    })
    this.#child.stdin.on('error', (error: Error) => {
      if (!this.#closing) {
        this.#fail(
          new CliIoError(
            `Pi RPC stdin failed: ${redactText(safeErrorMessage(error), this.#options.redaction)}`,
          ),
        )
      }
    })
    this.#child.once('error', (error: Error) => {
      this.#fail(
        new CliSpawnError(
          `Pi RPC process failed: ${redactText(safeErrorMessage(error), this.#options.redaction)}`,
          { commandDisplay: this.commandDisplay },
        ),
      )
    })
    this.#child.once('close', (code) => {
      this.#closed = true
      this.#resolveExit?.()
      const unexpected = !this.#closing
      if (unexpected && this.#failure === undefined) {
        this.#failure =
          code === 0
            ? new CliProtocolError('Pi RPC process exited before the protocol completed.')
            : new CliExitError(
                `Pi RPC process exited with code ${String(code)}. Command: ${this.commandDisplay}.${
                  this.#stderr.trim().length === 0
                    ? ''
                    : ` Stderr: ${redactText(this.#stderr.trim(), this.#options.redaction)}`
                }`,
                {
                  exitCode: code ?? 1,
                  stderr: redactText(this.#stderr, this.#options.redaction),
                  commandDisplay: this.commandDisplay,
                },
              )
      }
      const completionError = this.#failure
      this.#rejectPending(
        completionError ?? new CliIoError('Pi RPC process closed before a response arrived.'),
      )
      if (completionError === undefined || this.#closing) {
        this.#resolveCompletion?.()
      } else {
        this.#rejectCompletion?.(completionError)
      }
    })
  }

  #handleResponse(response: Readonly<Record<string, unknown>>): void {
    if (
      typeof response.id !== 'string' ||
      typeof response.command !== 'string' ||
      typeof response.success !== 'boolean'
    ) {
      this.#fail(new CliProtocolError('Pi RPC response fields were malformed.'))
      return
    }
    const pending = this.#pending.get(response.id)
    if (pending === undefined) {
      this.#fail(new CliProtocolError(`Pi RPC response id "${response.id}" was not pending.`))
      return
    }
    this.#pending.delete(response.id)
    clearTimeout(pending.timeout)
    if (response.command !== pending.command) {
      const error = new CliProtocolError(
        `Pi RPC response command "${response.command}" did not match "${pending.command}".`,
      )
      pending.reject(error)
      this.#fail(error)
      return
    }
    if (!response.success) {
      pending.reject(
        new CliProtocolError(
          `Pi RPC command "${pending.command}" failed: ${redactText(
            typeof response.error === 'string' ? response.error : 'Unknown protocol failure.',
            this.#options.redaction,
          )}`,
        ),
      )
      return
    }
    pending.resolve(response as unknown as PiRpcResponse)
  }

  #retainOutput(bytes: number): boolean {
    this.#outputBytes += bytes
    const maxOutputBytes = this.#options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    if (this.#outputBytes <= maxOutputBytes) {
      return true
    }
    this.#fail(
      new CliOutputLimitError(
        `Pi RPC output exceeded the ${maxOutputBytes} byte safety limit. Command: ${this.commandDisplay}.`,
      ),
    )
    return false
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined || this.#closed) {
      return
    }
    this.#failure = error
    this.#rejectPending(error)
    void terminateProcessTree(this.#child, { graceMs: CLOSE_GRACE_MS }).catch(() => undefined)
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

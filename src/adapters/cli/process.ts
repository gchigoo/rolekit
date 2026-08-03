import { type ChildProcess, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'

import {
  CliAbortedError,
  CliConfigurationError,
  CliExitError,
  CliOutputLimitError,
  CliSpawnError,
  CliTimeoutError,
} from './errors.ts'
import {
  type RedactionContext,
  redactCommand,
  redactionContextForArgs,
  redactText,
} from './redaction.ts'
import { terminateProcessTree } from './termination.ts'

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000
const ERROR_EXCERPT_CHARACTERS = 4_096

export interface ResolvedExecutable {
  readonly executable: string
  readonly prefixArgs: readonly string[]
  readonly sourcePath: string
}

export interface CliProcessOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly input?: string
  readonly environment?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
  readonly redaction?: RedactionContext
}

export interface CliProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly executablePath: string
  readonly commandDisplay: string
}

export class ExecutableNotFoundError extends CliConfigurationError {
  readonly command: string

  constructor(command: string) {
    super(`Executable "${command}" was not found on PATH.`)
    this.name = 'ExecutableNotFoundError'
    this.command = command
  }
}

function hasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

async function isAccessible(candidate: string): Promise<boolean> {
  try {
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidateNames(command: string): readonly string[] {
  if (process.platform !== 'win32' || extname(command).length > 0) {
    return [command]
  }
  return [
    `${command}.exe`,
    `${command}.com`,
    `${command}.ps1`,
    `${command}.cmd`,
    `${command}.bat`,
    command,
  ]
}

async function findExecutable(
  command: string,
  cwd: string,
  environment: Readonly<Record<string, string>>,
): Promise<string> {
  if (isAbsolute(command) || hasPathSeparator(command)) {
    const base = isAbsolute(command) ? command : resolve(cwd, command)
    for (const candidate of candidateNames(base)) {
      if (await isAccessible(candidate)) {
        return candidate
      }
    }
    throw new ExecutableNotFoundError(command)
  }

  const pathValue = environment.PATH ?? environment.Path ?? ''
  for (const pathEntry of pathValue.split(delimiter).filter((entry) => entry.length > 0)) {
    const resolvedPathEntry = isAbsolute(pathEntry) ? pathEntry : resolve(cwd, pathEntry)
    for (const candidateName of candidateNames(command)) {
      const candidate = join(resolvedPathEntry, candidateName)
      if (await isAccessible(candidate)) {
        return candidate
      }
    }
  }
  throw new ExecutableNotFoundError(command)
}

function windowsPowerShell(environment: Readonly<Record<string, string>>): string {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows'
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function wrapExecutable(
  sourcePath: string,
  environment: Readonly<Record<string, string>>,
): ResolvedExecutable {
  if (process.platform !== 'win32') {
    return { executable: sourcePath, prefixArgs: [], sourcePath }
  }

  const extension = extname(sourcePath).toLowerCase()
  if (extension === '.ps1') {
    return {
      executable: windowsPowerShell(environment),
      prefixArgs: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        sourcePath,
      ],
      sourcePath,
    }
  }
  if (extension === '.cmd' || extension === '.bat') {
    const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows'
    return {
      executable:
        environment.ComSpec ?? environment.COMSPEC ?? join(systemRoot, 'System32', 'cmd.exe'),
      prefixArgs: ['/d', '/s', '/c', sourcePath],
      sourcePath,
    }
  }
  return { executable: sourcePath, prefixArgs: [], sourcePath }
}

export async function resolveExecutable(
  command: string,
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<ResolvedExecutable> {
  return wrapExecutable(await findExecutable(command, cwd, environment), environment)
}

function bufferText(buffers: readonly Buffer[]): string {
  return Buffer.concat(buffers).toString('utf8')
}

export function copyRetainedOutputPrefix(chunk: Buffer, retainedBytes: number): Buffer {
  const byteLength = Math.min(chunk.byteLength, Math.max(0, retainedBytes))
  const retained = Buffer.allocUnsafeSlow(byteLength)
  chunk.copy(retained, 0, 0, byteLength)
  return retained
}

function truncateRedacted(text: string, context: RedactionContext): string {
  const redacted = redactText(text, context)
  if (redacted.length <= ERROR_EXCERPT_CHARACTERS) {
    return redacted
  }
  return `${redacted.slice(0, ERROR_EXCERPT_CHARACTERS)}…`
}

function outputExcerpt(
  stdout: readonly Buffer[],
  stderr: readonly Buffer[],
  context: RedactionContext,
): string {
  const stderrText = bufferText(stderr).trim()
  const stdoutText = bufferText(stdout).trim()
  if (stderrText.length > 0) {
    return ` Stderr: ${truncateRedacted(stderrText, context)}`
  }
  if (stdoutText.length > 0) {
    return ` Stdout: ${truncateRedacted(stdoutText, context)}`
  }
  return ''
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
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
    // Hostile thrown values must not escape process-error normalization.
  }
  return 'Unknown process error.'
}

export async function runCliProcess(options: CliProcessOptions): Promise<CliProcessResult> {
  if (isAborted(options.signal)) {
    throw new CliAbortedError('CLI execution was aborted before executable resolution.')
  }

  const environment = options.environment ?? {}
  const redaction = redactionContextForArgs(options.args, options.redaction)
  const unresolvedCommandDisplay = redactCommand(options.command, options.args, redaction)
  let resolved: ResolvedExecutable
  try {
    resolved = await resolveExecutable(options.command, options.cwd, environment)
  } catch (error: unknown) {
    const redactedCommand = redactText(options.command, redaction)
    if (error instanceof ExecutableNotFoundError) {
      throw new ExecutableNotFoundError(redactedCommand)
    }
    throw new CliConfigurationError(
      `Failed to resolve ${unresolvedCommandDisplay}: ${truncateRedacted(safeErrorMessage(error), redaction)}`,
    )
  }
  if (isAborted(options.signal)) {
    throw new CliAbortedError('CLI execution was aborted during executable resolution.')
  }

  const args = [...resolved.prefixArgs, ...options.args]
  const commandDisplay = redactCommand(resolved.sourcePath, options.args, redaction)
  const maxOutputBytes = Math.max(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startedAt = Date.now()

  return new Promise<CliProcessResult>((resolvePromise, rejectPromise) => {
    let child: ChildProcess | undefined
    let timeout: NodeJS.Timeout | undefined
    let terminalError: Error | undefined
    let settled = false
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0

    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      options.signal?.removeEventListener('abort', onAbort)
    }

    const settleRejected = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      rejectPromise(error)
    }

    const settleResolved = (result: CliProcessResult): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolvePromise(result)
    }

    const terminateWith = (error: Error): void => {
      if (terminalError !== undefined || settled) {
        return
      }
      terminalError = error
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      const runningChild = child
      if (runningChild === undefined) {
        settleRejected(error)
        return
      }
      void terminateProcessTree(runningChild)
        .catch(() => {
          error.message = `${error.message} Process-tree termination could not be verified within the bounded fallback window.`
        })
        .then(() => {
          runningChild.stdin?.destroy()
          runningChild.stdout?.destroy()
          runningChild.stderr?.destroy()
          runningChild.unref()
          settleRejected(error)
        })
    }

    const onAbort = (): void => {
      terminateWith(
        new CliAbortedError(
          `CLI execution was aborted. Command: ${commandDisplay}.${outputExcerpt(stdout, stderr, redaction)}`,
        ),
      )
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (isAborted(options.signal)) {
      onAbort()
      return
    }

    try {
      child = spawn(resolved.executable, args, {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error: unknown) {
      settleRejected(
        new CliSpawnError(
          `Failed to spawn ${commandDisplay}: ${truncateRedacted(safeErrorMessage(error), redaction)}`,
          { commandDisplay },
        ),
      )
      return
    }

    const spawnedChild = child
    const onData = (target: Buffer[], chunk: Buffer): void => {
      if (terminalError !== undefined || settled) {
        return
      }
      const remainingBytes = Math.max(0, maxOutputBytes - outputBytes)
      const retainedBytes = Math.min(remainingBytes, chunk.byteLength)
      if (retainedBytes > 0) {
        target.push(copyRetainedOutputPrefix(chunk, retainedBytes))
        outputBytes += retainedBytes
      }
      if (retainedBytes < chunk.byteLength) {
        terminateWith(
          new CliOutputLimitError(
            `CLI output exceeded the ${maxOutputBytes} byte safety limit. Command: ${commandDisplay}.${outputExcerpt(stdout, stderr, redaction)}`,
          ),
        )
      }
    }

    spawnedChild.stdout?.on('data', (chunk: Buffer) => onData(stdout, chunk))
    spawnedChild.stderr?.on('data', (chunk: Buffer) => onData(stderr, chunk))

    timeout = setTimeout(() => {
      terminateWith(
        new CliTimeoutError(
          `CLI execution timed out after ${timeoutMs} ms. Command: ${commandDisplay}.${outputExcerpt(stdout, stderr, redaction)}`,
        ),
      )
    }, timeoutMs)
    timeout.unref()

    spawnedChild.once('error', (error: Error) => {
      if (terminalError !== undefined || settled) {
        return
      }
      settleRejected(
        new CliSpawnError(
          `Failed to spawn ${commandDisplay}: ${truncateRedacted(safeErrorMessage(error), redaction)}`,
          { commandDisplay },
        ),
      )
    })

    spawnedChild.once('close', (code, signal) => {
      if (terminalError !== undefined || settled) {
        return
      }
      const stdoutText = redactText(bufferText(stdout), redaction)
      const stderrText = redactText(bufferText(stderr), redaction)
      if (signal !== null) {
        settleRejected(
          new CliExitError(
            `CLI command terminated by signal ${signal}. Command: ${commandDisplay}.${outputExcerpt(stdout, stderr, redaction)}`,
            {
              signal,
              stdout: stdoutText,
              stderr: stderrText,
              commandDisplay,
            },
          ),
        )
        return
      }
      if (code === null) {
        settleRejected(
          new CliExitError(
            `CLI command terminated without an exit code. Command: ${commandDisplay}.${outputExcerpt(stdout, stderr, redaction)}`,
            {
              stdout: stdoutText,
              stderr: stderrText,
              commandDisplay,
            },
          ),
        )
        return
      }
      if (code !== 0) {
        settleRejected(
          new CliExitError(
            `CLI command exited with code ${code}. Command: ${commandDisplay}.${outputExcerpt(stdout, stderr, redaction)}`,
            {
              exitCode: code,
              stdout: stdoutText,
              stderr: stderrText,
              commandDisplay,
            },
          ),
        )
        return
      }
      settleResolved({
        exitCode: code,
        stdout: stdoutText,
        stderr: stderrText,
        durationMs: Date.now() - startedAt,
        executablePath: redactText(resolved.sourcePath, redaction),
        commandDisplay,
      })
    })

    spawnedChild.stdin?.on('error', () => {
      // Early CLI exit can close stdin before the prompt is fully written. The
      // close/error handlers above retain the authoritative typed failure.
    })
    if (options.input === undefined) {
      spawnedChild.stdin?.end()
    } else {
      spawnedChild.stdin?.end(options.input, 'utf8')
    }
  })
}

export function commandDirectory(commandPath: string): string {
  return dirname(commandPath)
}

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'

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
}

export interface CliProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly executablePath: string
  readonly commandDisplay: string
}

export class ExecutableNotFoundError extends Error {
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
  environment: Readonly<Record<string, string>> | undefined,
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

  const pathValue =
    environment?.PATH ?? environment?.Path ?? process.env.PATH ?? process.env.Path ?? ''
  for (const pathEntry of pathValue.split(delimiter).filter((entry) => entry.length > 0)) {
    for (const candidateName of candidateNames(command)) {
      const candidate = join(pathEntry, candidateName)
      if (await isAccessible(candidate)) {
        return candidate
      }
    }
  }
  throw new ExecutableNotFoundError(command)
}

function windowsPowerShell(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function wrapExecutable(sourcePath: string): ResolvedExecutable {
  if (process.platform !== 'win32') {
    return { executable: sourcePath, prefixArgs: [], sourcePath }
  }

  const extension = extname(sourcePath).toLowerCase()
  if (extension === '.ps1') {
    return {
      executable: windowsPowerShell(),
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
    return {
      executable:
        process.env.ComSpec ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
      prefixArgs: ['/d', '/s', '/c', sourcePath],
      sourcePath,
    }
  }
  return { executable: sourcePath, prefixArgs: [], sourcePath }
}

export async function resolveExecutable(
  command: string,
  cwd: string,
  environment?: Readonly<Record<string, string>>,
): Promise<ResolvedExecutable> {
  return wrapExecutable(await findExecutable(command, cwd, environment))
}

function quoteForDisplay(value: string): string {
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export async function runCliProcess(options: CliProcessOptions): Promise<CliProcessResult> {
  const resolved = await resolveExecutable(options.command, options.cwd, options.environment)
  const args = [...resolved.prefixArgs, ...options.args]
  const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const startedAt = Date.now()

  return new Promise<CliProcessResult>((resolvePromise, rejectPromise) => {
    const child = spawn(resolved.executable, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.environment,
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let terminationError: Error | undefined
    let settled = false

    const finishWithError = (error: Error): void => {
      if (terminationError === undefined) {
        terminationError = error
        child.kill()
      }
    }

    const onData = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength
      if (outputBytes > maxOutputBytes) {
        finishWithError(new Error(`CLI output exceeded the ${maxOutputBytes} byte safety limit.`))
        return
      }
      target.push(chunk)
    }

    child.stdout.on('data', (chunk: Buffer) => onData(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => onData(stderr, chunk))

    const timeout = setTimeout(() => {
      finishWithError(abortError(`CLI execution timed out after ${timeoutMs} ms.`))
    }, timeoutMs)
    timeout.unref()

    const onAbort = (): void => {
      finishWithError(abortError('CLI execution was aborted.'))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.once('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
        rejectPromise(error)
      }
    })

    child.once('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      if (terminationError !== undefined) {
        rejectPromise(terminationError)
        return
      }
      resolvePromise({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: Date.now() - startedAt,
        executablePath: resolved.sourcePath,
        commandDisplay: [resolved.sourcePath, ...options.args].map(quoteForDisplay).join(' '),
      })
    })

    if (options.input === undefined) {
      child.stdin.end()
    } else {
      child.stdin.end(options.input, 'utf8')
    }
  })
}

export function commandDirectory(commandPath: string): string {
  return dirname(commandPath)
}

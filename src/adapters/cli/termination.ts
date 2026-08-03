import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'

const DEFAULT_GRACE_MS = 1_000
const POLL_INTERVAL_MS = 25

export interface WindowsTerminationHelperResult {
  readonly exitCode: number | null
  readonly pids?: readonly number[]
  readonly failures?: readonly string[]
}

export interface WindowsTerminationHelper {
  readonly completion: Promise<WindowsTerminationHelperResult>
  readonly terminate: () => void
  readonly unref: () => void
}

export interface WindowsTerminationDependencies {
  readonly startSnapshot: (pid: number) => WindowsTerminationHelper
  readonly startTaskkill: (pid: number) => WindowsTerminationHelper
  readonly startFallback: (pids: readonly number[]) => WindowsTerminationHelper
  readonly processExists: (pid: number) => boolean
  readonly forceKill: (pid: number) => void
}

interface HelperOutcome {
  readonly result?: WindowsTerminationHelperResult
  readonly failure?: string
  readonly timedOut: boolean
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds)
  })
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
  }
}

async function waitForProcessGroupExit(pid: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) {
      return true
    }
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())))
  }
  return !processGroupExists(pid)
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

async function terminatePosixProcessTree(child: ChildProcess, graceMs: number): Promise<void> {
  const pid = child.pid
  if (pid === undefined) {
    return
  }

  const signalledGroup = signalProcessGroup(pid, 'SIGTERM')
  if (!signalledGroup) {
    try {
      if (!child.kill('SIGTERM')) {
        return
      }
    } catch {
      return
    }
  }

  const exited = signalledGroup
    ? await waitForProcessGroupExit(pid, graceMs)
    : await Promise.race([
        new Promise<boolean>((resolvePromise) => {
          child.once('exit', () => resolvePromise(true))
        }),
        delay(graceMs).then(() => false),
      ])
  if (exited) {
    return
  }

  if (signalledGroup) {
    signalProcessGroup(pid, 'SIGKILL')
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // The process exited between the bounded wait and escalation.
  }
}

function windowsProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
  }
}

function safeHelperFailure(error: unknown): string {
  try {
    if (error instanceof Error && error.message.length > 0) {
      return error.message
    }
  } catch {
    // Hostile helper errors are reduced to a fixed diagnostic.
  }
  return 'helper execution failed'
}

function parsePowerShellResult(
  stdout: string,
  exitCode: number | null,
): WindowsTerminationHelperResult {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('PowerShell helper output was not an object.')
    }
    const record = parsed as Readonly<Record<string, unknown>>
    const rawPids = record.pids
    const rawFailures = record.failures
    if (
      !Array.isArray(rawPids) ||
      rawPids.some((pid) => typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) ||
      !Array.isArray(rawFailures) ||
      rawFailures.some((failure) => typeof failure !== 'string')
    ) {
      throw new TypeError('PowerShell helper output fields were malformed.')
    }
    return {
      exitCode,
      pids: rawPids as readonly number[],
      failures: rawFailures as readonly string[],
    }
  } catch (error: unknown) {
    return {
      exitCode: exitCode === 0 ? 1 : exitCode,
      failures: [`PowerShell helper output could not be parsed: ${safeHelperFailure(error)}`],
    }
  }
}

function startWindowsHelper(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
  parseResult?: (stdout: string, exitCode: number | null) => WindowsTerminationHelperResult,
): WindowsTerminationHelper {
  let helper: ChildProcess
  try {
    helper = spawn(command, args, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (error: unknown) {
    return {
      completion: Promise.reject(error),
      terminate: () => {},
      unref: () => {},
    }
  }

  let stdout = ''
  helper.stdout?.setEncoding('utf8')
  helper.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })

  return {
    completion: new Promise<WindowsTerminationHelperResult>((resolvePromise, rejectPromise) => {
      helper.once('error', rejectPromise)
      helper.once('close', (exitCode) => {
        resolvePromise(
          parseResult?.(stdout, exitCode) ?? {
            exitCode,
          },
        )
      })
    }),
    terminate: () => {
      try {
        helper.kill('SIGKILL')
      } catch {
        // The helper already exited.
      }
    },
    unref: () => {
      helper.stdin?.destroy()
      helper.stdout?.destroy()
      helper.stderr?.destroy()
      helper.unref()
    },
  }
}

function defaultWindowsTerminationDependencies(): WindowsTerminationDependencies {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
  const environment = {
    SystemRoot: systemRoot,
    SYSTEMROOT: systemRoot,
    WINDIR: process.env.WINDIR ?? systemRoot,
  } as const
  const taskkillPath = join(systemRoot, 'System32', 'taskkill.exe')
  const powershellPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

  return {
    startSnapshot: (pid) => {
      const script = [
        "$ErrorActionPreference='Stop'",
        '$script:rolekitPids=New-Object System.Collections.Generic.List[int]',
        '$script:rolekitFailures=New-Object System.Collections.Generic.List[string]',
        'function Get-RoleKitDescendants([int]$ParentId) {',
        'try { $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" -ErrorAction Stop) }',
        'catch { $script:rolekitFailures.Add(("enumeration failed for parent {0}: {1}" -f $ParentId,$_.Exception.Message)); return }',
        'foreach ($child in $children) { $script:rolekitPids.Add([int]$child.ProcessId); Get-RoleKitDescendants ([int]$child.ProcessId) }',
        '}',
        `Get-RoleKitDescendants ${pid}`,
        '$result=[ordered]@{pids=@($script:rolekitPids);failures=@($script:rolekitFailures)}',
        '$result | ConvertTo-Json -Compress',
        'if ($script:rolekitFailures.Count -gt 0) { exit 1 }',
      ].join('\n')
      return startWindowsHelper(
        powershellPath,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        environment,
        parsePowerShellResult,
      )
    },
    startTaskkill: (pid) =>
      startWindowsHelper(taskkillPath, ['/PID', String(pid), '/T', '/F'], environment),
    startFallback: (pids) => {
      const pidList = pids.join(',')
      const script = [
        "$ErrorActionPreference='Continue'",
        `$targets=@(${pidList})`,
        '[array]::Reverse($targets)',
        '$failures=New-Object System.Collections.Generic.List[string]',
        'foreach ($target in $targets) {',
        'try { Stop-Process -Id ([int]$target) -Force -ErrorAction Stop }',
        'catch { if (Get-Process -Id ([int]$target) -ErrorAction SilentlyContinue) { $failures.Add(("kill failed for pid {0}: {1}" -f $target,$_.Exception.Message)) } }',
        '}',
        '$result=[ordered]@{pids=@($targets);failures=@($failures)}',
        '$result | ConvertTo-Json -Compress',
        'if ($failures.Count -gt 0) { exit 1 }',
      ].join('\n')
      return startWindowsHelper(
        powershellPath,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        environment,
        parsePowerShellResult,
      )
    },
    processExists: windowsProcessExists,
    forceKill: (pid) => {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // The process already exited or final escalation was denied.
      }
    },
  }
}

async function runHelperUntilDeadline(
  start: () => WindowsTerminationHelper,
  deadline: number,
): Promise<HelperOutcome> {
  let helper: WindowsTerminationHelper
  try {
    helper = start()
  } catch (error: unknown) {
    return { failure: safeHelperFailure(error), timedOut: false }
  }

  const remainingMs = Math.max(0, deadline - Date.now())
  if (remainingMs === 0) {
    helper.terminate()
    helper.unref()
    void helper.completion.catch(() => undefined)
    return { timedOut: true }
  }

  let timeout: NodeJS.Timeout | undefined
  const outcome = await Promise.race([
    helper.completion.then<HelperOutcome, HelperOutcome>(
      (result) => ({ result, timedOut: false }),
      (error: unknown) => ({ failure: safeHelperFailure(error), timedOut: false }),
    ),
    new Promise<HelperOutcome>((resolvePromise) => {
      timeout = setTimeout(() => resolvePromise({ timedOut: true }), remainingMs)
      timeout.unref()
    }),
  ])
  if (timeout !== undefined) {
    clearTimeout(timeout)
  }
  if (outcome.timedOut) {
    helper.terminate()
    helper.unref()
    void helper.completion.catch(() => undefined)
  }
  return outcome
}

function uniquePids(pids: readonly number[]): readonly number[] {
  return [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))]
}

function survivingWindowsPids(
  pids: readonly number[],
  processExists: (pid: number) => boolean,
): readonly number[] {
  return pids.filter((pid) => processExists(pid))
}

async function waitForWindowsPidsExit(
  pids: readonly number[],
  deadline: number,
  processExists: (pid: number) => boolean,
): Promise<readonly number[]> {
  let survivors = survivingWindowsPids(pids, processExists)
  while (survivors.length > 0 && Date.now() < deadline) {
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())))
    survivors = survivingWindowsPids(pids, processExists)
  }
  return survivors
}

function helperFailures(stage: string, outcome: HelperOutcome): readonly string[] {
  if (outcome.timedOut) {
    return [`${stage} helper exceeded the total termination deadline`]
  }
  if (outcome.failure !== undefined) {
    return [`${stage} helper failed: ${outcome.failure}`]
  }
  const result = outcome.result
  if (result === undefined) {
    return [`${stage} helper did not return a result`]
  }
  const failures = [...(result.failures ?? [])]
  if (result.exitCode !== 0 && failures.length === 0) {
    failures.push(`${stage} helper exited with code ${String(result.exitCode)}`)
  }
  return failures
}

export async function terminateWindowsProcessTree(
  child: Pick<ChildProcess, 'pid'>,
  graceMs: number,
  dependencies: WindowsTerminationDependencies = defaultWindowsTerminationDependencies(),
): Promise<void> {
  const pid = child.pid
  if (pid === undefined) {
    return
  }

  const deadline = Date.now() + Math.max(0, graceMs)
  const snapshot = await runHelperUntilDeadline(() => dependencies.startSnapshot(pid), deadline)
  const snapshotFailures = helperFailures('Windows descendant enumeration', snapshot)
  const capturedPids = uniquePids([pid, ...(snapshot.result?.pids ?? [])])

  const taskkill = await runHelperUntilDeadline(() => dependencies.startTaskkill(pid), deadline)
  const taskkillFailures = helperFailures('Windows tree-aware taskkill', taskkill)
  const taskkillSucceeded =
    taskkillFailures.length === 0 &&
    taskkill.result?.exitCode === 0 &&
    !taskkill.timedOut &&
    taskkill.failure === undefined
  if (snapshotFailures.length === 0 && taskkillSucceeded) {
    const survivors = survivingWindowsPids(capturedPids, dependencies.processExists)
    if (survivors.length === 0) {
      return
    }
  }

  const fallback = await runHelperUntilDeadline(
    () => dependencies.startFallback(capturedPids),
    deadline,
  )
  const fallbackFailures = helperFailures('Windows fallback kill', fallback)
  const survivors = await waitForWindowsPidsExit(capturedPids, deadline, dependencies.processExists)

  for (const survivingPid of survivors) {
    dependencies.forceKill(survivingPid)
  }
  const finalSurvivors = survivingWindowsPids(capturedPids, dependencies.processExists)
  const diagnostics = [
    ...snapshotFailures,
    ...taskkillFailures,
    ...fallbackFailures,
    'tree-aware taskkill did not establish race-free containment; explicit-PID fallback cleanup is unverified',
    ...(survivors.length === 0
      ? []
      : [`verification found surviving parent/descendant PIDs: ${survivors.join(', ')}`]),
    ...(finalSurvivors.length === 0
      ? []
      : [`final force-kill verification still found PIDs: ${finalSurvivors.join(', ')}`]),
  ]
  if (diagnostics.length === 0) {
    diagnostics.push('whole-tree verification failed before the total termination deadline')
  }
  throw new Error(
    `Windows process-tree termination could not be verified: ${diagnostics.join('; ')}.`,
  )
}

export async function terminateProcessTree(
  child: ChildProcess,
  options: { readonly graceMs?: number } = {},
): Promise<void> {
  const graceMs = Math.max(0, options.graceMs ?? DEFAULT_GRACE_MS)
  if (process.platform === 'win32') {
    await terminateWindowsProcessTree(child, graceMs)
    return
  }
  await terminatePosixProcessTree(child, graceMs)
}

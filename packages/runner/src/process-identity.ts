import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { canonicalize, sha256Text } from './canonical-json.ts'
import type { ProcessIdentity } from './types.ts'

const execFileAsync = promisify(execFile)
const START_TIME_TOLERANCE_MS = 2_000

/** Hashes the exact argv used to create a process. */
export function commandSha256(argv: string[]): string {
  return sha256Text(canonicalize(argv))
}

/** Captures PID, OS creation time and the caller-supplied exact argv digest. */
export async function captureProcessIdentity(
  pid: number,
  argv: string[],
): Promise<ProcessIdentity> {
  const startTime = await processStartTimeUtc(pid)
  if (!startTime) {
    throw new Error(`process ${pid} is not live`)
  }
  return { pid, start_time_utc: startTime, command_sha256: commandSha256(argv) }
}

/** PID reuse-safe liveness check. */
export async function isProcessIdentityLive(identity: ProcessIdentity): Promise<boolean> {
  const actual = await processStartTimeUtc(identity.pid)
  return actual !== null && sameStartTime(actual, identity.start_time_utc)
}

/** Kills only the process tree whose PID and OS creation time still match. */
export async function killProcessIdentityTree(
  identity: ProcessIdentity,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (!(await isProcessIdentityLive(identity))) return true

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const child = spawn('taskkill', ['/pid', String(identity.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', () => resolve())
      child.once('exit', () => resolve())
    })
  } else {
    for (const pid of (await descendantPids(identity.pid)).reverse()) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
    try {
      process.kill(identity.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isProcessIdentityLive(identity))) return true
    await sleep(25)
  }

  if (process.platform !== 'win32' && (await isProcessIdentityLive(identity))) {
    try {
      process.kill(identity.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  return !(await isProcessIdentityLive(identity))
}

async function processStartTimeUtc(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
  } catch {
    return null
  }

  try {
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
      const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      const { stdout } = await execFileAsync(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 2_000 },
      )
      const value = stdout.trim()
      return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
    }

    if (process.platform === 'linux') {
      const [stat, uptimeText] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile('/proc/uptime', 'utf8'),
      ])
      const close = stat.lastIndexOf(')')
      const fields = stat
        .slice(close + 2)
        .trim()
        .split(/\s+/)
      const startTicks = Number(fields[19])
      const uptimeSeconds = Number(uptimeText.split(/\s+/)[0])
      if (!Number.isFinite(startTicks) || !Number.isFinite(uptimeSeconds)) return null
      const ticksPerSecond = 100
      const bootMs = Date.now() - uptimeSeconds * 1_000
      return new Date(bootMs + (startTicks / ticksPerSecond) * 1_000).toISOString()
    }

    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000,
    })
    const parsed = Date.parse(stdout.trim())
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  } catch {
    return null
  }
}

async function descendantPids(rootPid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid='], {
      encoding: 'utf8',
      timeout: 2_000,
    })
    const children = new Map<number, number[]>()
    for (const line of stdout.split(/\r?\n/)) {
      const [pidText, parentText] = line.trim().split(/\s+/)
      const pid = Number(pidText)
      const parent = Number(parentText)
      if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) continue
      const entries = children.get(parent) ?? []
      entries.push(pid)
      children.set(parent, entries)
    }
    const found: number[] = []
    const visit = (pid: number) => {
      for (const child of children.get(pid) ?? []) {
        found.push(child)
        visit(child)
      }
    }
    visit(rootPid)
    return found
  } catch {
    return []
  }
}

function sameStartTime(left: string, right: string): boolean {
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= START_TIME_TOLERANCE_MS
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

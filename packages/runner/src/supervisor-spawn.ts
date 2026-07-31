import { spawn } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonIfExists } from './fs-util.ts'
import { acquireLock } from './lock.ts'
import { isProcessIdentityLive } from './process-identity.ts'
import type { ProcessIdentity } from './types.ts'

/**
 * Spawns the RunSupervisor process for a run. Returns ok:false on failure.
 */
export async function spawnSupervisor(
  projectRoot: string,
  runId: string,
): Promise<{ ok: true; pid: number } | { ok: false; error: string }> {
  const dir = join(projectRoot, '.rolekit', 'runs', runId)
  const lockPath = join(dir, '.supervisor.lock')
  let lock: Awaited<ReturnType<typeof acquireLock>> | null = null
  try {
    // parent briefly holds to serialize spawn; supervisor re-acquires for lifetime
    lock = await acquireLock(lockPath, { retries: 40, delayMs: 50 })
  } catch {
    // another supervisor may be starting
    const existing = await readJsonIfExists<Partial<ProcessIdentity>>(
      join(dir, 'artifacts', 'supervisor.json'),
    )
    if (existing?.pid && (await acknowledgementIsLive(existing))) {
      return { ok: true, pid: existing.pid }
    }
    if (!(await clearStaleSupervisorLock(lockPath))) {
      return { ok: false, error: 'supervisor lifecycle lock owner is still live' }
    }
    try {
      lock = await acquireLock(lockPath, { retries: 40, delayMs: 50 })
    } catch {
      return { ok: false, error: 'supervisor lifecycle lock remained busy' }
    }
  }

  const supervisorEntry = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'bin',
    'supervisor.js',
  )

  try {
    if (lock) {
      await lock.release()
    }
    const child = spawn(process.execPath, [supervisorEntry, projectRoot, runId], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    })
    child.unref()
    if (!child.pid) {
      return { ok: false, error: 'supervisor spawn produced no pid' }
    }

    // wait for ack
    const start = Date.now()
    while (Date.now() - start < 10_000) {
      const ack = await readJsonIfExists<Partial<ProcessIdentity> & { run_id?: string }>(
        join(dir, 'artifacts', 'supervisor.json'),
      )
      if (ack?.run_id === runId && ack.pid) {
        if (await acknowledgementIsLive(ack)) return { ok: true, pid: ack.pid }
        const state = await readJsonIfExists<{ phase?: string }>(join(dir, 'run-state.json'))
        if (state?.phase && state.phase !== 'prepared' && state.phase !== 'starting') {
          // A short executor may finish and release the owner before the spawning caller observes ack.
          return { ok: true, pid: ack.pid }
        }
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    return { ok: false, error: 'supervisor ack timeout' }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'supervisor spawn failed',
    }
  }
}

async function clearStaleSupervisorLock(lockPath: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(lockPath, 'utf8')).trim())
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        // stale owner
      }
    }
    await unlink(lockPath)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

async function acknowledgementIsLive(ack: Partial<ProcessIdentity>): Promise<boolean> {
  if (!ack.pid) return false
  if (ack.start_time_utc && ack.command_sha256) {
    return isProcessIdentityLive(ack as ProcessIdentity)
  }
  try {
    process.kill(ack.pid, 0)
    return true
  } catch {
    return false
  }
}

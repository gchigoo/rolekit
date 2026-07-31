import { createHash, randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { RunManagerError } from './errors.ts'
import { ensureDir, readJsonIfExists, runsRoot, writeJsonAtomic } from './fs-util.ts'
import { withLock } from './lock.ts'
import type { ReservationRecord } from './types.ts'

/**
 * SHA-256 hex of task.id for index directory name.
 */
export function taskIndexHash(taskId: string): string {
  return createHash('sha256').update(taskId, 'utf8').digest('hex')
}

function indexDir(projectRoot: string, taskId: string): string {
  return join(runsRoot(projectRoot), '.index', taskIndexHash(taskId))
}

function attemptPath(projectRoot: string, taskId: string, attempt: number): string {
  return join(indexDir(projectRoot, taskId), `attempt-${attempt}.json`)
}

/**
 * Lists reservations for a task sorted by attempt ascending.
 */
export async function listReservations(
  projectRoot: string,
  taskId: string,
): Promise<ReservationRecord[]> {
  const dir = indexDir(projectRoot, taskId)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const records: ReservationRecord[] = []
  for (const name of names) {
    if (!/^attempt-\d+\.json$/.test(name)) {
      continue
    }
    const rec = await readJsonIfExists<ReservationRecord>(join(dir, name))
    if (rec && rec.task_id === taskId) {
      records.push(rec)
    }
  }
  return records.sort((a, b) => a.attempt - b.attempt)
}

/**
 * Reads one reservation.
 */
export async function getReservation(
  projectRoot: string,
  taskId: string,
  attempt: number,
): Promise<ReservationRecord | null> {
  return readJsonIfExists<ReservationRecord>(attemptPath(projectRoot, taskId, attempt))
}

/**
 * Atomically writes a reservation under task index lock.
 */
export async function writeReservation(
  projectRoot: string,
  record: ReservationRecord,
): Promise<void> {
  const dir = indexDir(projectRoot, record.task_id)
  await ensureDir(dir)
  await withLock(join(dir, '.lock'), async () => {
    const existing = await readJsonIfExists<ReservationRecord>(
      attemptPath(projectRoot, record.task_id, record.attempt),
    )
    if (existing && existing.task_id !== record.task_id) {
      throw new RunManagerError('run_state_inconsistent', 'reservation task_id mismatch')
    }
    await writeJsonAtomic(attemptPath(projectRoot, record.task_id, record.attempt), record)
  })
}

/**
 * Updates abort_requested flag.
 */
export async function markAbortRequested(
  projectRoot: string,
  taskId: string,
  attempt: number,
): Promise<void> {
  await withLock(join(indexDir(projectRoot, taskId), '.lock'), async () => {
    const existing = await getReservation(projectRoot, taskId, attempt)
    if (!existing) {
      return
    }
    await writeJsonAtomic(attemptPath(projectRoot, taskId, attempt), {
      ...existing,
      abort_requested: true,
    })
  })
}

/**
 * Removes a reservation record (successful abort cleanup).
 */
export async function removeReservation(
  projectRoot: string,
  taskId: string,
  attempt: number,
): Promise<void> {
  const { unlink } = await import('node:fs/promises')
  await withLock(join(indexDir(projectRoot, taskId), '.lock'), async () => {
    await unlink(attemptPath(projectRoot, taskId, attempt)).catch(() => undefined)
  })
}

/**
 * Allocates a unique run-id under allocation lock.
 */
export async function allocateRunId(projectRoot: string): Promise<string> {
  await ensureDir(runsRoot(projectRoot))
  return withLock(join(runsRoot(projectRoot), '.allocation.lock'), async () => {
    for (let i = 0; i < 8; i += 1) {
      const id = formatRunId()
      const exists = await readJsonIfExists(join(runsRoot(projectRoot), id, 'run-state.json'))
      if (!exists) {
        return id
      }
    }
    throw new RunManagerError('run_state_inconsistent', 'run-id allocation exhausted')
  })
}

function formatRunId(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const mi = String(now.getUTCMinutes()).padStart(2, '0')
  const s = String(now.getUTCSeconds()).padStart(2, '0')
  const hex = randomBytes(2).toString('hex')
  return `run-${y}${mo}${d}-${h}${mi}${s}-${hex}`
}

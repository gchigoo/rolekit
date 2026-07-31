import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Atomically writes JSON (temp + rename).
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await renameWithTransientRetry(tmp, path)
}

/**
 * Writes text atomically.
 */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, text, 'utf8')
  await renameWithTransientRetry(tmp, path)
}

/**
 * Reads JSON file or returns null if missing.
 */
export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, 'utf8')
    return JSON.parse(text) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Reads text or returns null if missing.
 */
export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Appends one JSONL event line (LF only).
 */
export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

/**
 * Ensures a directory exists.
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

/**
 * Removes a path recursively, ignoring ENOENT.
 */
export async function rmSafe(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

/**
 * Project-relative path helpers under .rolekit.
 */
export function rolekitRoot(projectRoot: string): string {
  return join(projectRoot, '.rolekit')
}

export function runsRoot(projectRoot: string): string {
  return join(rolekitRoot(projectRoot), 'runs')
}

export function runDir(projectRoot: string, runId: string): string {
  return join(runsRoot(projectRoot), runId)
}

export function worktreesRoot(projectRoot: string): string {
  return join(rolekitRoot(projectRoot), 'worktrees')
}

async function renameWithTransientRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 9 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

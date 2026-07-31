import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface FileLock {
  release(): Promise<void>
}

/**
 * Acquires an exclusive lock file with busy-wait retries (Windows-safe).
 */
export async function acquireLock(
  lockPath: string,
  options: { retries?: number; delayMs?: number } = {},
): Promise<FileLock> {
  const retries = options.retries ?? 200
  const delayMs = options.delayMs ?? 25
  await mkdir(dirname(lockPath), { recursive: true })
  for (let i = 0; i < retries; i += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(String(process.pid), 'utf8')
      return {
        async release() {
          await handle.close().catch(() => undefined)
          await unlink(lockPath).catch(() => undefined)
        },
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') {
        throw error
      }
      await sleep(delayMs)
    }
  }
  throw new Error(`Failed to acquire lock: ${lockPath}`)
}

/**
 * Runs fn under an exclusive lock.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: { retries?: number; delayMs?: number },
): Promise<T> {
  const lock = await acquireLock(lockPath, options)
  try {
    return await fn()
  } finally {
    await lock.release()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

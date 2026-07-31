/**
 * Sibling migrate lock (wx + pid/ts; stale clear once / retry once).
 */

import { open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { MigrationError } from './types.ts'

export interface MigrateLock {
  release(): Promise<void>
}

/**
 * Acquires `<target>/.rolekit-migrate.lock` with one stale-clear retry.
 */
export async function acquireMigrateLock(targetRoot: string): Promise<MigrateLock> {
  const lockPath = join(targetRoot, '.rolekit-migrate.lock')
  try {
    return await tryLock(lockPath)
  } catch (error) {
    if (!(error instanceof MigrationError) || error.code !== 'migration_lock_held') {
      throw error
    }
    const cleared = await clearStale(lockPath)
    if (!cleared) throw error
    return tryLock(lockPath)
  }
}

async function tryLock(lockPath: string): Promise<MigrateLock> {
  try {
    const handle = await open(lockPath, 'wx')
    const payload = `${process.pid}\n${Date.now()}\n`
    await handle.writeFile(payload, 'utf8')
    return {
      async release() {
        await handle.close().catch(() => undefined)
        await unlink(lockPath).catch(() => undefined)
      },
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new MigrationError('migration_lock_held', {
        detail: {
          code: 'migration_lock_held',
          message_code: 'migration_lock_held',
          refs: ['.rolekit-migrate.lock'],
        },
      })
    }
    throw new MigrationError('migration_io_failed', {
      detail: {
        code: 'migration_io_failed',
        message_code: 'migration_io_failed',
        refs: ['.rolekit-migrate.lock'],
      },
    })
  }
}

async function clearStale(lockPath: string): Promise<boolean> {
  try {
    const text = await readFile(lockPath, 'utf8')
    const pid = Number(text.split('\n')[0])
    if (!Number.isFinite(pid) || pid <= 0) {
      await unlink(lockPath)
      return true
    }
    try {
      process.kill(pid, 0)
      return false
    } catch {
      await unlink(lockPath)
      return true
    }
  } catch {
    return false
  }
}

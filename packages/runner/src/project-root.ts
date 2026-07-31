import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Walks upward from start until a directory containing .rolekit is found.
 */
export async function findProjectRoot(start: string): Promise<string> {
  let current = resolve(start)
  for (;;) {
    try {
      await access(join(current, '.rolekit'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) {
        throw new Error(`No .rolekit directory found from ${start}`)
      }
      current = parent
    }
  }
}

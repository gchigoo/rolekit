import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { RolekitError } from '@rolekit/core'

/**
 * Resolves project root containing .rolekit from cwd.
 */
export async function findProjectRootSafe(start: string): Promise<string> {
  let current = resolve(start)
  for (;;) {
    try {
      await access(join(current, '.rolekit'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) {
        throw new RolekitError(`No .rolekit directory from ${start}`, 'project_not_found')
      }
      current = parent
    }
  }
}

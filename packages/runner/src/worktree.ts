import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ensureDir, worktreesRoot, writeJsonAtomic } from './fs-util.ts'
import type { BaselineEntry, BaselineSnapshot } from './types.ts'

const execFileAsync = promisify(execFile)

/**
 * Manages isolated git worktrees and baseline snapshots.
 */
export class WorktreeManager {
  projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  worktreePath(runId: string): string {
    return join(worktreesRoot(this.projectRoot), runId)
  }

  /**
   * Creates an isolated worktree at .rolekit/worktrees/{run-id}.
   */
  async create(runId: string): Promise<string> {
    const path = this.worktreePath(runId)
    await ensureDir(worktreesRoot(this.projectRoot))
    // worktree path may already exist from crash recovery (.git is a gitdir text file, not JSON)
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: path,
        encoding: 'utf8',
      })
      return path
    } catch {
      // create new
    }
    const branch = `rolekit/${runId}`
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, path, 'HEAD'], {
        cwd: this.projectRoot,
        encoding: 'utf8',
      })
    } catch (error) {
      // branch may already exist from partial create
      await execFileAsync('git', ['worktree', 'add', path, branch], {
        cwd: this.projectRoot,
        encoding: 'utf8',
      }).catch(async () => {
        throw error
      })
    }
    return path
  }

  /**
   * Removes worktree; returns orphan:true if removal fails.
   */
  async remove(runId: string): Promise<{ orphan: boolean }> {
    const path = this.worktreePath(runId)
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', path], {
        cwd: this.projectRoot,
        encoding: 'utf8',
      })
      await execFileAsync('git', ['branch', '-D', `rolekit/${runId}`], {
        cwd: this.projectRoot,
        encoding: 'utf8',
      }).catch(() => undefined)
      return { orphan: false }
    } catch {
      return { orphan: true }
    }
  }

  /**
   * Captures immutable baseline of the primary working tree.
   */
  async captureBaseline(): Promise<BaselineSnapshot> {
    const head = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: this.projectRoot,
        encoding: 'utf8',
      })
    ).stdout.trim()

    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: this.projectRoot,
      encoding: 'buffer',
    })
    const entries = parsePorcelainZ(stdout)
    entries.sort((a, b) => a.path.localeCompare(b.path))

    let warning: string | undefined
    const status: BaselineEntry[] = []
    if (entries.length > 100) {
      warning = 'dirty file count >100; digest omitted'
      for (const e of entries) {
        status.push({ code: e.code, path: e.path })
      }
    } else {
      for (const e of entries) {
        const item: BaselineEntry = { code: e.code, path: e.path }
        if (!e.code.startsWith('D') && e.code !== ' D') {
          try {
            const buf = await readFile(join(this.projectRoot, e.path))
            item.digest = createHash('sha256').update(buf).digest('hex')
            item.mode = '100644'
          } catch {
            // skip unreadable
          }
        }
        status.push(item)
      }
    }

    return {
      head,
      status,
      captured_at: new Date().toISOString(),
      warning,
    }
  }

  /**
   * Writes baseline.json once.
   */
  async writeBaseline(runDirectory: string, baseline: BaselineSnapshot): Promise<void> {
    await writeJsonAtomic(join(runDirectory, 'baseline.json'), baseline)
  }

  /**
   * Compares current primary tree to baseline; returns concurrent-change violations.
   */
  async diffBaseline(baseline: BaselineSnapshot): Promise<string[]> {
    const current = await this.captureBaseline()
    const violations: string[] = []
    if (current.head !== baseline.head) {
      violations.push(`concurrent-change: HEAD moved ${baseline.head} -> ${current.head}`)
    }
    const prev = new Map(baseline.status.map((s) => [s.path, s]))
    const next = new Map(current.status.map((s) => [s.path, s]))
    for (const [path, entry] of next) {
      const before = prev.get(path)
      if (!before) {
        violations.push(`concurrent-change: added ${path}`)
        continue
      }
      if (before.code !== entry.code || before.digest !== entry.digest) {
        violations.push(`concurrent-change: modified ${path}`)
      }
    }
    for (const path of prev.keys()) {
      if (!next.has(path)) {
        violations.push(`concurrent-change: removed ${path}`)
      }
    }
    return violations
  }
}

function parsePorcelainZ(buf: Buffer): Array<{ code: string; path: string }> {
  const text = buf.toString('utf8')
  const parts = text.split('\0').filter(Boolean)
  const out: Array<{ code: string; path: string }> = []
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!
    if (part.length < 3) {
      continue
    }
    const code = part.slice(0, 2)
    let path = part.slice(3)
    // rename records include extra path
    if (code.startsWith('R') || code.startsWith('C')) {
      i += 1
      path = parts[i] ?? path
    }
    out.push({ code, path })
  }
  return out
}

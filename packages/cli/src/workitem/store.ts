import { createHash } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateArtifact, type WorkItem } from '@rolekit/core'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { WorkItemCliError } from './errors.ts'

export interface StoredWorkItem {
  item: WorkItem
  revision: string
  path: string
}

interface LockHandle {
  release(): Promise<void>
}

/**
 * Work-item store: global file lock, YAML read/write with atomic replace.
 */
export class WorkItemStore {
  readonly projectRoot: string
  readonly dir: string
  readonly lockPath: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.dir = join(projectRoot, '.rolekit', 'work-items')
    this.lockPath = join(this.dir, '.lock')
  }

  /** Acquire D6 lock (wx + stale pid cleanup once). */
  async acquireLock(): Promise<LockHandle> {
    await mkdir(this.dir, { recursive: true })
    try {
      return await this.tryLock()
    } catch (error) {
      if (!(error instanceof WorkItemCliError) || error.code !== 'lock_held') {
        throw error
      }
      const stale = await this.clearStaleLock()
      if (!stale) {
        throw error
      }
      return this.tryLock()
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = await this.acquireLock()
    try {
      return await fn()
    } finally {
      await lock.release()
    }
  }

  /** List all work items (unlocked read of finalized files). */
  async listAll(): Promise<WorkItem[]> {
    await mkdir(this.dir, { recursive: true })
    const names = await readdir(this.dir)
    const items: WorkItem[] = []
    for (const name of names) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue
      const stored = await this.readByPath(join(this.dir, name))
      if (stored) items.push(stored.item)
    }
    return items
  }

  async read(id: string): Promise<StoredWorkItem> {
    const path = join(this.dir, `${id}.yaml`)
    const stored = await this.readByPath(path)
    if (!stored) {
      throw new WorkItemCliError('workitem_not_found', { id, exitCode: 1 })
    }
    return stored
  }

  /**
   * Validate + atomic write. Caller must hold lock for mutating commands.
   */
  async write(item: WorkItem, expectedRevision?: string): Promise<StoredWorkItem> {
    await mkdir(this.dir, { recursive: true })
    const path = join(this.dir, `${item.id}.yaml`)
    if (expectedRevision !== undefined) {
      const current = await this.readByPath(path)
      if (!current) {
        throw new WorkItemCliError('workitem_changed', {
          id: item.id,
          detail: 'missing during cas',
        })
      }
      if (current.revision !== expectedRevision) {
        throw new WorkItemCliError('workitem_changed', { id: item.id })
      }
    }
    const result = validateArtifact('rolekit/work-item@1', item)
    if (!result.valid) {
      throw new WorkItemCliError('invalid_workitem', {
        id: item.id,
        detail: result.issues.map((i) => i.message).join('; '),
      })
    }
    const text = stringifyYaml(item)
    const tmp = join(this.dir, `.${item.id}.${process.pid}.tmp.yaml`)
    try {
      await writeFile(tmp, text, 'utf8')
      const again = validateArtifact('rolekit/work-item@1', parseYaml(await readFile(tmp, 'utf8')))
      if (!again.valid) {
        throw new WorkItemCliError('invalid_workitem', { id: item.id })
      }
      await rename(tmp, path)
    } catch (error) {
      await unlink(tmp).catch(() => undefined)
      throw error
    }
    return { item, revision: sha(text), path }
  }

  /**
   * Allocate WI-YYYYMMDD-NNN inside lock; validate depends_on; write planned item.
   */
  async create(input: {
    kind: WorkItem['kind']
    title: string
    depends_on: string[]
  }): Promise<WorkItem> {
    return this.withLock(async () => {
      const existing = await this.listAll()
      const byId = new Map(existing.map((i) => [i.id, i]))
      for (const dep of input.depends_on) {
        if (!byId.has(dep)) {
          throw new WorkItemCliError('dependency_not_found', {
            detail: dep,
            exitCode: 1,
          })
        }
      }
      const id = allocateId(existing)
      const now = new Date().toISOString()
      const item: WorkItem = {
        schema: 'rolekit/work-item@1',
        id,
        kind: input.kind,
        title: input.title,
        status: 'planned',
        gate: null,
        gate_log: [],
        lane: null,
        lane_reason: null,
        lane_overrides: [],
        depends_on: input.depends_on,
        runs: [],
        created: now,
        updated: now,
      }
      await this.write(item)
      return item
    })
  }

  private async tryLock(): Promise<LockHandle> {
    const lockPath = this.lockPath
    try {
      const handle = await open(lockPath, 'wx')
      const body = `${process.pid}\n${new Date().toISOString()}\n`
      await handle.writeFile(body, 'utf8')
      return {
        async release() {
          await handle.close().catch(() => undefined)
          await unlink(lockPath).catch(() => undefined)
        },
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        throw new WorkItemCliError('lock_held', { exitCode: 1 })
      }
      throw error
    }
  }

  private async clearStaleLock(): Promise<boolean> {
    try {
      const text = await readFile(this.lockPath, 'utf8')
      const pid = Number.parseInt(text.split(/\r?\n/)[0] ?? '', 10)
      if (!Number.isFinite(pid)) {
        await unlink(this.lockPath).catch(() => undefined)
        return true
      }
      try {
        process.kill(pid, 0)
        return false
      } catch {
        await unlink(this.lockPath).catch(() => undefined)
        return true
      }
    } catch {
      return false
    }
  }

  private async readByPath(path: string): Promise<StoredWorkItem | null> {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = parseYaml(text)
    } catch {
      throw new WorkItemCliError('invalid_workitem', { detail: path })
    }
    const result = validateArtifact('rolekit/work-item@1', parsed)
    if (!result.valid) {
      throw new WorkItemCliError('invalid_workitem', {
        detail: result.issues.map((i) => i.message).join('; '),
      })
    }
    return { item: parsed as WorkItem, revision: sha(text), path }
  }
}

function allocateId(existing: WorkItem[]): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const prefix = `WI-${day}-`
  let max = 0
  for (const item of existing) {
    if (!item.id.startsWith(prefix)) continue
    const n = Number.parseInt(item.id.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

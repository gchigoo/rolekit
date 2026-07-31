import { randomBytes } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  filterKnowledge,
  type KnowledgeDocument,
  type KnowledgeEntry,
  type KnowledgeQuery,
  parseKnowledgeMarkdown,
  serializeKnowledgeDocument,
  validateArtifact,
} from '@rolekit/core'
import { KnowledgeCliError } from './errors.ts'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

interface LockHandle {
  release(): Promise<void>
}

/**
 * CLI FileKnowledgeStore: single-writer `.rolekit/knowledge/` with directory lock.
 */
export class FileKnowledgeStore {
  readonly projectRoot: string
  readonly dir: string
  readonly lockPath: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.dir = join(projectRoot, '.rolekit', 'knowledge')
    this.lockPath = join(this.dir, '.lock')
  }

  /** True when knowledge directory exists. */
  async dirExists(): Promise<boolean> {
    try {
      const s = await stat(this.dir)
      return s.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Acquire exclusive lock. Caller must ensure directory exists (except missing-dir empty reads).
   */
  async acquireLock(): Promise<LockHandle> {
    try {
      return await this.tryLock()
    } catch (error) {
      if (!(error instanceof KnowledgeCliError) || error.code !== 'lock_held') {
        throw error
      }
      const stale = await this.clearStaleLock()
      if (!stale) throw error
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

  /**
   * Consistent catalog load. Missing dir → empty without mkdir/lock.
   * Any bad name/mismatch/invalid → knowledge_invalid (no partial).
   */
  async loadCatalog(): Promise<KnowledgeDocument[]> {
    if (!(await this.dirExists())) {
      return []
    }
    return this.withLock(() => this.loadCatalogUnlocked())
  }

  async get(id: string): Promise<KnowledgeDocument> {
    if (!(await this.dirExists())) {
      throw new KnowledgeCliError('knowledge_not_found', { id })
    }
    return this.withLock(async () => {
      const path = join(this.dir, `${id}.md`)
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch {
        throw new KnowledgeCliError('knowledge_not_found', { id })
      }
      return this.parseTarget(id, text)
    })
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeDocument[]> {
    const all = await this.loadCatalog()
    return filterKnowledge(all, query)
  }

  async create(input: {
    type: KnowledgeEntry['type']
    title: string
    body: string
    tags: string[]
    status: KnowledgeEntry['status']
  }): Promise<KnowledgeDocument> {
    await mkdir(this.dir, { recursive: true })
    return this.withLock(async () => {
      const existing = await this.loadCatalogUnlocked()
      const id = allocateId(existing)
      const tags = uniqueSorted(input.tags)
      const doc: KnowledgeDocument = {
        frontmatter: {
          schema: 'rolekit/knowledge-entry@1',
          id,
          type: input.type,
          title: input.title,
          status: input.status,
          tags,
          created: new Date().toISOString(),
          source: null,
        },
        body: input.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      }
      await this.writeAtomic(doc, { expectAbsent: true })
      return doc
    })
  }

  async edit(
    id: string,
    patch: {
      title?: string
      tags?: string[]
      clearTags?: boolean
      body?: string
    },
  ): Promise<KnowledgeDocument> {
    if (!(await this.dirExists())) {
      throw new KnowledgeCliError('knowledge_not_found', { id })
    }
    return this.withLock(async () => {
      const path = join(this.dir, `${id}.md`)
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch {
        throw new KnowledgeCliError('knowledge_not_found', { id })
      }
      const current = this.parseTarget(id, text)
      const next: KnowledgeDocument = {
        frontmatter: {
          ...current.frontmatter,
          title: patch.title ?? current.frontmatter.title,
          tags: patch.clearTags
            ? []
            : patch.tags !== undefined
              ? uniqueSorted(patch.tags)
              : current.frontmatter.tags,
        },
        body:
          patch.body !== undefined
            ? patch.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            : current.body,
      }
      await this.writeAtomic(next)
      return next
    })
  }

  async setStatus(id: string, status: KnowledgeEntry['status']): Promise<KnowledgeDocument> {
    if (!(await this.dirExists())) {
      throw new KnowledgeCliError('knowledge_not_found', { id })
    }
    return this.withLock(async () => {
      const path = join(this.dir, `${id}.md`)
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch {
        throw new KnowledgeCliError('knowledge_not_found', { id })
      }
      const current = this.parseTarget(id, text)
      const next: KnowledgeDocument = {
        frontmatter: { ...current.frontmatter, status },
        body: current.body,
      }
      await this.writeAtomic(next)
      return next
    })
  }

  private async loadCatalogUnlocked(): Promise<KnowledgeDocument[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch (error) {
      throw new KnowledgeCliError('knowledge_io_failed', {
        detail: error instanceof Error ? error.message : 'readdir failed',
      })
    }
    const docs: KnowledgeDocument[] = []
    for (const name of names) {
      if (name === '.lock' || name.startsWith('.tmp-') || !name.endsWith('.md')) continue
      const id = name.slice(0, -3)
      if (!isSafeId(id)) {
        throw new KnowledgeCliError('knowledge_invalid', {
          detail: `unsafe knowledge filename: ${name}`,
          id,
        })
      }
      let text: string
      try {
        text = await readFile(join(this.dir, name), 'utf8')
      } catch (error) {
        throw new KnowledgeCliError('knowledge_io_failed', {
          detail: error instanceof Error ? error.message : 'read failed',
          id,
        })
      }
      let doc: KnowledgeDocument
      try {
        doc = parseKnowledgeMarkdown(text)
      } catch (error) {
        throw new KnowledgeCliError('knowledge_invalid', {
          detail: error instanceof Error ? error.message : 'parse failed',
          id,
        })
      }
      if (doc.frontmatter.id !== id) {
        throw new KnowledgeCliError('knowledge_invalid', {
          detail: 'frontmatter.id does not match filename',
          id,
        })
      }
      const result = validateArtifact('rolekit/knowledge-entry@1', doc)
      if (!result.valid) {
        throw new KnowledgeCliError('knowledge_invalid', {
          id,
          issues: result.issues,
          detail: result.issues.map((i) => i.message).join('; '),
        })
      }
      docs.push(doc)
    }
    docs.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id))
    return docs
  }

  private parseTarget(id: string, text: string): KnowledgeDocument {
    if (!isSafeId(id)) {
      throw new KnowledgeCliError('knowledge_invalid', { id, detail: 'unsafe id' })
    }
    let doc: KnowledgeDocument
    try {
      doc = parseKnowledgeMarkdown(text)
    } catch (error) {
      throw new KnowledgeCliError('knowledge_invalid', {
        id,
        detail: error instanceof Error ? error.message : 'parse failed',
      })
    }
    if (doc.frontmatter.id !== id) {
      throw new KnowledgeCliError('knowledge_id_mismatch', {
        id,
        detail: `frontmatter.id=${doc.frontmatter.id}`,
      })
    }
    const result = validateArtifact('rolekit/knowledge-entry@1', doc)
    if (!result.valid) {
      throw new KnowledgeCliError('knowledge_invalid', {
        id,
        issues: result.issues,
        detail: result.issues.map((i) => i.message).join('; '),
      })
    }
    return doc
  }

  private async writeAtomic(
    doc: KnowledgeDocument,
    options: { expectAbsent?: boolean } = {},
  ): Promise<void> {
    const id = doc.frontmatter.id
    if (!isSafeId(id)) {
      throw new KnowledgeCliError('knowledge_invalid', { id, detail: 'unsafe id' })
    }
    const path = join(this.dir, `${id}.md`)
    if (options.expectAbsent) {
      try {
        await stat(path)
        throw new KnowledgeCliError('knowledge_exists', { id })
      } catch (error) {
        if (error instanceof KnowledgeCliError) throw error
      }
    }
    const result = validateArtifact('rolekit/knowledge-entry@1', doc)
    if (!result.valid) {
      throw new KnowledgeCliError('knowledge_invalid', {
        id,
        issues: result.issues,
        detail: result.issues.map((i) => i.message).join('; '),
      })
    }
    const text = serializeKnowledgeDocument(doc)
    const tmp = join(this.dir, `.tmp-${randomBytes(8).toString('hex')}`)
    try {
      await writeFile(tmp, text, 'utf8')
      const again = validateArtifact(
        'rolekit/knowledge-entry@1',
        parseKnowledgeMarkdown(await readFile(tmp, 'utf8')),
      )
      if (!again.valid) {
        throw new KnowledgeCliError('knowledge_invalid', { id })
      }
      await rename(tmp, path)
    } catch (error) {
      await unlink(tmp).catch(() => undefined)
      if (error instanceof KnowledgeCliError) throw error
      throw new KnowledgeCliError('knowledge_io_failed', {
        id,
        detail: error instanceof Error ? error.message : 'write failed',
      })
    }
  }

  private async tryLock(): Promise<LockHandle> {
    try {
      const fh = await open(this.lockPath, 'wx')
      await fh.writeFile(`${process.pid}\n${Date.now()}\n`, 'utf8')
      return {
        release: async () => {
          await fh.close().catch(() => undefined)
          await unlink(this.lockPath).catch(() => undefined)
        },
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EEXIST') {
        throw new KnowledgeCliError('lock_held', { detail: 'knowledge lock held' })
      }
      throw new KnowledgeCliError('knowledge_io_failed', {
        detail: err.message ?? 'lock failed',
      })
    }
  }

  private async clearStaleLock(): Promise<boolean> {
    try {
      const text = await readFile(this.lockPath, 'utf8')
      const [pidText] = text.split('\n')
      const pid = Number(pidText)
      if (!Number.isInteger(pid) || pid <= 0) {
        await unlink(this.lockPath)
        return true
      }
      try {
        process.kill(pid, 0)
        return false
      } catch {
        await unlink(this.lockPath)
        return true
      }
    } catch {
      return false
    }
  }
}

/**
 * Returns true when id is a safe knowledge filename stem.
 */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && !id.includes('..')
}

/**
 * Allocate KN-YYYYMMDD-NNN using UTC day prefix and max+1.
 */
function allocateId(existing: KnowledgeDocument[]): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const prefix = `KN-${y}${m}${d}-`
  let max = 0
  for (const doc of existing) {
    const id = doc.frontmatter.id
    if (!id.startsWith(prefix)) continue
    const n = Number(id.slice(prefix.length))
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function uniqueSorted(tags: string[]): string[] {
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b))
}

import { open, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseKnowledgeMarkdown,
  RolekitError,
  selectActiveRules,
  validateArtifact,
} from '@rolekit/core'
import { sha256Canonical } from './canonical-json.ts'

/** Immutable knowledge snapshot written during prepare. */
export interface KnowledgeSnapshot {
  version: 1
  rules: Array<{
    id: string
    title: string
    body: string
    content_sha256: string
  }>
  collected_at: string
}

interface LockHandle {
  release(): Promise<void>
}

/**
 * Loads a consistent knowledge catalog and builds an immutable KnowledgeSnapshot.
 * Missing directory → empty rules without mkdir/lock.
 */
export async function loadKnowledgeSnapshot(projectRoot: string): Promise<KnowledgeSnapshot> {
  const dir = join(projectRoot, '.rolekit', 'knowledge')
  const collected_at = new Date().toISOString()
  try {
    const s = await stat(dir)
    if (!s.isDirectory()) {
      return { version: 1, rules: [], collected_at }
    }
  } catch {
    return { version: 1, rules: [], collected_at }
  }

  const lock = await acquireKnowledgeLock(dir)
  try {
    const docs = await loadCatalogUnlocked(dir)
    const promptRules = selectActiveRules(docs)
    const rules = promptRules.map((rule) => ({
      id: rule.id,
      title: rule.title,
      body: rule.body,
      content_sha256: sha256Canonical({ id: rule.id, title: rule.title, body: rule.body }),
    }))
    return { version: 1, rules, collected_at }
  } finally {
    await lock.release()
  }
}

/**
 * Digest projection: ascending id + content_sha256; always an array (may be empty).
 */
export function knowledgeRulesForDigest(
  snapshot: KnowledgeSnapshot,
): Array<{ id: string; content_sha256: string }> {
  return [...snapshot.rules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, content_sha256: r.content_sha256 }))
}

async function loadCatalogUnlocked(dir: string) {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    throw new RolekitError(
      error instanceof Error ? error.message : 'knowledge readdir failed',
      'knowledge_io_failed',
    )
  }
  const docs = []
  for (const name of names) {
    if (name === '.lock' || name.startsWith('.tmp-') || !name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
      throw new RolekitError(`unsafe knowledge filename: ${name}`, 'knowledge_invalid')
    }
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf8')
    } catch (error) {
      throw new RolekitError(
        error instanceof Error ? error.message : 'knowledge read failed',
        'knowledge_io_failed',
      )
    }
    let doc: ReturnType<typeof parseKnowledgeMarkdown>
    try {
      doc = parseKnowledgeMarkdown(text)
    } catch (error) {
      throw new RolekitError(
        error instanceof Error ? error.message : 'knowledge parse failed',
        'knowledge_invalid',
      )
    }
    if (doc.frontmatter.id !== id) {
      throw new RolekitError('frontmatter.id does not match filename', 'knowledge_invalid')
    }
    const result = validateArtifact('rolekit/knowledge-entry@1', doc)
    if (!result.valid) {
      throw new RolekitError(result.issues.map((i) => i.message).join('; '), 'knowledge_invalid')
    }
    docs.push(doc)
  }
  return docs
}

async function acquireKnowledgeLock(dir: string): Promise<LockHandle> {
  const lockPath = join(dir, '.lock')
  try {
    return await tryLock(lockPath)
  } catch (error) {
    if (!(error instanceof RolekitError) || error.code !== 'lock_held') {
      throw error
    }
    const stale = await clearStaleLock(lockPath)
    if (!stale) throw error
    return tryLock(lockPath)
  }
}

async function tryLock(lockPath: string): Promise<LockHandle> {
  try {
    const fh = await open(lockPath, 'wx')
    await fh.writeFile(`${process.pid}\n${Date.now()}\n`, 'utf8')
    return {
      release: async () => {
        await fh.close().catch(() => undefined)
        await unlink(lockPath).catch(() => undefined)
      },
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'EEXIST') {
      throw new RolekitError('knowledge lock held', 'lock_held')
    }
    throw new RolekitError(err.message ?? 'knowledge lock failed', 'knowledge_io_failed')
  }
}

async function clearStaleLock(lockPath: string): Promise<boolean> {
  try {
    const text = await readFile(lockPath, 'utf8')
    const pid = Number(text.split(/\r?\n/)[0] ?? '')
    if (!Number.isInteger(pid) || pid <= 0) {
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

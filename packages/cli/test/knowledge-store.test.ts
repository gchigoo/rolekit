import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { KnowledgeCliError } from '../src/knowledge/errors.ts'
import { FileKnowledgeStore } from '../src/knowledge/store.ts'

describe('FileKnowledgeStore', () => {
  it('serialized creates allocate distinct same-day ids without collision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kn-conc-'))
    const store = new FileKnowledgeStore(root)
    const a = await store.create({
      type: 'note',
      title: 'a',
      body: 'body-a',
      tags: [],
      status: 'active',
    })
    const b = await store.create({
      type: 'note',
      title: 'b',
      body: 'body-b',
      tags: [],
      status: 'active',
    })
    assert.notEqual(a.frontmatter.id, b.frontmatter.id)
    assert.match(a.frontmatter.id, /^KN-\d{8}-\d{3}$/)
    assert.match(b.frontmatter.id, /^KN-\d{8}-\d{3}$/)
    const prefix = a.frontmatter.id.slice(0, -3)
    assert.equal(b.frontmatter.id.slice(0, -3), prefix)
    assert.equal(Number(b.frontmatter.id.slice(-3)), Number(a.frontmatter.id.slice(-3)) + 1)
  })

  it('stale lock is cleared once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kn-stale-'))
    const store = new FileKnowledgeStore(root)
    mkdirSync(store.dir, { recursive: true })
    writeFileSync(store.lockPath, '999999991\n2020-01-01T00:00:00.000Z\n', 'utf8')
    const entry = await store.create({
      type: 'learning',
      title: 'after-stale',
      body: 'body',
      tags: [],
      status: 'active',
    })
    assert.equal(entry.frontmatter.title, 'after-stale')
  })

  it('live lock returns lock_held without waiting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kn-held-'))
    const store = new FileKnowledgeStore(root)
    mkdirSync(store.dir, { recursive: true })
    const fh = await open(store.lockPath, 'wx')
    await fh.writeFile(`${process.pid}\n${Date.now()}\n`, 'utf8')
    try {
      await assert.rejects(
        () =>
          store.create({
            type: 'note',
            title: 'blocked',
            body: 'body',
            tags: [],
            status: 'active',
          }),
        (err: unknown) => err instanceof KnowledgeCliError && err.code === 'lock_held',
      )
    } finally {
      await fh.close()
    }
  })
})

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { WorkItemStore } from '../src/workitem/store.ts'

describe('WorkItemStore', () => {
  it('create allocates unique ids under lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wi-store-'))
    const store = new WorkItemStore(root)
    const a = await store.create({ kind: 'feature', title: 'a', depends_on: [] })
    const b = await store.create({ kind: 'feature', title: 'b', depends_on: [] })
    assert.notEqual(a.id, b.id)
    assert.match(a.id, /^WI-\d{8}-\d{3}$/)
  })

  it('stale lock is cleared once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wi-lock-'))
    const store = new WorkItemStore(root)
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(store.dir, { recursive: true })
    writeFileSync(store.lockPath, '999999991\n2020-01-01T00:00:00.000Z\n', 'utf8')
    const item = await store.create({ kind: 'issue', title: 'after-stale', depends_on: [] })
    assert.equal(item.status, 'planned')
  })

  it('CAS write rejects mismatched revision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wi-cas-'))
    const store = new WorkItemStore(root)
    const item = await store.create({ kind: 'refactor', title: 'c', depends_on: [] })
    const stored = await store.read(item.id)
    await assert.rejects(
      () => store.write({ ...stored.item, title: 'changed' }, 'deadbeef'),
      (err: Error & { code?: string }) => err.code === 'workitem_changed',
    )
  })
})

/**
 * Critical migrate unit tests for review blockers (status, multibind, hash chains).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha256Canonical } from '../../src/canonical.ts'
import { assignIds } from '../../src/keys.ts'
import { findReferencedSkipViolations } from '../../src/map/pipeline.ts'
import { mapLifecycleStatus } from '../../src/status.ts'
import type { MappingEntry } from '../../src/types.ts'
import { MigrationError } from '../../src/types.ts'

describe('migrate critical contracts', () => {
  it('maps exact D5 status table and rejects unknown/missing', () => {
    const cases: Array<[string, string]> = [
      ['draft', 'planned'],
      ['planned', 'planned'],
      ['planning', 'planned'],
      ['design', 'designing'],
      ['designing', 'designing'],
      ['in-progress', 'executing'],
      ['active', 'executing'],
      ['implementing', 'executing'],
      ['review', 'verifying'],
      ['qa', 'verifying'],
      ['verify', 'verifying'],
      ['done', 'done'],
      ['completed', 'done'],
      ['accepted', 'done'],
      ['dropped', 'dropped'],
      ['cancelled', 'dropped'],
      ['paused', 'blocked'],
      ['blocked', 'blocked'],
    ]
    for (const [raw, expected] of cases) {
      assert.equal(mapLifecycleStatus(raw), expected, raw)
    }
    assert.throws(
      () => mapLifecycleStatus(''),
      (e: unknown) => {
        assert.ok(e instanceof MigrationError)
        assert.equal(e.code, 'migration_status_missing')
        return true
      },
    )
    assert.throws(
      () => mapLifecycleStatus('weird'),
      (e: unknown) => {
        assert.ok(e instanceof MigrationError)
        assert.equal(e.code, 'migration_status_unknown')
        return true
      },
    )
  })

  it('does not treat duplicate skip target_key as referenced-skip violation', () => {
    const entries: MappingEntry[] = [
      {
        category: 'feature',
        source_key: 'kept',
        source_digest: 'a',
        action: 'migrate',
        target_key: 'wi:feature:kept',
        field_map: [],
        assertions: [],
      },
      {
        category: 'feature',
        source_key: 'dup',
        source_digest: 'b',
        action: 'skip',
        skip_reason: 'duplicate',
        target_key: 'wi:feature:kept',
        field_map: [],
        assertions: [],
      },
      {
        category: 'feature',
        source_key: 'empty',
        source_digest: 'c',
        action: 'skip',
        skip_reason: 'empty-placeholder',
        target_key: 'wi:feature:empty',
        field_map: [],
        assertions: [],
      },
    ]
    const refs = new Set(['wi:feature:kept', 'wi:feature:empty'])
    const violations = findReferencedSkipViolations(entries, refs)
    assert.deepEqual(violations, ['wi:feature:empty'])
  })

  it('assertion detail_sha256 matches semantic-diff detail object', () => {
    const detail = {
      id: 'projection',
      passed: true,
      expected_sha256: null,
      actual_sha256: null,
      code: 'ok',
    }
    const sha = sha256Canonical(detail)
    assert.equal(sha.length, 64)
    assert.equal(sha256Canonical({ ...detail }), sha)
  })

  it('assignIds rejects over 999 work items', () => {
    const work_items = Array.from({ length: 1000 }, (_, i) => ({
      target_key: `wi:feature:f${String(i).padStart(4, '0')}`,
      kind: 'feature' as const,
      title: `f${i}`,
      status: 'planned',
      depends_on_keys: [],
      created: '2026-07-27T00:00:00.000Z',
      source_refs: [],
    }))
    const plan = {
      from: 'codestable' as const,
      adapter_id: 'codestable@1',
      plan_version: 1 as const,
      source_manifest_sha256: 'x',
      decisions_sha256: 'y',
      entries: [],
      work_items,
      knowledge: [],
      profiles: [],
      provenance: [],
      discarded: [],
      errors: [],
      has_errors: false,
    }
    assert.throws(
      () => assignIds(plan, '2026-07-29T00:00:00.000Z'),
      (e: unknown) => {
        assert.ok(e instanceof MigrationError)
        assert.equal(e.code, 'migration_validation_failed')
        return true
      },
    )
  })
})

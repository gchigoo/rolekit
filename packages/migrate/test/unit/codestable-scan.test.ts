/**
 * CodeStable scan/map unit tests against this repository's .codestable.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  attentionFileDigest,
  parseAttentionRules,
} from '../../src/adapters/codestable/attention.ts'
import { mapCodestable } from '../../src/adapters/codestable/map.ts'
import {
  CODESTABLE_ADAPTER_ID,
  detectCodestable,
  scanCodestable,
} from '../../src/adapters/codestable/scan.ts'
import { emptyDecisions } from '../../src/decisions.ts'
import { buildCodestableMandatoryCounts } from '../../src/map/pipeline.ts'
import { buildSourceManifest } from '../../src/safety.ts'

const repoRoot = join(fileURLToPath(new URL('../../../..', import.meta.url)))
const csRoot = join(repoRoot, '.codestable')

describe('codestable self-scan', () => {
  it('detects adapter_id codestable@1', async () => {
    const detected = await detectCodestable(csRoot)
    assert.equal(detected.adapter_id, CODESTABLE_ADAPTER_ID)
  })

  it('mandatory discovered counts match 11/0/0/0/1/11/6/0/1 and 10 gitkeep discarded', async () => {
    const { manifest } = await buildSourceManifest(csRoot, CODESTABLE_ADAPTER_ID)
    const scanned = await scanCodestable(csRoot, manifest)
    const plan = mapCodestable(scanned.entities, emptyDecisions(), {
      adapter_id: CODESTABLE_ADAPTER_ID,
      source_manifest_sha256: 'test',
      decisions_sha256: 'test',
      source_root: csRoot,
      manifest,
      provenance: scanned.provenance,
      discarded: scanned.discarded,
    })
    const counts = buildCodestableMandatoryCounts(plan.entries)
    const byCat = Object.fromEntries(
      counts.mandatory_by_category.map((r) => [r.category, r.discovered]),
    )
    assert.deepEqual(byCat, {
      feature: 11,
      issue: 0,
      refactor: 0,
      goal: 0,
      roadmap: 1,
      'roadmap-item': 11,
      adr: 6,
      // 冻结点为 0；knowledge/keep 落地后现为 3
      compound: 3,
      'attention-rule': 1,
    })
    const gitkeeps = scanned.discarded.filter(
      (d) => d.reason === 'empty-placeholder' && d.source_path.endsWith('.gitkeep'),
    )
    assert.equal(gitkeeps.length, 10)
    assert.equal(plan.entries.filter((e) => e.source_key.includes('gitkeep')).length, 0)
  })

  it('attention.md produces exactly 1 rule', async () => {
    const text = await readFile(join(csRoot, 'attention.md'), 'utf8')
    const { rules } = parseAttentionRules(text, attentionFileDigest(text))
    assert.equal(rules.length, 1)
    assert.equal(rules[0]!.h2, '报告语言')
  })

  it('discards 10 .gitkeep files as empty-placeholder only', async () => {
    const { manifest } = await buildSourceManifest(csRoot, CODESTABLE_ADAPTER_ID)
    const scanned = await scanCodestable(csRoot, manifest)
    const gitkeeps = scanned.discarded.filter(
      (d) => d.reason === 'empty-placeholder' && d.source_path.endsWith('.gitkeep'),
    )
    assert.equal(gitkeeps.length, 10)
  })
})

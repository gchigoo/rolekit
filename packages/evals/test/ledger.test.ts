/**
 * Ledger aggregation + unknown_expectation + negative-dir failability.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateLedger } from '../src/ledger.ts'
import { sampleEnvelope, sampleVerification, writeSeed } from './helpers/sample-run.ts'

const here = dirname(fileURLToPath(import.meta.url))
const negativeRoot = join(here, '..', '..', '..', 'evals', 'seeds-negative')

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rolekit-ledger-'))
}

describe('evaluateLedger', () => {
  it('passes a mock clean+violation+cancelled ledger', () => {
    const root = tempDir()
    try {
      writeSeed({
        dir: join(root, 'clean'),
        name: 'clean',
        expectation: 'clean',
        source: 'mock',
      })
      writeSeed({
        dir: join(root, 'viol'),
        name: 'viol',
        expectation: 'violation',
        source: 'mock',
        result: sampleEnvelope({
          status: 'failed',
          scope_violations: ['forbidden:x'],
          unresolved: ['forbidden:x'],
          recommended_next_action: 'retry',
        }),
        verification: sampleVerification(['forbidden:x']),
      })
      writeSeed({
        dir: join(root, 'cancel'),
        name: 'cancel',
        expectation: 'cancelled',
        source: 'mock',
        result: sampleEnvelope({
          status: 'cancelled',
          unresolved: ['cancelled'],
          recommended_next_action: 'retry',
          evidence: ['events.jsonl'],
        }),
      })
      const report = evaluateLedger(root)
      assert.equal(report.verdict, 'pass')
      assert.equal(report.metrics.contract_completeness.pass, true)
      assert.equal(report.metrics.envelope_completeness.pass, true)
      assert.equal('skipped' in report.metrics.scope_detection, false)
      if (!('skipped' in report.metrics.scope_detection)) {
        assert.equal(report.metrics.scope_detection.pass, true)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails with unknown_expectation', () => {
    const root = tempDir()
    try {
      const dir = join(root, 'weird')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'seed.yaml'),
        'name: weird\nsource: mock\nexpectation: weird\ncaptured: "2026-07-28"\n',
      )
      const report = evaluateLedger(root)
      assert.equal(report.verdict, 'fail')
      assert.equal(report.reason, 'unknown_expectation')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('seeds-negative directory yields fail verdict (D5)', () => {
    const report = evaluateLedger(negativeRoot)
    assert.equal(report.verdict, 'fail')
    assert.ok(report.runs.length >= 4)
  })
})

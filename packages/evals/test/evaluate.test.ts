/**
 * evaluateRun formula tests — positive/negative per metric + shape freeze.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { evaluateRun } from '../src/evaluate.ts'
import { sampleEnvelope, sampleTask, sampleVerification, writeSeed } from './helpers/sample-run.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rolekit-evals-'))
}

describe('evaluateRun shape and no-meta mode', () => {
  it('freezes RunEvalResult shape; scope skipped without meta', () => {
    const dir = tempDir()
    try {
      writeSeed({ dir, name: 'shape', expectation: 'clean', writeMeta: false })
      const result = evaluateRun(dir)
      assert.equal(result.contract, 'pass')
      assert.equal(result.envelope.validate, 'pass')
      assert.equal(result.envelope.evidence_paths, 'pass')
      assert.equal(result.envelope.pass, true)
      assert.equal(result.scope, 'skipped')
      assert.deepEqual(Object.keys(result).sort(), ['contract', 'envelope', 'scope'])
      assert.deepEqual(Object.keys(result.envelope).sort(), ['evidence_paths', 'pass', 'validate'])
      assert.equal(
        result.envelope.pass,
        result.envelope.validate === 'pass' && result.envelope.evidence_paths === 'pass',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('contract completeness', () => {
  it('pass when task.json validates', () => {
    const dir = tempDir()
    try {
      writeSeed({ dir, name: 'c-ok', expectation: 'clean', writeMeta: false })
      assert.equal(evaluateRun(dir, { expectation: 'clean' }).contract, 'pass')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fail when task.json missing required field', () => {
    const dir = tempDir()
    try {
      const task = sampleTask()
      delete task.id
      writeSeed({ dir, name: 'c-bad', expectation: 'clean', task, writeMeta: false })
      assert.equal(evaluateRun(dir, { expectation: 'clean' }).contract, 'fail')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('scope twin metrics', () => {
  it('clean detected=false; violation detected=true', () => {
    const clean = tempDir()
    const viol = tempDir()
    try {
      writeSeed({
        dir: clean,
        name: 'clean',
        expectation: 'clean',
        verification: sampleVerification([]),
        writeMeta: false,
      })
      writeSeed({
        dir: viol,
        name: 'viol',
        expectation: 'violation',
        result: sampleEnvelope({
          status: 'failed',
          scope_violations: ['forbidden:x'],
          unresolved: ['forbidden:x'],
          recommended_next_action: 'retry',
        }),
        verification: sampleVerification(['forbidden:x']),
        writeMeta: false,
      })
      const c = evaluateRun(clean, { expectation: 'clean' })
      const v = evaluateRun(viol, { expectation: 'violation' })
      assert.deepEqual(c.scope, { detected: false })
      assert.deepEqual(v.scope, { detected: true })
    } finally {
      rmSync(clean, { recursive: true, force: true })
      rmSync(viol, { recursive: true, force: true })
    }
  })

  it('cancelled expectation skips scope', () => {
    const dir = tempDir()
    try {
      writeSeed({
        dir,
        name: 'cancel',
        expectation: 'cancelled',
        result: sampleEnvelope({
          status: 'cancelled',
          unresolved: ['cancelled'],
          recommended_next_action: 'retry',
          changed_files: [],
          verification: [],
          evidence: ['events.jsonl'],
        }),
        writeMeta: false,
      })
      assert.equal(evaluateRun(dir, { expectation: 'cancelled' }).scope, 'skipped')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('false-positive path: clean with non-empty scope_violations → detected true', () => {
    const dir = tempDir()
    try {
      writeSeed({
        dir,
        name: 'fp',
        expectation: 'clean',
        verification: sampleVerification(['leak']),
        writeMeta: false,
      })
      assert.deepEqual(evaluateRun(dir, { expectation: 'clean' }).scope, {
        detected: true,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('envelope completeness', () => {
  it('pass when validateArtifact + evidence paths exist', () => {
    const dir = tempDir()
    try {
      writeSeed({ dir, name: 'e-ok', expectation: 'clean', writeMeta: false })
      const r = evaluateRun(dir, { expectation: 'clean' })
      assert.equal(r.envelope.pass, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fail when failed status lacks unresolved', () => {
    const dir = tempDir()
    try {
      writeSeed({
        dir,
        name: 'e-bad',
        expectation: 'clean',
        result: sampleEnvelope({ status: 'failed', unresolved: [] }),
        writeMeta: false,
      })
      const r = evaluateRun(dir, { expectation: 'clean' })
      assert.equal(r.envelope.validate, 'fail')
      assert.equal(r.envelope.pass, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cancelled counts toward envelope when unresolved non-empty', () => {
    const dir = tempDir()
    try {
      writeSeed({
        dir,
        name: 'cancel-env',
        expectation: 'cancelled',
        result: sampleEnvelope({
          status: 'cancelled',
          unresolved: ['cancelled'],
          recommended_next_action: 'retry',
          evidence: ['events.jsonl'],
        }),
        writeMeta: false,
      })
      assert.equal(evaluateRun(dir, { expectation: 'cancelled' }).envelope.pass, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fail when evidence path missing on disk', () => {
    const dir = tempDir()
    try {
      writeSeed({
        dir,
        name: 'e-miss',
        expectation: 'clean',
        result: sampleEnvelope({ evidence: ['no-such-file.json'] }),
        writeMeta: false,
      })
      const r = evaluateRun(dir, { expectation: 'clean' })
      assert.equal(r.envelope.validate, 'pass')
      assert.equal(r.envelope.evidence_paths, 'fail')
      assert.equal(r.envelope.pass, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

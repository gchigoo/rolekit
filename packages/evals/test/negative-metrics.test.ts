/**
 * D5: each seeds-negative class fails its corresponding metric slice.
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateRun } from '../src/evaluate.ts'
import { evaluateLedger } from '../src/ledger.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const neg = join(root, 'evals/seeds-negative')

describe('seeds-negative metric slices', () => {
  it('envelope-missing-unresolved fails envelope.validate', () => {
    const r = evaluateRun(join(neg, 'envelope-missing-unresolved'), {
      expectation: 'clean',
    })
    assert.equal(r.envelope.validate, 'fail')
    assert.equal(r.envelope.pass, false)
  })

  it('task-missing-field fails contract', () => {
    const r = evaluateRun(join(neg, 'task-missing-field'), { expectation: 'clean' })
    assert.equal(r.contract, 'fail')
  })

  it('violation-cleared-scope fails detection (detected=false)', () => {
    const r = evaluateRun(join(neg, 'violation-cleared-scope'), {
      expectation: 'violation',
    })
    assert.deepEqual(r.scope, { detected: false })
  })

  it('evidence-missing-path fails evidence_paths', () => {
    const r = evaluateRun(join(neg, 'evidence-missing-path'), { expectation: 'clean' })
    assert.equal(r.envelope.evidence_paths, 'fail')
    assert.equal(r.envelope.pass, false)
  })

  it('full negative ledger fails overall verdict', () => {
    assert.equal(evaluateLedger(neg).verdict, 'fail')
  })
})

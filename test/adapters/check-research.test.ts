/**
 * Fixture regression for check:research (positive + >=7 negatives).
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkResearch } from '../../scripts/check-research.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures', 'research')

describe('check:research fixtures', () => {
  it('passes positive fixture', () => {
    const result = checkResearch(join(fixtures, 'positive'))
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.assertions.length, 4)
    assert.ok(result.assertions.every((a) => a.ok))
  })

  it('fails when artifact missing', () => {
    const result = checkResearch(join(fixtures, 'neg-missing-artifact'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'artifacts_and_evidence' && !a.ok))
  })

  it('fails when inline ref has no definition', () => {
    const result = checkResearch(join(fixtures, 'neg-undefined-ref'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'inline_citations_resolve' && !a.ok))
  })

  it('fails when index and annotations disagree', () => {
    const result = checkResearch(join(fixtures, 'neg-index-mismatch'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'index_matches_annotations' && !a.ok))
  })

  it('fails when no web_search_call', () => {
    const result = checkResearch(join(fixtures, 'neg-no-search'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'has_web_search_call' && !a.ok))
  })

  it('fails when evidence missing one path', () => {
    const result = checkResearch(join(fixtures, 'neg-evidence-missing'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'artifacts_and_evidence' && !a.ok))
  })

  it('fails when evidence has extra path', () => {
    const result = checkResearch(join(fixtures, 'neg-evidence-extra'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'artifacts_and_evidence' && !a.ok))
  })

  it('fails when evidence paths are non-canonical', () => {
    const result = checkResearch(join(fixtures, 'neg-evidence-path'))
    assert.equal(result.ok, false)
    assert.ok(result.assertions.some((a) => a.id === 'artifacts_and_evidence' && !a.ok))
  })

  it('non-completed run exits with run_not_completed', () => {
    const result = checkResearch(join(fixtures, 'neg-not-completed'))
    assert.equal(result.ok, false)
    assert.equal(result.code, 'run_not_completed')
  })
})

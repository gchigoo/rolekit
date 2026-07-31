/**
 * Shared evals types — report structure is package-owned (not a core schema).
 */

/** Closed expectation set for seed metadata (D3). */
export type SeedExpectation = 'clean' | 'violation' | 'cancelled'

/** Optional meta for evaluateRun; only scope twin metrics consume expectation. */
export type RunEvalMeta = {
  expectation?: SeedExpectation
}

/** Frozen RunEvalResult shape (hardening reuse contract). */
export type RunEvalResult = {
  contract: 'pass' | 'fail'
  envelope: {
    validate: 'pass' | 'fail'
    evidence_paths: 'pass' | 'fail'
    pass: boolean
  }
  scope: { detected: boolean } | 'skipped'
}

/** Seed directory metadata (seed.yaml). */
export type SeedMeta = {
  name: string
  source: string
  expectation: SeedExpectation
  captured: string
}

/** Per-seed ledger row. */
export type SeedEvalRow = {
  name: string
  expectation: SeedExpectation
  result: RunEvalResult
}

/** Ratio metric with threshold. */
export type RatioMetric = {
  passed: number
  total: number
  rate: number
  threshold: number
  pass: boolean
}

/** Count metric with threshold. */
export type CountMetric = {
  count: number
  threshold: number
  pass: boolean
}

/** Full ledger report (stdout JSON). */
export type EvalsReport = {
  verdict: 'pass' | 'fail'
  reason?: string
  runs: SeedEvalRow[]
  metrics: {
    contract_completeness: RatioMetric
    envelope_completeness: RatioMetric
    scope_detection: RatioMetric | { skipped: true }
    scope_false_positives: CountMetric | { skipped: true }
  }
}

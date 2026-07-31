/**
 * Ledger aggregation over seed directories — pure metric formulas + report shape.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { evaluateRun } from './evaluate.ts'
import type {
  CountMetric,
  EvalsReport,
  RatioMetric,
  SeedEvalRow,
  SeedExpectation,
  SeedMeta,
} from './types.ts'

const EXPECTATIONS = new Set<SeedExpectation>(['clean', 'violation', 'cancelled'])

/**
 * Parses seed.yaml; returns error code when illegal.
 */
export function parseSeedMeta(
  raw: string,
):
  | { ok: true; meta: SeedMeta }
  | { ok: false; reason: 'unknown_expectation' | 'invalid_seed_meta' } {
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return { ok: false, reason: 'invalid_seed_meta' }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid_seed_meta' }
  }
  const rec = parsed as Record<string, unknown>
  const name = rec.name
  const source = rec.source
  const expectation = rec.expectation
  const captured = rec.captured
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    typeof source !== 'string' ||
    source.length === 0 ||
    typeof captured !== 'string' ||
    captured.length === 0 ||
    typeof expectation !== 'string'
  ) {
    return { ok: false, reason: 'invalid_seed_meta' }
  }
  if (!EXPECTATIONS.has(expectation as SeedExpectation)) {
    return { ok: false, reason: 'unknown_expectation' }
  }
  return {
    ok: true,
    meta: {
      name,
      source,
      expectation: expectation as SeedExpectation,
      captured,
    },
  }
}

/**
 * Builds a ratio metric with hard threshold.
 */
function ratioMetric(passed: number, total: number, threshold: number): RatioMetric {
  const rate = total === 0 ? 1 : passed / total
  return {
    passed,
    total,
    rate,
    threshold,
    pass: rate >= threshold,
  }
}

/**
 * Builds a count metric (false-positive style; pass when count <= threshold).
 */
function countMetric(count: number, threshold: number): CountMetric {
  return { count, threshold, pass: count <= threshold }
}

/**
 * Lists immediate child directories under seedsDir.
 */
function listSeedDirs(seedsDir: string): string[] {
  if (!existsSync(seedsDir)) return []
  return readdirSync(seedsDir)
    .map((name) => join(seedsDir, name))
    .filter((p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * Evaluates every seed under seedsDir and aggregates the three frozen metrics.
 */
export function evaluateLedger(seedsDir: string): EvalsReport {
  const dirs = listSeedDirs(seedsDir)
  const runs: SeedEvalRow[] = []

  for (const dir of dirs) {
    const metaPath = join(dir, 'seed.yaml')
    if (!existsSync(metaPath)) {
      return {
        verdict: 'fail',
        reason: 'invalid_seed_meta',
        runs,
        metrics: emptyMetrics(),
      }
    }
    const parsed = parseSeedMeta(readFileSync(metaPath, 'utf8'))
    if (!parsed.ok) {
      return {
        verdict: 'fail',
        reason: parsed.reason,
        runs,
        metrics: emptyMetrics(),
      }
    }
    const result = evaluateRun(dir, { expectation: parsed.meta.expectation })
    runs.push({
      name: parsed.meta.name,
      expectation: parsed.meta.expectation,
      result,
    })
  }

  let contractPassed = 0
  let envelopePassed = 0
  let detectionPassed = 0
  let detectionTotal = 0
  let falsePositives = 0
  let cleanTotal = 0

  for (const row of runs) {
    if (row.result.contract === 'pass') contractPassed += 1
    if (row.result.envelope.pass) envelopePassed += 1
    if (row.expectation === 'violation') {
      detectionTotal += 1
      if (row.result.scope !== 'skipped' && row.result.scope.detected) {
        detectionPassed += 1
      }
    }
    if (row.expectation === 'clean') {
      cleanTotal += 1
      if (row.result.scope !== 'skipped' && row.result.scope.detected) {
        falsePositives += 1
      }
    }
  }

  const total = runs.length
  const metrics: EvalsReport['metrics'] = {
    contract_completeness: ratioMetric(contractPassed, total, 1),
    envelope_completeness: ratioMetric(envelopePassed, total, 1),
    scope_detection:
      detectionTotal === 0 ? { skipped: true } : ratioMetric(detectionPassed, detectionTotal, 1),
    scope_false_positives: cleanTotal === 0 ? { skipped: true } : countMetric(falsePositives, 0),
  }

  const metricPass =
    metrics.contract_completeness.pass &&
    metrics.envelope_completeness.pass &&
    ('skipped' in metrics.scope_detection || metrics.scope_detection.pass) &&
    ('skipped' in metrics.scope_false_positives || metrics.scope_false_positives.pass)

  return {
    verdict: metricPass && total > 0 ? 'pass' : 'fail',
    runs,
    metrics,
  }
}

/**
 * Empty metrics placeholder for early meta failures.
 */
function emptyMetrics(): EvalsReport['metrics'] {
  return {
    contract_completeness: ratioMetric(0, 0, 1),
    envelope_completeness: ratioMetric(0, 0, 1),
    scope_detection: { skipped: true },
    scope_false_positives: { skipped: true },
  }
}

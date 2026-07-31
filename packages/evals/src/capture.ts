/**
 * Seed capture: copy five artifacts, redact, write seed.yaml, admission via evaluateRun.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { evaluateRun } from './evaluate.ts'
import { findForbiddenLeak, redactText } from './redact.ts'
import type { SeedExpectation } from './types.ts'

/** Five run artifacts required by seed directory contract (D2). */
export const SEED_ARTIFACTS = [
  'task.json',
  'prompt.md',
  'events.jsonl',
  'result.json',
  'verification.json',
] as const

const EXPECTATIONS = new Set<SeedExpectation>(['clean', 'violation', 'cancelled'])

export type CaptureArgs = {
  runDir: string
  name: string
  expectation: string
  seedsRoot: string
  source?: string
  captured?: string
}

export type CaptureResult =
  | { ok: true; seedDir: string }
  | { ok: false; code: string; message: string }

/**
 * Captures a run directory into evals/seeds/<name>/ with admission gate.
 */
export function captureSeed(args: CaptureArgs): CaptureResult {
  const { runDir, name, seedsRoot } = args
  if (!name || /[\\/]/.test(name)) {
    return { ok: false, code: 'usage_error', message: 'invalid seed name' }
  }
  if (!EXPECTATIONS.has(args.expectation as SeedExpectation)) {
    return {
      ok: false,
      code: 'unknown_expectation',
      message: `unknown expectation: ${args.expectation}`,
    }
  }
  const expectation = args.expectation as SeedExpectation
  if (!existsSync(runDir)) {
    return { ok: false, code: 'usage_error', message: `runDir not found: ${runDir}` }
  }

  for (const artifact of SEED_ARTIFACTS) {
    if (!existsSync(join(runDir, artifact))) {
      return {
        ok: false,
        code: 'missing_artifact',
        message: `missing artifact: ${artifact}`,
      }
    }
  }

  const seedDir = join(seedsRoot, name)
  if (existsSync(seedDir)) {
    return { ok: false, code: 'seed_exists', message: `seed already exists: ${name}` }
  }

  mkdirSync(seedDir, { recursive: true })
  try {
    for (const artifact of SEED_ARTIFACTS) {
      const raw = readFileSync(join(runDir, artifact), 'utf8')
      const redacted = redactText(raw)
      const leak = findForbiddenLeak(redacted)
      if (leak) {
        throw Object.assign(new Error(`redaction incomplete: ${leak}`), {
          code: 'redaction_failed',
        })
      }
      writeFileSync(join(seedDir, artifact), redacted, 'utf8')
    }

    const captured = args.captured ?? new Date().toISOString().slice(0, 10)
    const source = args.source ?? `capture:${name}`
    const meta = { name, source, expectation, captured }
    writeFileSync(join(seedDir, 'seed.yaml'), stringifyYaml(meta), 'utf8')

    const admission = admitSeed(seedDir, expectation)
    if (!admission.ok) {
      rmSync(seedDir, { recursive: true, force: true })
      return admission
    }
    return { ok: true, seedDir }
  } catch (error) {
    rmSync(seedDir, { recursive: true, force: true })
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'capture_failed'
    return {
      ok: false,
      code,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Admission gate: evaluateRun must match expectation labels (D2).
 */
export function admitSeed(seedDir: string, expectation: SeedExpectation): CaptureResult {
  const result = evaluateRun(seedDir, { expectation })
  if (result.contract !== 'pass' || !result.envelope.pass) {
    return {
      ok: false,
      code: 'seed_rejected',
      message: 'upstream artifact defect: contract or envelope metric failed (not an evals bug)',
    }
  }
  if (expectation === 'clean') {
    if (result.scope === 'skipped' || result.scope.detected) {
      return {
        ok: false,
        code: 'seed_rejected',
        message: 'upstream artifact defect: clean seed must have detected=false',
      }
    }
  }
  if (expectation === 'violation') {
    if (result.scope === 'skipped' || !result.scope.detected) {
      return {
        ok: false,
        code: 'seed_rejected',
        message: 'upstream artifact defect: violation seed must have detected=true',
      }
    }
    // Envelope semantic premise: unresolved non-empty for failed violation runs
    const envelope = JSON.parse(readFileSync(join(seedDir, 'result.json'), 'utf8')) as {
      unresolved?: unknown[]
    }
    if (!Array.isArray(envelope.unresolved) || envelope.unresolved.length === 0) {
      return {
        ok: false,
        code: 'seed_rejected',
        message: 'upstream artifact defect: violation seed requires non-empty unresolved',
      }
    }
  }
  // cancelled: scope skipped; contract + envelope already checked
  return { ok: true, seedDir }
}

/**
 * Copies a directory tree (used by tests for staging).
 */
export function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
}

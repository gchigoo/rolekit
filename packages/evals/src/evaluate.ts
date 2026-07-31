/**
 * evaluateRun — single source of truth for contract / scope / envelope metrics.
 * Hardening dogfood must call this with no meta (scope skipped).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateArtifact } from '@rolekit/core'
import type { RunEvalMeta, RunEvalResult } from './types.ts'

const ARTIFACT_TASK = 'task.json'
const ARTIFACT_RESULT = 'result.json'
const ARTIFACT_VERIFICATION = 'verification.json'

/**
 * Reads and JSON-parses a file; returns undefined on missing/invalid JSON.
 */
function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * Checks that every evidence relative path exists under runDir.
 * Absolute / traversal segments fail.
 */
function evidencePathsPass(runDir: string, evidence: unknown): boolean {
  if (!Array.isArray(evidence)) return false
  for (const item of evidence) {
    if (typeof item !== 'string' || item.length === 0) return false
    if (item.includes('..') || item.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item)) {
      return false
    }
    if (!existsSync(join(runDir, item))) return false
  }
  return true
}

/**
 * Reads verification.json.scope_violations; missing/invalid → treated as empty.
 */
function readScopeViolations(runDir: string): string[] {
  const data = readJson(join(runDir, ARTIFACT_VERIFICATION))
  if (data === null || typeof data !== 'object') return []
  const scope = (data as { scope_violations?: unknown }).scope_violations
  if (!Array.isArray(scope)) return []
  return scope.filter((v): v is string => typeof v === 'string')
}

/**
 * Evaluates a single run directory against the frozen three-metric formulas.
 * Scope is skipped when meta is absent or expectation is cancelled.
 */
export function evaluateRun(runDir: string, meta?: RunEvalMeta): RunEvalResult {
  const task = readJson(join(runDir, ARTIFACT_TASK))
  const contract: 'pass' | 'fail' =
    task !== undefined && validateArtifact('rolekit/task-contract@1', task).valid ? 'pass' : 'fail'

  const result = readJson(join(runDir, ARTIFACT_RESULT))
  const validatePass =
    result !== undefined && validateArtifact('rolekit/result-envelope@1', result).valid
  const evidence =
    result !== null && typeof result === 'object'
      ? (result as { evidence?: unknown }).evidence
      : undefined
  const evidencePass = validatePass && evidencePathsPass(runDir, evidence ?? [])
  const envelope = {
    validate: validatePass ? ('pass' as const) : ('fail' as const),
    evidence_paths: evidencePass ? ('pass' as const) : ('fail' as const),
    pass: validatePass && evidencePass,
  }

  const expectation = meta?.expectation
  let scope: RunEvalResult['scope']
  if (expectation === undefined || expectation === 'cancelled') {
    scope = 'skipped'
  } else {
    const violations = readScopeViolations(runDir)
    scope = { detected: violations.length > 0 }
  }

  return { contract, envelope, scope }
}

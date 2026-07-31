import type { ExecutorReport, TriggerHit } from '@rolekit/core'
import { matchAny } from '../glob.ts'
import type { VerificationReport } from '../types.ts'
import type { ChangeManifest, ChangeManifestEntry } from './change-manifest.ts'
import type { DetectPolicy } from './detect-policy.ts'

/** Detector-produced trigger allowlist (WorkItem may add design/final separately). */
export const DETECTOR_TRIGGERS = [
  'new-dependency',
  'migration',
  'public-api-change',
  'delete',
  'ambiguous-requirement',
] as const

export type DetectorTrigger = (typeof DETECTOR_TRIGGERS)[number]

export interface DetectorInput {
  manifest: ChangeManifest
  verification: VerificationReport
  executorReport: ExecutorReport
  detect: DetectPolicy
}

/**
 * Runs path/report detectors → TriggerHit[] (sorted paths, allowlisted triggers only).
 * scope-violation is mechanical and never returned here.
 */
export function runDetectors(input: DetectorInput): TriggerHit[] {
  const hits: TriggerHit[] = []
  const dependencyPaths = matchChangedPaths(input.manifest.entries, (entry) =>
    matchesDependency(entry, input.detect.dependency_files),
  )
  if (dependencyPaths.length > 0) {
    hits.push({
      trigger: 'new-dependency',
      paths: dependencyPaths,
      evidence: 'artifacts/change-manifest.json',
    })
  }

  const migrationPaths = matchChangedPaths(input.manifest.entries, (entry) =>
    matchesPathSet(entry, input.detect.migration_paths),
  )
  if (migrationPaths.length > 0) {
    hits.push({
      trigger: 'migration',
      paths: migrationPaths,
      evidence: 'artifacts/change-manifest.json',
    })
  }

  if (input.detect.api_paths.length > 0) {
    const apiPaths = matchChangedPaths(input.manifest.entries, (entry) =>
      matchesPathSet(entry, input.detect.api_paths),
    )
    if (apiPaths.length > 0) {
      hits.push({
        trigger: 'public-api-change',
        paths: apiPaths,
        evidence: 'artifacts/change-manifest.json',
      })
    }
  }

  const deletePaths = collectDeletePaths(input.manifest.entries)
  if (deletePaths.length > 0) {
    hits.push({
      trigger: 'delete',
      paths: deletePaths,
      evidence: 'artifacts/change-manifest.json',
    })
  }

  if (input.executorReport.unresolved.length > 0) {
    hits.push({
      trigger: 'ambiguous-requirement',
      evidence: 'artifacts/executor-report.json#/unresolved',
    })
  }

  return hits
}

/**
 * Whether empty api_paths should emit the once-per-run warning.
 */
export function shouldWarnEmptyApiPaths(detect: DetectPolicy): boolean {
  return detect.api_paths.length === 0
}

export const EMPTY_API_PATHS_WARNING =
  '[warning:empty_api_paths] public-api-change detector disabled'

function matchChangedPaths(
  entries: ChangeManifestEntry[],
  predicate: (entry: ChangeManifestEntry) => string[],
): string[] {
  const found = new Set<string>()
  for (const entry of entries) {
    for (const path of predicate(entry)) {
      found.add(path)
    }
  }
  return [...found].sort()
}

function matchesDependency(entry: ChangeManifestEntry, dependencyFiles: string[]): string[] {
  const hit: string[] = []
  for (const candidate of pathCandidates(entry)) {
    const base = candidate.split('/').pop() ?? candidate
    if (dependencyFiles.includes(base) || dependencyFiles.includes(candidate)) {
      hit.push(candidate)
    }
  }
  return hit
}

function matchesPathSet(entry: ChangeManifestEntry, patterns: string[]): string[] {
  if (patterns.length === 0) return []
  const hit: string[] = []
  for (const candidate of pathCandidates(entry)) {
    if (matchAny(patterns, candidate)) {
      hit.push(candidate)
    }
  }
  return hit
}

function collectDeletePaths(entries: ChangeManifestEntry[]): string[] {
  const found = new Set<string>()
  for (const entry of entries) {
    if (entry.status === 'D') {
      found.add(entry.path)
    } else if (entry.status === 'R' && entry.old_path) {
      found.add(entry.old_path)
    }
  }
  return [...found].sort()
}

function pathCandidates(entry: ChangeManifestEntry): string[] {
  if (entry.status === 'R' || entry.status === 'C') {
    const out = [entry.path]
    if (entry.old_path) out.push(entry.old_path)
    return out
  }
  return [entry.path]
}

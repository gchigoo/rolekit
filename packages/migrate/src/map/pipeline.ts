/**
 * Shared map-pipeline helpers (D8b steps 5–7, D10 counts).
 */

import { compareUtf8, sha256Canonical, sha256Text, sortUniqueUtf8 } from '../canonical.ts'
import { buildMandatoryCounts } from '../report.ts'
import type {
  ErrorDetail,
  MappingEntry,
  MigrationCounts,
  PlannedKnowledge,
  PlannedWorkItem,
  StableErrorCode,
} from '../types.ts'

/** CodeStable adapter mandatory category闭表（恒 9 行）。 */
export const CODESTABLE_MANDATORY_CATEGORIES = [
  'feature',
  'issue',
  'refactor',
  'goal',
  'roadmap',
  'roadmap-item',
  'adr',
  'compound',
  'attention-rule',
] as const

/**
 * SHA-256 of RFC8785 error detail（error-details 链）。
 */
export function hashErrorDetail(detail: ErrorDetail): string {
  return sha256Canonical(detail)
}

/**
 * Builds MigrationCounts with CodeStable mandatory 9 rows.
 */
export function buildCodestableMandatoryCounts(entries: MappingEntry[]): MigrationCounts {
  return buildMandatoryCounts(CODESTABLE_MANDATORY_CATEGORIES, entries)
}

/**
 * WorkItem canonical projection for duplicate detection (D8).
 */
export function wiDuplicateProjection(item: PlannedWorkItem): string {
  return sha256Canonical({
    kind: item.kind,
    title: item.title,
    status: item.status,
    depends_on: sortUniqueUtf8(item.depends_on_keys),
  })
}

/**
 * Knowledge canonical projection for duplicate detection (D8).
 */
export function knDuplicateProjection(item: PlannedKnowledge, bodySha256: string): string {
  return sha256Canonical({
    type: item.type,
    title: item.title,
    status: item.status,
    tags: item.tags,
    created: item.created,
    source: item.source,
    body_sha256: bodySha256,
  })
}

export interface DuplicateHit {
  sourceKey: string
  targetKey: string
  canonicalTargetKey: string
}

/**
 * 同 category 下按 projection SHA 找 duplicate skip 目标（D8 step 5）。
 */
export function findDuplicateTargets<
  T extends { target_key: string; category: string; source_key: string },
>(items: T[], projectionOf: (item: T) => string): Map<string, DuplicateHit> {
  const byProjection = new Map<string, T>()
  const duplicates = new Map<string, DuplicateHit>()
  const sorted = [...items].sort((a, b) => compareUtf8(a.target_key, b.target_key))
  for (const item of sorted) {
    const sha = projectionOf(item)
    const existing = byProjection.get(sha)
    if (existing) {
      duplicates.set(item.source_key, {
        sourceKey: item.source_key,
        targetKey: item.target_key,
        canonicalTargetKey: existing.target_key,
      })
    } else {
      byProjection.set(sha, item)
    }
  }
  return duplicates
}

export interface GraphValidationIssue {
  code: StableErrorCode
  refs: string[]
}

/**
 * 校验 depends_on：缺失、self、cycle（D8b step 7）。
 */
export function validateDependsGraph(workItems: PlannedWorkItem[]): GraphValidationIssue[] {
  const keySet = new Set(workItems.map((w) => w.target_key))
  const issues: GraphValidationIssue[] = []
  for (const wi of workItems) {
    for (const dep of wi.depends_on_keys) {
      if (dep === wi.target_key) {
        issues.push({
          code: 'migration_dependency_invalid',
          refs: sortUniqueUtf8([wi.target_key, dep]),
        })
      } else if (!keySet.has(dep)) {
        issues.push({
          code: 'migration_dependency_invalid',
          refs: sortUniqueUtf8([wi.target_key, dep]),
        })
      }
    }
  }
  const cycle = detectCycle(workItems)
  if (cycle.length > 0) {
    issues.push({
      code: 'migration_dependency_invalid',
      refs: sortUniqueUtf8(cycle),
    })
  }
  return issues
}

/**
 * goal done 不变量：status=done 的 goal 其 depends_on 目标亦须 done（D8b step 7）。
 */
export function validateGoalDoneInvariant(workItems: PlannedWorkItem[]): GraphValidationIssue[] {
  const byKey = new Map(workItems.map((w) => [w.target_key, w]))
  const issues: GraphValidationIssue[] = []
  for (const wi of workItems) {
    if (wi.kind !== 'goal' || wi.status !== 'done') continue
    for (const depKey of wi.depends_on_keys) {
      const dep = byKey.get(depKey)
      if (!dep) continue
      if (dep.status !== 'done' && dep.status !== 'dropped') {
        issues.push({
          code: 'migration_dependency_invalid',
          refs: sortUniqueUtf8([wi.target_key, depKey]),
        })
      }
    }
  }
  return issues
}

/**
 * 被 depends_on / merge_into 引用的 target_key 不得 skip（D8b step 6）。
 */
export function findReferencedSkipViolations(
  entries: MappingEntry[],
  referencedKeys: Set<string>,
): string[] {
  // duplicate 的 target_key 指向保留 target，不计入被 skip 身份
  const skipped = new Set(
    entries
      .filter((e) => e.action === 'skip' && e.skip_reason !== 'duplicate')
      .map((e) => e.target_key)
      .filter(Boolean) as string[],
  )
  return sortUniqueUtf8([...referencedKeys].filter((k) => skipped.has(k)))
}

/**
 * 从 mapping entries 收集 merge_into 与 depends 边引用的 logical keys。
 */
export function collectReferencedTargetKeys(
  entries: MappingEntry[],
  workItems: PlannedWorkItem[],
): Set<string> {
  const refs = new Set<string>()
  for (const e of entries) {
    if (e.merge_into) refs.add(e.merge_into)
  }
  for (const wi of workItems) {
    for (const dep of wi.depends_on_keys) refs.add(dep)
  }
  return refs
}

function detectCycle(workItems: PlannedWorkItem[]): string[] {
  const adj = new Map<string, string[]>()
  for (const wi of workItems) {
    adj.set(wi.target_key, [...wi.depends_on_keys])
  }
  const visited = new Set<string>()
  const stack = new Set<string>()
  let cycleNodes: string[] = []

  const dfs = (node: string, path: string[]): boolean => {
    if (stack.has(node)) {
      const idx = path.indexOf(node)
      cycleNodes = idx >= 0 ? path.slice(idx) : [node]
      return true
    }
    if (visited.has(node)) return false
    visited.add(node)
    stack.add(node)
    for (const next of adj.get(node) ?? []) {
      if (dfs(next, [...path, node])) return true
    }
    stack.delete(node)
    return false
  }

  for (const wi of workItems) {
    if (dfs(wi.target_key, [])) break
  }
  return cycleNodes
}

/** body SHA-256 helper for knowledge duplicate projection. */
export function bodySha256(body: string): string {
  return sha256Text(body)
}

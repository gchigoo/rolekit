/**
 * Logical target keys, percent-encoding, assignIds, fingerprint helpers.
 */

import { compareUtf8, sha256Canonical, sortUniqueUtf8 } from './canonical.ts'
import type {
  MappingCategory,
  MaterializationPlan,
  MigrationFrom,
  MigrationPlan,
  SourceLocator,
} from './types.ts'
import { MigrationError } from './types.ts'

const KEEP = /^[A-Za-z0-9._-]$/

/**
 * UTF-8 percent-encode: keep [A-Za-z0-9._-], others as uppercase %HH.
 */
export function encodeKeyPart(s: string): string {
  const bytes = Buffer.from(s, 'utf8')
  let out = ''
  for (const b of bytes) {
    const ch = String.fromCharCode(b)
    out += KEEP.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/**
 * Builds a WorkItem logical key for directory aggregates.
 */
export function wiAggregateKey(
  kind: 'feature' | 'issue' | 'refactor' | 'goal',
  sourceKey: string,
): string {
  return `wi:${kind}:${encodeKeyPart(sourceKey)}`
}

/**
 * Builds a roadmap goal logical key.
 */
export function wiRoadmapKey(roadmapSlug: string): string {
  return `wi:roadmap:${encodeKeyPart(roadmapSlug)}`
}

/**
 * Builds an unbound roadmap-item logical key.
 */
export function wiRoadmapItemKey(roadmapSlug: string, itemSlug: string): string {
  return `wi:roadmap-item:${encodeKeyPart(roadmapSlug)}:${encodeKeyPart(itemSlug)}`
}

/**
 * Builds a Knowledge logical key.
 */
export function knKey(category: MappingCategory, sourceKey: string): string {
  return `kn:${encodeKeyPart(category)}:${encodeKeyPart(sourceKey)}`
}

/**
 * Builds a RoleProfile logical key.
 */
export function rpKey(profileName: string): string {
  return `rp:${encodeKeyPart(profileName)}`
}

/**
 * Canonical mapping entry sort key components.
 */
export function mappingSortKey(
  category: string,
  sourceKey: string,
  locator?: SourceLocator | null,
): string {
  return `${category}\0${sourceKey}\0${sha256Canonical(locator ?? null)}`
}

/**
 * Sorts mapping-like entries by (category, source_key, RFC8785(locator)).
 */
export function sortByMappingIdentity<
  T extends { category: string; source_key: string; source_locator?: SourceLocator },
>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    compareUtf8(
      mappingSortKey(a.category, a.source_key, a.source_locator),
      mappingSortKey(b.category, b.source_key, b.source_locator),
    ),
  )
}

/**
 * Computes migration fingerprint and id from identity fields.
 */
export function computeFingerprint(input: {
  from: MigrationFrom
  adapter_id: string
  source_manifest_sha256: string
  decisions_sha256: string
  plan_version?: number
}): { fingerprint: string; migration_id: string } {
  const fingerprint = sha256Canonical({
    plan_version: input.plan_version ?? 1,
    from: input.from,
    adapter_id: input.adapter_id,
    source_manifest_sha256: input.source_manifest_sha256,
    decisions_sha256: input.decisions_sha256,
  })
  return {
    fingerprint,
    migration_id: `mig-${input.from}-${fingerprint.slice(0, 24)}`,
  }
}

/**
 * Assigns WI-/KN- IDs by UTF-8 key order with independent 1-based counters.
 */
export function assignIds(plan: MigrationPlan, applyInstant: string): MaterializationPlan {
  const applyDate = applyInstant.slice(0, 10).replace(/-/g, '')
  const wiKeys = sortUniqueUtf8(plan.work_items.map((w) => w.target_key))
  const knKeys = sortUniqueUtf8(plan.knowledge.map((k) => k.target_key))
  if (wiKeys.length > 999 || knKeys.length > 999) {
    throw new MigrationError('migration_validation_failed', {
      detail: {
        code: 'migration_validation_failed',
        message_code: 'migration_validation_failed',
        refs: ['assignIds:capacity'],
      },
    })
  }
  const keyToId: Record<string, string> = {}
  wiKeys.forEach((key, i) => {
    keyToId[key] = `WI-${applyDate}-${String(i + 1).padStart(3, '0')}`
  })
  knKeys.forEach((key, i) => {
    keyToId[key] = `KN-${applyDate}-${String(i + 1).padStart(3, '0')}`
  })

  const work_items = plan.work_items.map((w) => {
    const id = keyToId[w.target_key]
    if (!id) {
      throw new MigrationError('migration_validation_failed', {
        detail: {
          code: 'migration_validation_failed',
          message_code: 'migration_validation_failed',
          refs: [w.target_key],
        },
      })
    }
    const depends_on = sortUniqueUtf8(
      w.depends_on_keys.map((k) => {
        const depId = keyToId[k]
        if (!depId) {
          throw new MigrationError('migration_dependency_invalid', {
            detail: {
              code: 'migration_dependency_invalid',
              message_code: 'migration_dependency_invalid',
              refs: [w.target_key, k],
            },
          })
        }
        return depId
      }),
    )
    return { ...w, id, depends_on }
  })

  const knowledge = plan.knowledge.map((k) => {
    const id = keyToId[k.target_key]
    if (!id) {
      throw new MigrationError('migration_validation_failed', {
        detail: {
          code: 'migration_validation_failed',
          message_code: 'migration_validation_failed',
          refs: [k.target_key],
        },
      })
    }
    return { ...k, id }
  })

  return {
    apply_date: applyDate,
    apply_instant: applyInstant,
    work_items,
    knowledge,
    profiles: plan.profiles,
    key_to_id: keyToId,
  }
}

/**
 * Formats applyInstant as UTC millisecond ISO (from Date or ISO string).
 */
export function captureApplyInstant(now: Date = new Date()): string {
  const iso = now.toISOString()
  // Ensure millisecond precision
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) return iso
  const d = new Date(iso)
  return d.toISOString()
}

/**
 * Normalizes date-only or RFC3339 to UTC millisecond ISO.
 */
export function normalizeCreated(raw: string): string {
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`
  }
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) {
    throw new MigrationError('migration_semantic_fidelity_failed', {
      detail: {
        code: 'migration_semantic_fidelity_failed',
        message_code: 'migration_semantic_fidelity_failed',
        refs: [`created:${trimmed}`],
      },
    })
  }
  return d.toISOString()
}

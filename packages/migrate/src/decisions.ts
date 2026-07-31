/**
 * --decisions YAML parser (D8a).
 */

import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { sha256Canonical, sortUniqueUtf8 } from './canonical.ts'
import { sortByMappingIdentity } from './keys.ts'
import type { DecisionEntry, MappingCategory, MigrationDecisions, SourceLocator } from './types.ts'
import { MigrationError } from './types.ts'

const CATEGORIES = new Set<MappingCategory>([
  'feature',
  'issue',
  'refactor',
  'goal',
  'roadmap',
  'roadmap-item',
  'adr',
  'compound',
  'attention-rule',
  'superpowers-profile',
  'superpowers-note',
])

const EMPTY: MigrationDecisions = { version: 1, entries: [] }

/**
 * Empty decisions object (digest-stable).
 */
export function emptyDecisions(): MigrationDecisions {
  return { version: 1, entries: [] }
}

/**
 * Digests decisions with RFC8785 after canonical normalization.
 */
export function decisionsDigest(decisions: MigrationDecisions): string {
  return sha256Canonical(normalizeDecisions(decisions))
}

/**
 * Loads decisions from a YAML file path, or returns empty when path is undefined.
 */
export async function loadDecisions(path: string | undefined): Promise<{
  decisions: MigrationDecisions
  digest: string
}> {
  if (!path) {
    const decisions = emptyDecisions()
    return { decisions, digest: decisionsDigest(decisions) }
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new MigrationError('migration_io_failed', {
      detail: {
        code: 'migration_io_failed',
        message_code: 'migration_io_failed',
        refs: [path.split('\\').join('/')],
      },
    })
  }
  const decisions = parseDecisionsYaml(text)
  return { decisions, digest: decisionsDigest(decisions) }
}

/**
 * Parses and validates decisions YAML text.
 */
export function parseDecisionsYaml(text: string): MigrationDecisions {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:yaml'],
      },
    })
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:root'],
      },
    })
  }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['version', 'entries'])
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new MigrationError('migration_skip_invalid', {
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: [`decisions:unknown:${key}`],
        },
      })
    }
  }
  if (obj.version !== 1) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:version'],
      },
    })
  }
  if (!Array.isArray(obj.entries)) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:entries'],
      },
    })
  }
  const entries = obj.entries.map((e, i) => parseEntry(e, i))
  const sorted = sortByMappingIdentity(
    entries.map((e) => ({
      category: e.ref.category,
      source_key: e.ref.source_key,
      source_locator: e.ref.source_locator,
      entry: e,
    })),
  ).map((x) => x.entry)
  // duplicate canonical refs
  const seen = new Set<string>()
  for (const e of sorted) {
    const k = `${e.ref.category}\0${e.ref.source_key}\0${sha256Canonical(e.ref.source_locator ?? null)}`
    if (seen.has(k)) {
      throw new MigrationError('migration_skip_invalid', {
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: ['decisions:duplicate-ref', e.ref.source_key],
        },
      })
    }
    seen.add(k)
  }
  return normalizeDecisions({ version: 1, entries: sorted })
}

function normalizeDecisions(d: MigrationDecisions): MigrationDecisions {
  const entries = sortByMappingIdentity(
    d.entries.map((e) => ({
      category: e.ref.category,
      source_key: e.ref.source_key,
      source_locator: e.ref.source_locator,
      entry: {
        ref: {
          category: e.ref.category,
          source_key: e.ref.source_key,
          ...(e.ref.source_locator ? { source_locator: e.ref.source_locator } : {}),
        },
        action: 'skip' as const,
        reason: e.reason.trim(),
        approved_by: e.approved_by.trim(),
        approved_at: e.approved_at,
      },
    })),
  ).map((x) => x.entry)
  return { version: 1, entries }
}

function parseEntry(raw: unknown, index: number): DecisionEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: [`decisions:entry:${index}`],
      },
    })
  }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['ref', 'action', 'reason', 'approved_by', 'approved_at'])
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new MigrationError('migration_skip_invalid', {
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: [`decisions:entry-unknown:${key}`],
        },
      })
    }
  }
  if (obj.action !== 'skip') {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: [`decisions:action:${String(obj.action)}`],
      },
    })
  }
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : ''
  const approved_by = typeof obj.approved_by === 'string' ? obj.approved_by.trim() : ''
  if (!reason || !approved_by) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:empty-fields'],
      },
    })
  }
  const approved_at = normalizeApprovedAt(obj.approved_at)
  const ref = parseRef(obj.ref, index)
  return { ref, action: 'skip', reason, approved_by, approved_at }
}

function parseRef(raw: unknown, index: number): DecisionEntry['ref'] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: [`decisions:ref:${index}`],
      },
    })
  }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['category', 'source_key', 'source_locator'])
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new MigrationError('migration_skip_invalid', {
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: [`decisions:ref-unknown:${key}`],
        },
      })
    }
  }
  if (typeof obj.category !== 'string' || !CATEGORIES.has(obj.category as MappingCategory)) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: [`decisions:category:${String(obj.category)}`],
      },
    })
  }
  if (typeof obj.source_key !== 'string' || obj.source_key.length === 0) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:source_key'],
      },
    })
  }
  let source_locator: SourceLocator | undefined
  if (obj.source_locator !== undefined) {
    if (
      obj.source_locator === null ||
      typeof obj.source_locator !== 'object' ||
      Array.isArray(obj.source_locator)
    ) {
      throw new MigrationError('migration_skip_invalid', {
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: ['decisions:locator'],
        },
      })
    }
    const loc = obj.source_locator as Record<string, unknown>
    if (typeof loc.roadmap_slug !== 'string' || typeof loc.item_slug !== 'string') {
      throw new MigrationError('migration_skip_invalid', {
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: ['decisions:locator-fields'],
        },
      })
    }
    source_locator = {
      roadmap_slug: loc.roadmap_slug,
      item_slug: loc.item_slug,
    }
  }
  if (obj.category === 'roadmap-item' && !source_locator) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:locator-required'],
      },
    })
  }
  if (obj.category !== 'roadmap-item' && source_locator) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:locator-forbidden'],
      },
    })
  }
  return {
    category: obj.category as MappingCategory,
    source_key: obj.source_key,
    ...(source_locator ? { source_locator } : {}),
  }
}

function normalizeApprovedAt(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:approved_at'],
      },
    })
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    throw new MigrationError('migration_skip_invalid', {
      detail: {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: ['decisions:approved_at'],
      },
    })
  }
  return d.toISOString()
}

/** Exported for tests / unused-ref avoidance. */
export function decisionRefsSorted(decisions: MigrationDecisions): string[] {
  return sortUniqueUtf8(
    decisions.entries.map(
      (e) =>
        `${e.ref.category}:${e.ref.source_key}:${sha256Canonical(e.ref.source_locator ?? null)}`,
    ),
  )
}

export { EMPTY as EMPTY_DECISIONS }

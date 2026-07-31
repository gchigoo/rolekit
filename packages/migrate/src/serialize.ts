/**
 * Canonical YAML writers for migrated WorkItem and RoleProfile (D9/D12c).
 */

import type { RoleProfile, WorkItem } from '@rolekit/core'
import { validateArtifact } from '@rolekit/core'
import { parse as parseYaml } from 'yaml'
import { compareUtf8 } from './canonical.ts'
import { MigrationError } from './types.ts'

/**
 * Serializes an initial migrated WorkItem with fixed key order and LF ending.
 */
export function serializeMigratedWorkItem(item: WorkItem): string {
  const keys: Array<keyof WorkItem> = [
    'schema',
    'id',
    'kind',
    'title',
    'status',
    'gate',
    'gate_log',
    'lane',
    'lane_reason',
    'lane_overrides',
    'depends_on',
    'runs',
    'created',
    'updated',
  ]
  const lines: string[] = []
  for (const key of keys) {
    const value = item[key]
    if (key === 'depends_on') {
      const deps = [...(value as string[])].sort(compareUtf8)
      if (deps.length === 0) {
        lines.push('depends_on: []')
      } else {
        lines.push('depends_on:')
        for (const d of deps) {
          lines.push(`  - ${jsonString(d)}`)
        }
      }
      continue
    }
    if (key === 'gate_log' || key === 'lane_overrides' || key === 'runs') {
      lines.push(`${key}: []`)
      continue
    }
    if (value === null) {
      lines.push(`${key}: null`)
      continue
    }
    if (typeof value === 'string') {
      lines.push(`${key}: ${jsonString(value)}`)
      continue
    }
    // schema / kind / status are plain identifiers
    lines.push(`${key}: ${String(value)}`)
  }
  const text = `${lines.join('\n')}\n`
  const reparsed = parseYaml(text) as WorkItem
  if (!deepEqual(reparsed, normalizeWi(item))) {
    throw new MigrationError('migration_validation_failed', {
      detail: {
        code: 'migration_validation_failed',
        message_code: 'migration_validation_failed',
        refs: [item.id, 'wi-roundtrip'],
      },
    })
  }
  const result = validateArtifact('rolekit/work-item@1', reparsed)
  if (!result.valid) {
    throw new MigrationError('migration_validation_failed', {
      detail: {
        code: 'migration_validation_failed',
        message_code: 'migration_validation_failed',
        refs: [item.id, 'wi-validate'],
      },
    })
  }
  return text
}

/**
 * Serializes a migrated RoleProfile with fixed key order.
 */
export function serializeMigratedRoleProfile(profile: RoleProfile): string {
  const order = [
    'schema',
    'name',
    'capabilities',
    'boundaries',
    'deliverables',
    'verification',
    'prompt_fragments',
  ] as const
  const lines: string[] = []
  for (const key of order) {
    const value = profile[key]
    if (typeof value === 'string') {
      lines.push(`${key}: ${jsonString(value)}`)
      continue
    }
    const arr = value as string[]
    if (arr.length === 0) {
      lines.push(`${key}: []`)
    } else {
      lines.push(`${key}:`)
      for (const item of arr) {
        lines.push(`  - ${jsonString(item)}`)
      }
    }
  }
  const text = `${lines.join('\n')}\n`
  const reparsed = parseYaml(text) as RoleProfile
  if (!deepEqual(reparsed, profile)) {
    throw new MigrationError('migration_validation_failed', {
      detail: {
        code: 'migration_validation_failed',
        message_code: 'migration_validation_failed',
        refs: [profile.name, 'rp-roundtrip'],
      },
    })
  }
  const result = validateArtifact('rolekit/role-profile@1', reparsed)
  if (!result.valid) {
    throw new MigrationError('migration_validation_failed', {
      detail: {
        code: 'migration_validation_failed',
        message_code: 'migration_validation_failed',
        refs: [profile.name, 'rp-validate'],
      },
    })
  }
  return text
}

function jsonString(s: string): string {
  return JSON.stringify(s)
}

function normalizeWi(item: WorkItem): WorkItem {
  return {
    ...item,
    depends_on: [...item.depends_on].sort(compareUtf8),
    gate_log: [],
    lane_overrides: [],
    runs: [],
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

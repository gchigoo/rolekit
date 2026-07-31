/**
 * Migration bundle + report.md writers (D10/D10a).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compareUtf8,
  serializeCanonicalJson,
  sha256Canonical,
  sha256Text,
  sortUniqueUtf8,
} from './canonical.ts'
import { sortByMappingIdentity } from './keys.ts'
import type {
  DiscardedRecord,
  ErrorDetail,
  ErrorDetailEntry,
  MappingEntry,
  MigrationCounts,
  MigrationFrom,
  ProvenanceRecord,
  Receipt,
  ReportError,
  ReportJson,
  SemanticDiff,
  SourceManifest,
  TargetManifest,
} from './types.ts'

export interface BundleInput {
  migration_id: string
  from: MigrationFrom
  mode: 'audit' | 'apply'
  status: 'succeeded' | 'failed'
  adapter_id: string
  plan_version: number
  source_manifest: SourceManifest
  source_manifest_sha256: string
  decisions_sha256: string
  fingerprint: string
  entries: MappingEntry[]
  provenance: ProvenanceRecord[]
  discarded: DiscardedRecord[]
  errors: Array<{
    code: ReportError['code']
    category: string | null
    source_key: string | null
    source_locator?: ReportError['source_locator']
    detail: ErrorDetail
  }>
  semantic_diff: SemanticDiff
  target_manifest?: TargetManifest
  receipt?: Receipt
  licenseText?: string
  counts: MigrationCounts
}

/**
 * Builds closed error-details envelope from report errors.
 */
export function buildErrorDetails(errors: BundleInput['errors']): {
  envelope: { version: 1; entries: ErrorDetailEntry[] }
  bySha: Map<string, ErrorDetail>
} {
  const bySha = new Map<string, ErrorDetail>()
  for (const e of errors) {
    const sha = sha256Canonical(e.detail)
    bySha.set(sha, e.detail)
  }
  const entries = [...bySha.entries()]
    .map(([detail_sha256, detail]) => ({ detail_sha256, detail }))
    .sort((a, b) => compareUtf8(a.detail_sha256, b.detail_sha256))
  return { envelope: { version: 1, entries }, bySha }
}

/**
 * Builds report.errors with detail_sha256 links.
 */
export function buildReportErrors(errors: BundleInput['errors']): ReportError[] {
  const list = errors.map((e) => ({
    code: e.code,
    category: e.category,
    source_key: e.source_key,
    ...(e.source_locator ? { source_locator: e.source_locator } : {}),
    detail_sha256: sha256Canonical(e.detail),
  }))
  return list.sort((a, b) =>
    compareUtf8(
      `${a.code}\0${a.category ?? ''}\0${a.source_key ?? ''}\0${sha256Canonical(a.source_locator ?? null)}`,
      `${b.code}\0${b.category ?? ''}\0${b.source_key ?? ''}\0${sha256Canonical(b.source_locator ?? null)}`,
    ),
  )
}

/**
 * Writes a complete MigrationBundle directory (canonical JSON, no trailing NL).
 */
export async function writeMigrationBundle(
  dir: string,
  input: BundleInput,
): Promise<{
  reportPath: string
  mappingSha: string
  semanticSha: string
  targetManifestSha: string | null
}> {
  await mkdir(dir, { recursive: true })
  const mapping = {
    version: 1 as const,
    entries: sortByMappingIdentity(input.entries),
  }
  const { envelope: errorDetails } = buildErrorDetails(input.errors)
  const report: ReportJson = {
    version: 1,
    migration_id: input.migration_id,
    from: input.from,
    mode: input.mode,
    status: input.status,
    adapter_id: input.adapter_id,
    plan_version: input.plan_version,
    source_manifest_sha256: input.source_manifest_sha256,
    decisions_sha256: input.decisions_sha256,
    fingerprint: input.fingerprint,
    counts: input.counts,
    provenance: sortProvenance(input.provenance),
    discarded: sortDiscarded(input.discarded),
    errors: buildReportErrors(input.errors),
  }

  const mappingBytes = serializeCanonicalJson(mapping)
  const semanticBytes = serializeCanonicalJson(input.semantic_diff)
  const mappingSha = sha256Canonical(mapping)
  const semanticSha = sha256Canonical(input.semantic_diff)

  await writeFile(join(dir, 'source-manifest.json'), serializeCanonicalJson(input.source_manifest))
  await writeFile(join(dir, 'mapping.json'), mappingBytes)
  await writeFile(join(dir, 'semantic-diff.json'), semanticBytes)
  await writeFile(join(dir, 'error-details.json'), serializeCanonicalJson(errorDetails))
  await writeFile(join(dir, 'report.json'), serializeCanonicalJson(report))
  await writeFile(join(dir, 'report.md'), renderReportMd(report, input.errors), 'utf8')

  let targetManifestSha: string | null = null
  if (input.target_manifest) {
    const bytes = serializeCanonicalJson(input.target_manifest)
    targetManifestSha = sha256Text(bytes.toString('utf8'))
    await writeFile(join(dir, 'target-manifest.json'), bytes)
  }
  if (input.receipt) {
    await writeFile(join(dir, 'receipt.json'), serializeCanonicalJson(input.receipt))
  }
  if (input.licenseText !== undefined) {
    await mkdir(join(dir, 'licenses'), { recursive: true })
    await writeFile(join(dir, 'licenses', 'superpowers-MIT.txt'), input.licenseText, 'utf8')
  }

  return {
    reportPath: join(dir, 'report.json'),
    mappingSha,
    semanticSha,
    targetManifestSha,
  }
}

/**
 * Human-readable report.md (LF).
 */
export function renderReportMd(report: ReportJson, errors: BundleInput['errors']): string {
  const lines: string[] = [
    `# Migration report ${report.migration_id}`,
    '',
    `- from: ${report.from}`,
    `- mode: ${report.mode}`,
    `- status: ${report.status}`,
    `- adapter_id: ${report.adapter_id}`,
    `- fingerprint: ${report.fingerprint}`,
    '',
    '## Counts',
    '',
    `- discovered: ${report.counts.discovered}`,
    `- migrated: ${report.counts.migrated}`,
    `- merged: ${report.counts.merged}`,
    `- skipped: ${report.counts.skipped}`,
    `- evidence: ${report.counts.evidence}`,
    `- discarded: ${report.counts.discarded}`,
    `- failed: ${report.counts.failed}`,
    '',
    '## Mandatory by category',
    '',
    '| category | discovered | migrated | merged | skipped | failed |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const row of report.counts.mandatory_by_category) {
    lines.push(
      `| ${row.category} | ${row.discovered} | ${row.migrated} | ${row.merged} | ${row.skipped} | ${row.failed} |`,
    )
  }
  lines.push('', '## Errors', '')
  lines.push('| code | category | key | locator | message_code |')
  lines.push('| --- | --- | --- | --- | --- |')
  const sorted = buildReportErrors(errors)
  for (const e of sorted) {
    const loc = e.source_locator
      ? `${e.source_locator.roadmap_slug}/${e.source_locator.item_slug}`
      : ''
    lines.push(`| ${e.code} | ${e.category ?? ''} | ${e.source_key ?? ''} | ${loc} | ${e.code} |`)
  }
  lines.push('')
  return `${lines.join('\n')}`
}

function sortProvenance(rows: ProvenanceRecord[]): ProvenanceRecord[] {
  return [...rows].sort((a, b) =>
    compareUtf8(
      `${a.source_path}\0${a.role}\0${a.owner_source_key ?? ''}`,
      `${b.source_path}\0${b.role}\0${b.owner_source_key ?? ''}`,
    ),
  )
}

function sortDiscarded(rows: DiscardedRecord[]): DiscardedRecord[] {
  return [...rows].sort((a, b) =>
    compareUtf8(
      `${a.source_path}\0${a.heading ?? ''}\0${a.reason}`,
      `${b.source_path}\0${b.heading ?? ''}\0${b.reason}`,
    ),
  )
}

/**
 * Builds mandatory_by_category rows for a closed category list.
 */
export function buildMandatoryCounts(
  categories: readonly string[],
  entries: MappingEntry[],
): MigrationCounts {
  const mandatory_by_category = categories.map((category) => {
    const rows = entries.filter((e) => e.category === category)
    const migrated = rows.filter((e) => e.action === 'migrate').length
    const merged = rows.filter((e) => e.action === 'merge').length
    const skipped = rows.filter((e) => e.action === 'skip').length
    const failed = rows.filter((e) => e.action === 'error').length
    return {
      category: category as MappingEntry['category'],
      discovered: migrated + merged + skipped + failed,
      migrated,
      merged,
      skipped,
      failed,
    }
  })
  const migrated = entries.filter((e) => e.action === 'migrate').length
  const merged = entries.filter((e) => e.action === 'merge').length
  const skipped = entries.filter((e) => e.action === 'skip').length
  const failed = entries.filter((e) => e.action === 'error').length
  return {
    discovered: migrated + merged + skipped + failed,
    migrated,
    merged,
    skipped,
    evidence: 0,
    discarded: 0,
    failed,
    mandatory_by_category,
  }
}

/** Utility re-export for callers filling evidence/discarded. */
export function withInventoryCounts(
  counts: MigrationCounts,
  evidence: number,
  discarded: number,
): MigrationCounts {
  return { ...counts, evidence, discarded }
}

export function emptySemanticDiff(): SemanticDiff {
  return { version: 1, entries: [] }
}

export { sortUniqueUtf8 }

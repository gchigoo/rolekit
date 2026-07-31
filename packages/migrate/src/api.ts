/**
 * Public auditMigration / applyMigration entrypoints.
 */

import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sha256Canonical, sha256Text, sortUniqueUtf8 } from './canonical.ts'
import { loadDecisions } from './decisions.ts'
import { assignIds, captureApplyInstant, computeFingerprint } from './keys.ts'
import { promoteMigration } from './promote.ts'
import { buildMandatoryCounts, withInventoryCounts, writeMigrationBundle } from './report.ts'
import { assertPathOutsideSource, buildSourceManifest } from './safety.ts'
import type { MigrationFrom, MigrationPlan, ReportPointer, SourceAdapter } from './types.ts'
import { MigrationError } from './types.ts'

export interface MigrateOptions {
  from: MigrationFrom
  sourceRoot: string
  targetRoot: string
  decisionsPath?: string
  reportDir?: string
  auditOnly?: boolean
  adapter: SourceAdapter
  now?: Date
}

export interface MigrateSuccess {
  migration: {
    id: string
    from: MigrationFrom
    mode: 'audit' | 'apply'
    status: 'succeeded'
    source_manifest_sha256: string
    target?: string
    report: ReportPointer
    counts: ReturnType<typeof withInventoryCounts>
    no_op: boolean
  }
}

/**
 * Runs audit-only or apply migration against a source adapter.
 */
export async function runMigration(options: MigrateOptions): Promise<MigrateSuccess> {
  const targetRoot = resolve(options.targetRoot)
  const sourceRoot = resolve(options.sourceRoot)
  const auditOnly = options.auditOnly === true
  const applyInstant = captureApplyInstant(options.now)

  await options.adapter.detect(sourceRoot)
  const { decisions, digest: decisionsSha } = await loadDecisions(options.decisionsPath)

  const { manifest, digest: sourceSha } = await buildSourceManifest(
    sourceRoot,
    (await options.adapter.detect(sourceRoot)).adapter_id,
  )
  const detected = await options.adapter.detect(sourceRoot)
  const { fingerprint, migration_id } = computeFingerprint({
    from: options.from,
    adapter_id: detected.adapter_id,
    source_manifest_sha256: sourceSha,
    decisions_sha256: decisionsSha,
  })

  const reportDir = resolve(options.reportDir ?? join(targetRoot, '.rolekit-migration-audits'))
  await assertPathOutsideSource(sourceRoot, targetRoot, 'target')
  await assertPathOutsideSource(sourceRoot, reportDir, 'report-dir')

  const scanned = await options.adapter.scan(sourceRoot, manifest)
  const plan: MigrationPlan = options.adapter.map(scanned.entities, decisions, {
    adapter_id: detected.adapter_id,
    source_manifest_sha256: sourceSha,
    decisions_sha256: decisionsSha,
    source_root: sourceRoot,
    manifest,
    provenance: scanned.provenance,
    discarded: scanned.discarded,
  })

  const counts = withInventoryCounts(
    buildMandatoryCounts(mandatoryCategories(options.from), plan.entries),
    plan.provenance.length,
    plan.discarded.length,
  )

  if (auditOnly) {
    const bundleDir = join(reportDir, migration_id)
    await mkdir(bundleDir, { recursive: true })
    const auditEntries = plan.entries.map((e) => ({
      ...e,
      target_id: null as string | null,
    }))
    await writeMigrationBundle(bundleDir, {
      migration_id,
      from: options.from,
      mode: 'audit',
      status: plan.has_errors ? 'failed' : 'succeeded',
      adapter_id: detected.adapter_id,
      plan_version: 1,
      source_manifest: manifest,
      source_manifest_sha256: sourceSha,
      decisions_sha256: decisionsSha,
      fingerprint,
      entries: auditEntries,
      provenance: plan.provenance,
      discarded: plan.discarded,
      errors: plan.errors,
      semantic_diff: buildAuditSemanticDiff(plan, auditEntries),
      counts,
    })
    // source-after for audit
    const after = await buildSourceManifest(sourceRoot, detected.adapter_id)
    if (after.digest !== sourceSha) {
      throw new MigrationError('migration_source_changed', {
        migration_id,
        detail: {
          code: 'migration_source_changed',
          message_code: 'migration_source_changed',
          refs: ['source-after'],
        },
        report: { base: 'report-dir', path: `${migration_id}/report.json` },
      })
    }
    if (plan.has_errors) {
      throw new MigrationError(plan.errors[0]?.code ?? 'migration_validation_failed', {
        migration_id,
        detail: plan.errors[0]?.detail,
        issues: plan.errors.map((e) => e.detail),
        report: { base: 'report-dir', path: `${migration_id}/report.json` },
      })
    }
    return {
      migration: {
        id: migration_id,
        from: options.from,
        mode: 'audit',
        status: 'succeeded',
        source_manifest_sha256: sourceSha,
        report: { base: 'report-dir', path: `${migration_id}/report.json` },
        counts,
        no_op: false,
      },
    }
  }

  // apply: plan errors fail before lock/staging, no new disk report
  if (plan.has_errors) {
    const existingAudit = join(reportDir, migration_id, 'report.json')
    let report: ReportPointer | undefined
    try {
      const { stat } = await import('node:fs/promises')
      await stat(existingAudit)
      report = { base: 'report-dir', path: `${migration_id}/report.json` }
    } catch {
      report = undefined
    }
    throw new MigrationError(plan.errors[0]?.code ?? 'migration_validation_failed', {
      migration_id,
      detail: plan.errors[0]?.detail,
      issues: plan.errors.map((e) => e.detail),
      ...(report ? { report } : {}),
    })
  }

  const materialization = assignIds(plan, applyInstant)
  let licenseText: string | undefined
  if (options.from === 'superpowers') {
    const { readFile } = await import('node:fs/promises')
    licenseText = await readFile(join(sourceRoot, 'LICENSE'), 'utf8')
  }

  const promoted = await promoteMigration({
    targetRoot,
    migrationId: migration_id,
    plan,
    materialization,
    sourceRoot,
    sourceManifestShaBefore: sourceSha,
    licenseText,
  })

  return {
    migration: {
      id: migration_id,
      from: options.from,
      mode: 'apply',
      status: 'succeeded',
      source_manifest_sha256: sourceSha,
      target: '.rolekit',
      report: promoted.report,
      counts,
      no_op: promoted.no_op,
    },
  }
}

function mandatoryCategories(from: MigrationFrom): readonly string[] {
  if (from === 'codestable') {
    return [
      'feature',
      'issue',
      'refactor',
      'goal',
      'roadmap',
      'roadmap-item',
      'adr',
      'compound',
      'attention-rule',
    ]
  }
  return ['superpowers-profile', 'superpowers-note']
}

export { sha256Canonical }

function buildAuditSemanticDiff(
  plan: MigrationPlan,
  entries: MigrationPlan['entries'],
): import('./types.ts').SemanticDiff {
  const workByKey = new Map(plan.work_items.map((w) => [w.target_key, w]))
  const knByKey = new Map(plan.knowledge.map((k) => [k.target_key, k]))
  return {
    version: 1,
    entries: entries.map((e) => {
      const key = e.target_key ?? e.merge_into
      const details = e.assertions.map((a) => {
        if (a.id === 'error') {
          return {
            id: 'error',
            passed: false,
            expected_sha256: null,
            actual_sha256: null,
            code:
              plan.errors.find(
                (err) => err.source_key === e.source_key && err.category === e.category,
              )?.code ?? 'migration_semantic_fidelity_failed',
          }
        }
        if (a.id === 'skip_reason') {
          const reasonSha = sha256Canonical(e.skip_reason ?? null)
          return {
            id: 'skip_reason',
            passed: true,
            expected_sha256: reasonSha,
            actual_sha256: reasonSha,
            code: 'ok',
          }
        }
        let projection: unknown = {
          category: e.category,
          action: e.action,
          source_digest: e.source_digest,
          target_key: e.target_key ?? null,
          merge_into: e.merge_into ?? null,
        }
        if (key && workByKey.has(key)) {
          const w = workByKey.get(key)!
          projection = {
            kind: w.kind,
            title: w.title,
            status: w.status,
            depends_on: sortUniqueUtf8(w.depends_on_keys),
          }
        } else if (key && knByKey.has(key)) {
          const k = knByKey.get(key)!
          projection = {
            type: k.type,
            title: k.title,
            status: k.status,
            tags: k.tags,
            created: k.created,
            source: k.source,
            body_sha256: sha256Text(k.body),
          }
        }
        const sha = sha256Canonical(projection)
        return {
          id: 'projection',
          passed: true,
          expected_sha256: sha,
          actual_sha256: sha,
          code: 'ok',
        }
      })
      return {
        category: e.category,
        source_key: e.source_key,
        target_id: null,
        details,
      }
    }),
  }
}

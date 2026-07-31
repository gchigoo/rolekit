/**
 * Fresh-target staging materialize + validate + directory rename promote (D9).
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type KnowledgeEntry,
  type RoleProfile,
  serializeKnowledgeDocument,
  validateArtifact,
  type WorkItem,
} from '@rolekit/core'
import {
  compareUtf8,
  serializeCanonicalJson,
  sha256Buffer,
  sha256Canonical,
  sha256Text,
  sortUniqueUtf8,
} from './canonical.ts'
import { acquireMigrateLock } from './lock.ts'
import {
  buildErrorDetails,
  buildMandatoryCounts,
  emptySemanticDiff,
  withInventoryCounts,
  writeMigrationBundle,
} from './report.ts'
import { buildSourceManifest } from './safety.ts'
import { serializeMigratedRoleProfile, serializeMigratedWorkItem } from './serialize.ts'
import type {
  MaterializationPlan,
  MigrationPlan,
  Receipt,
  ReportPointer,
  TargetManifest,
} from './types.ts'
import { MigrationError } from './types.ts'

export interface PromoteOptions {
  targetRoot: string
  migrationId: string
  plan: MigrationPlan
  materialization: MaterializationPlan
  sourceRoot: string
  sourceManifestShaBefore: string
  licenseText?: string
}

export interface PromoteResult {
  no_op: boolean
  report: ReportPointer
  target_manifest_sha256: string
  mapping_sha256: string
  semantic_diff_sha256: string
  receipt: Receipt
}

/**
 * Applies a validated plan into a fresh target via staging rename.
 */
export async function promoteMigration(options: PromoteOptions): Promise<PromoteResult> {
  const {
    targetRoot,
    migrationId,
    plan,
    materialization,
    sourceRoot,
    sourceManifestShaBefore,
    licenseText,
  } = options

  if (plan.has_errors) {
    throw new MigrationError('migration_validation_failed', {
      migration_id: migrationId,
      issues: plan.errors.map((e) => e.detail),
      detail: plan.errors[0]?.detail,
    })
  }

  const formal = join(targetRoot, '.rolekit')
  if (await exists(formal)) {
    const noop = await tryNoOp(formal, migrationId, plan)
    if (noop) return noop
    throw new MigrationError('migration_target_exists', {
      migration_id: migrationId,
      detail: {
        code: 'migration_target_exists',
        message_code: 'migration_target_exists',
        refs: ['.rolekit'],
      },
    })
  }

  await assertNoConflictingStaging(targetRoot, migrationId)

  const lock = await acquireMigrateLock(targetRoot)
  try {
    // re-check under lock
    if (await exists(formal)) {
      const noop = await tryNoOp(formal, migrationId, plan)
      if (noop) return noop
      throw new MigrationError('migration_target_exists', {
        migration_id: migrationId,
        detail: {
          code: 'migration_target_exists',
          message_code: 'migration_target_exists',
          refs: ['.rolekit'],
        },
      })
    }

    const stagingRoot = join(targetRoot, `.rolekit.migrate-${migrationId}.tmp`)
    if (await exists(stagingRoot)) {
      // same fingerprint orphan: remove and rebuild
      await rm(stagingRoot, { recursive: true, force: true })
    }
    await mkdir(stagingRoot, { recursive: true })

    try {
      await materializeTree(stagingRoot, materialization)
      const semantic = buildSemanticDiff(plan, materialization)
      await validateTree(stagingRoot, materialization)

      const counts = withInventoryCounts(
        buildMandatoryCounts(mandatoryCategories(plan.from), plan.entries),
        plan.provenance.length,
        plan.discarded.length,
      )
      const fp = sha256Canonical({
        plan_version: 1,
        from: plan.from,
        adapter_id: plan.adapter_id,
        source_manifest_sha256: plan.source_manifest_sha256,
        decisions_sha256: plan.decisions_sha256,
      })
      const migration_id = migrationId
      const migDir = join(stagingRoot, 'migrations', migrationId)

      // source-after before bundle: fail without staging report pointer (D2a)
      const { digest: afterDigest, manifest: afterManifest } = await buildSourceManifest(
        sourceRoot,
        plan.adapter_id,
      )
      if (afterDigest !== sourceManifestShaBefore) {
        throw new MigrationError('migration_source_changed', {
          migration_id: migrationId,
          detail: {
            code: 'migration_source_changed',
            message_code: 'migration_source_changed',
            refs: ['source-after'],
          },
        })
      }

      // Bundle first (without target-manifest/receipt); then manifest covers bundle files.
      const written = await writeMigrationBundle(migDir, {
        migration_id,
        from: plan.from,
        mode: 'apply',
        status: 'succeeded',
        adapter_id: plan.adapter_id,
        plan_version: 1,
        source_manifest: afterManifest,
        source_manifest_sha256: plan.source_manifest_sha256,
        decisions_sha256: plan.decisions_sha256,
        fingerprint: fp,
        entries: annotateApplyIds(plan, materialization),
        provenance: plan.provenance,
        discarded: plan.discarded,
        errors: [],
        semantic_diff: semantic,
        licenseText,
        counts,
      })

      const targetManifest = await buildTargetManifest(stagingRoot)
      const targetManifestBytes = serializeCanonicalJson(targetManifest)
      const targetManifestSha = sha256Canonical(targetManifest)
      await writeFile(join(migDir, 'target-manifest.json'), targetManifestBytes)

      const receipt: Receipt = {
        version: 1,
        migration_id,
        from: plan.from,
        plan_version: 1,
        adapter_id: plan.adapter_id,
        fingerprint: fp,
        source_manifest_sha256: plan.source_manifest_sha256,
        decisions_sha256: plan.decisions_sha256,
        mapping_sha256: written.mappingSha,
        semantic_diff_sha256: written.semanticSha,
        target_manifest_sha256: targetManifestSha,
        applied_at: materialization.apply_instant,
      }
      await writeFile(join(migDir, 'receipt.json'), serializeCanonicalJson(receipt))

      try {
        await rename(stagingRoot, formal)
      } catch {
        throw new MigrationError('migration_promote_failed', {
          migration_id: migrationId,
          detail: {
            code: 'migration_promote_failed',
            message_code: 'migration_promote_failed',
            refs: [`.rolekit.migrate-${migrationId}.tmp`],
          },
          report: {
            base: 'staging',
            path: `.rolekit.migrate-${migrationId}.tmp/migrations/${migrationId}/report.json`,
          },
        })
      }

      return {
        no_op: false,
        report: {
          base: 'target',
          path: `.rolekit/migrations/${migrationId}/report.json`,
        },
        target_manifest_sha256: receipt.target_manifest_sha256,
        mapping_sha256: receipt.mapping_sha256,
        semantic_diff_sha256: receipt.semantic_diff_sha256,
        receipt,
      }
    } catch (error) {
      if (error instanceof MigrationError) throw error
      throw new MigrationError('migration_io_failed', {
        migration_id: migrationId,
        detail: {
          code: 'migration_io_failed',
          message_code: 'migration_io_failed',
          refs: ['staging'],
        },
      })
    }
  } finally {
    await lock.release()
  }
}

async function materializeTree(stagingRoot: string, mat: MaterializationPlan): Promise<void> {
  const wiDir = join(stagingRoot, 'work-items')
  const knDir = join(stagingRoot, 'knowledge')
  const rolesDir = join(stagingRoot, 'profiles', 'roles')
  await mkdir(wiDir, { recursive: true })
  await mkdir(knDir, { recursive: true })
  await mkdir(rolesDir, { recursive: true })

  for (const w of mat.work_items) {
    const item: WorkItem = {
      schema: 'rolekit/work-item@1',
      id: w.id,
      kind: w.kind,
      title: w.title,
      status: w.status as WorkItem['status'],
      gate: null,
      gate_log: [],
      lane: null,
      lane_reason: null,
      lane_overrides: [],
      depends_on: w.depends_on,
      runs: [],
      created: w.created,
      updated: mat.apply_instant,
    }
    await writeFile(join(wiDir, `${w.id}.yaml`), serializeMigratedWorkItem(item), 'utf8')
  }

  for (const k of mat.knowledge) {
    const frontmatter: KnowledgeEntry = {
      schema: 'rolekit/knowledge-entry@1',
      id: k.id,
      type: k.type,
      title: k.title,
      status: k.status,
      tags: k.tags,
      created: k.created,
      source: k.source,
    }
    const text = serializeKnowledgeDocument({ frontmatter, body: k.body })
    const result = validateArtifact('rolekit/knowledge-entry@1', {
      frontmatter,
      body: k.body,
    })
    if (!result.valid) {
      throw new MigrationError('migration_validation_failed', {
        detail: {
          code: 'migration_validation_failed',
          message_code: 'migration_validation_failed',
          refs: [k.id, 'knowledge'],
        },
      })
    }
    await writeFile(join(knDir, `${k.id}.md`), text, 'utf8')
  }

  for (const p of mat.profiles) {
    const profile: RoleProfile = {
      schema: 'rolekit/role-profile@1',
      name: p.name,
      capabilities: p.capabilities,
      boundaries: p.boundaries,
      deliverables: p.deliverables,
      verification: p.verification,
      prompt_fragments: p.prompt_fragments,
    }
    await writeFile(join(rolesDir, `${p.name}.yaml`), serializeMigratedRoleProfile(profile), 'utf8')
    for (const [rel, content] of Object.entries(p.fragment_contents)) {
      const abs = join(stagingRoot, 'profiles', rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
    }
  }
}

async function validateTree(stagingRoot: string, mat: MaterializationPlan): Promise<void> {
  for (const w of mat.work_items) {
    const text = await readFile(join(stagingRoot, 'work-items', `${w.id}.yaml`), 'utf8')
    const { parse } = await import('yaml')
    const data = parse(text)
    const r = validateArtifact('rolekit/work-item@1', data)
    if (!r.valid) {
      throw new MigrationError('migration_validation_failed', {
        detail: {
          code: 'migration_validation_failed',
          message_code: 'migration_validation_failed',
          refs: [w.id],
        },
      })
    }
  }
  // goal done invariant: if goal status done, all depends_on done
  const byId = new Map(mat.work_items.map((w) => [w.id, w]))
  for (const w of mat.work_items) {
    if (w.kind === 'goal' && w.status === 'done') {
      for (const dep of w.depends_on) {
        const d = byId.get(dep)
        if (!d || (d.status !== 'done' && d.status !== 'dropped')) {
          throw new MigrationError('migration_dependency_invalid', {
            detail: {
              code: 'migration_dependency_invalid',
              message_code: 'migration_dependency_invalid',
              refs: [w.id, dep, 'goal-done-invariant'],
            },
          })
        }
      }
    }
  }
  // cycle check
  if (hasCycle(mat.work_items.map((w) => ({ id: w.id, deps: w.depends_on })))) {
    throw new MigrationError('migration_dependency_invalid', {
      detail: {
        code: 'migration_dependency_invalid',
        message_code: 'migration_dependency_invalid',
        refs: ['cycle'],
      },
    })
  }
}

function hasCycle(nodes: Array<{ id: string; deps: string[] }>): boolean {
  const graph = new Map(nodes.map((n) => [n.id, n.deps]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const d of graph.get(id) ?? []) {
      if (dfs(d)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  for (const id of graph.keys()) {
    if (dfs(id)) return true
  }
  return false
}

async function buildTargetManifest(stagingRoot: string): Promise<TargetManifest> {
  const files: TargetManifest['files'] = []
  await walkFiles(stagingRoot, stagingRoot, files)
  files.sort((a, b) => compareUtf8(a.path, b.path))
  // exclude receipt and target-manifest themselves per D10a
  const filtered = files.filter(
    (f) => !f.path.endsWith('/receipt.json') && !f.path.endsWith('/target-manifest.json'),
  )
  return { version: 1, files: filtered }
}

async function walkFiles(root: string, dir: string, out: TargetManifest['files']): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) {
      await walkFiles(root, abs, out)
      continue
    }
    if (!ent.isFile()) continue
    const buf = await readFile(abs)
    const rel = abs
      .slice(root.length + 1)
      .split('\\')
      .join('/')
    out.push({ path: rel, size: buf.length, sha256: sha256Buffer(buf) })
  }
}

function annotateApplyIds(plan: MigrationPlan, mat: MaterializationPlan) {
  return plan.entries.map((e) => {
    if (e.action === 'skip' || e.action === 'error') {
      return { ...e, target_id: e.target_id ?? null }
    }
    const key = e.target_key ?? e.merge_into
    const id = key ? mat.key_to_id[key] : undefined
    return { ...e, target_id: id ?? null }
  })
}

function buildSemanticDiff(plan: MigrationPlan, mat: MaterializationPlan) {
  const workByKey = new Map(plan.work_items.map((w) => [w.target_key, w]))
  const knByKey = new Map(plan.knowledge.map((k) => [k.target_key, k]))
  const entries = plan.entries.map((e) => {
    const key = e.target_key ?? e.merge_into
    const id = key ? (mat.key_to_id[key] ?? null) : null
    const details = e.assertions.map((a) => {
      let detail: {
        id: string
        passed: boolean
        expected_sha256: string | null
        actual_sha256: string | null
        code: string
      }
      if (a.id === 'error') {
        detail = {
          id: 'error',
          passed: false,
          expected_sha256: null,
          actual_sha256: null,
          code:
            plan.errors.find(
              (err) => err.source_key === e.source_key && err.category === e.category,
            )?.code ?? 'migration_semantic_fidelity_failed',
        }
      } else if (a.id === 'skip_reason') {
        const reasonSha = sha256Canonical(e.skip_reason ?? null)
        detail = {
          id: 'skip_reason',
          passed: true,
          expected_sha256: reasonSha,
          actual_sha256: reasonSha,
          code: 'ok',
        }
      } else {
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
        } else if (key && plan.profiles.some((p) => p.target_key === key)) {
          const p = plan.profiles.find((x) => x.target_key === key)!
          projection = {
            name: p.name,
            capabilities: p.capabilities,
            boundaries: p.boundaries,
            deliverables: p.deliverables,
            verification: p.verification,
            prompt_fragments: p.prompt_fragments,
          }
        }
        const sha = sha256Canonical(projection)
        detail = {
          id: 'projection',
          passed: true,
          expected_sha256: sha,
          actual_sha256: sha,
          code: 'ok',
        }
      }
      if (sha256Canonical(detail) !== a.detail_sha256) {
        throw new MigrationError('migration_semantic_fidelity_failed', {
          detail: {
            code: 'migration_semantic_fidelity_failed',
            message_code: 'migration_semantic_fidelity_failed',
            refs: [e.source_key, a.id, 'assertion-hash-mismatch'],
          },
        })
      }
      return detail
    })
    return {
      category: e.category,
      source_key: e.source_key,
      target_id: e.action === 'skip' || e.action === 'error' ? null : id,
      details: details.sort((a, b) => compareUtf8(a.id, b.id)),
    }
  })
  return { version: 1 as const, entries }
}

async function tryNoOp(
  formal: string,
  migrationId: string,
  plan: MigrationPlan,
): Promise<PromoteResult | null> {
  const receiptPath = join(formal, 'migrations', migrationId, 'receipt.json')
  if (!(await exists(receiptPath))) return null
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Receipt
    const identityOk =
      receipt.plan_version === 1 &&
      receipt.adapter_id === plan.adapter_id &&
      receipt.fingerprint ===
        sha256Canonical({
          plan_version: 1,
          from: plan.from,
          adapter_id: plan.adapter_id,
          source_manifest_sha256: plan.source_manifest_sha256,
          decisions_sha256: plan.decisions_sha256,
        }) &&
      receipt.source_manifest_sha256 === plan.source_manifest_sha256 &&
      receipt.decisions_sha256 === plan.decisions_sha256
    if (!identityOk) return null

    const migDir = join(formal, 'migrations', migrationId)
    const mapping = JSON.parse(await readFile(join(migDir, 'mapping.json'), 'utf8'))
    const semantic = JSON.parse(await readFile(join(migDir, 'semantic-diff.json'), 'utf8'))
    const targetManifest = JSON.parse(await readFile(join(migDir, 'target-manifest.json'), 'utf8'))
    const mappingSha = sha256Canonical(mapping)
    const semanticSha = sha256Canonical(semantic)
    const targetSha = sha256Canonical(targetManifest)
    if (
      mappingSha !== receipt.mapping_sha256 ||
      semanticSha !== receipt.semantic_diff_sha256 ||
      targetSha !== receipt.target_manifest_sha256
    ) {
      return null
    }
    // also require on-disk target files match target-manifest
    const live = await buildTargetManifest(formal)
    if (sha256Canonical(live) !== targetSha) return null

    return {
      no_op: true,
      report: {
        base: 'target',
        path: `.rolekit/migrations/${migrationId}/report.json`,
      },
      target_manifest_sha256: targetSha,
      mapping_sha256: mappingSha,
      semantic_diff_sha256: semanticSha,
      receipt,
    }
  } catch {
    return null
  }
}

async function assertNoConflictingStaging(targetRoot: string, migrationId: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(targetRoot)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith('.rolekit.migrate-') || !name.endsWith('.tmp')) continue
    if (name === `.rolekit.migrate-${migrationId}.tmp`) continue
    throw new MigrationError('migration_staging_conflict', {
      detail: {
        code: 'migration_staging_conflict',
        message_code: 'migration_staging_conflict',
        refs: [name],
      },
    })
  }
}

function mandatoryCategories(from: MigrationPlan['from']): readonly string[] {
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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export { buildErrorDetails, emptySemanticDiff }

/**
 * CodeStable source detect + scan (D4/D10).
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { sha256Buffer, sha256Canonical } from '../../canonical.ts'
import { isSemanticallyEmpty, leadingDate, parseMarkdownDocument } from '../../markdown.ts'
import { readSourceFile } from '../../safety.ts'
import type {
  DetectedSource,
  DiscardedRecord,
  ManifestFile,
  ProvenanceRecord,
  SourceEntity,
  SourceLocator,
  SourceManifest,
} from '../../types.ts'
import { MigrationError } from '../../types.ts'
import { attentionFileDigest, parseAttentionRules } from './attention.ts'

export const CODESTABLE_ADAPTER_ID = 'codestable@1'

const LIFECYCLE_ROOTS = new Set([
  'features',
  'issues',
  'refactors',
  'goals',
  'roadmap',
  'requirements',
  'compound',
])

const EVIDENCE_ROOTS = new Set([
  'brainstorms',
  'audits',
  'feedback',
  'reference',
  'gates',
  'runtime-manifest',
])

const STAGE_ORDER = ['intent', 'design', 'implementation', 'review', 'qa', 'acceptance'] as const

type Stage = (typeof STAGE_ORDER)[number]

/** Typed payloads carried through map pipeline. */
export interface AggregatePayload {
  kind: 'feature' | 'issue' | 'refactor' | 'goal'
  relDir: string
  isSemanticallyEmpty: boolean
}

export interface RoadmapPayload {
  slug: string
  roadmapRelPath: string
  itemsRelPath: string
  frontmatter: Record<string, unknown>
  created: string | null
  itemsCreated: string | null
}

export interface RoadmapItemRecord {
  slug: string
  description: string
  depends_on: string[]
  status: string
  feature?: string
  minimal_loop?: boolean
  notes?: string
}

export interface RoadmapItemPayload {
  roadmapSlug: string
  item: RoadmapItemRecord
}

export interface DocFilePayload {
  relPath: string
  frontmatter: Record<string, unknown>
  body: string
  isSemanticallyEmpty: boolean
}

export interface AttentionRulePayload {
  h2: string
  ordinal: number
  body: string
  tags: string[]
  attentionRelPath: string
  attentionFileSha256: string
}

/**
 * Detects CodeStable layout under project root or direct .codestable path.
 */
export async function detectCodestable(root: string): Promise<DetectedSource> {
  const csRoot = await resolveCodestableRootForAdapter(root)
  return {
    from: 'codestable',
    adapter_id: CODESTABLE_ADAPTER_ID,
    root: csRoot,
  }
}

/**
 * Resolves the CodeStable root directory from project or nested layout.
 */
export async function resolveCodestableRootForAdapter(root: string): Promise<string> {
  try {
    await readdir(join(root, 'features'))
    return root
  } catch {
    /* not direct codestable root */
  }
  const nested = join(root, '.codestable')
  try {
    await readdir(join(nested, 'features'))
    return nested
  } catch {
    throw new MigrationError('migration_source_not_found', {
      detail: {
        code: 'migration_source_not_found',
        message_code: 'migration_source_not_found',
        refs: ['.codestable'],
      },
    })
  }
}

/**
 * Scans CodeStable semantic entities, provenance, and discarded inventory.
 */
export async function scanCodestable(
  root: string,
  manifest: SourceManifest,
): Promise<{
  entities: SourceEntity[]
  provenance: ProvenanceRecord[]
  discarded: DiscardedRecord[]
}> {
  const csRoot = await resolveCodestableRootForAdapter(root)
  const manifestByPath = indexManifest(manifest.files)
  const provenance: ProvenanceRecord[] = []
  const discarded: DiscardedRecord[] = []
  const entities: SourceEntity[] = []

  await classifyTopLevel(csRoot, manifestByPath, provenance, discarded)

  await scanAggregates(csRoot, 'features', 'feature', manifestByPath, entities, provenance)
  await scanAggregates(csRoot, 'issues', 'issue', manifestByPath, entities, provenance)
  await scanAggregates(csRoot, 'refactors', 'refactor', manifestByPath, entities, provenance)
  await scanAggregates(csRoot, 'goals', 'goal', manifestByPath, entities, provenance)

  await scanRoadmaps(csRoot, manifestByPath, entities, provenance)
  await scanAdrs(csRoot, manifestByPath, entities, provenance)
  await scanCompound(csRoot, manifestByPath, entities, provenance)
  await scanAttention(csRoot, manifestByPath, entities)

  sortDiscarded(discarded)
  sortProvenance(provenance)
  return { entities, provenance, discarded }
}

function indexManifest(files: ManifestFile[]): Map<string, ManifestFile> {
  return new Map(files.map((f) => [f.path, f]))
}

async function classifyTopLevel(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  provenance: ProvenanceRecord[],
  discarded: DiscardedRecord[],
): Promise<void> {
  const entries = await readdir(csRoot, { withFileTypes: true })
  for (const ent of entries) {
    const name = ent.name
    const rel = name
    if (name === 'attention.md') continue
    if (ent.isFile()) {
      if (name === '.gitkeep') {
        pushDiscarded(discarded, rel, manifestByPath, null, 'empty-placeholder')
      }
      continue
    }
    if (!ent.isDirectory()) continue
    if (LIFECYCLE_ROOTS.has(name) || EVIDENCE_ROOTS.has(name)) continue
    throw new MigrationError('migration_source_unsafe', {
      detail: {
        code: 'migration_source_unsafe',
        message_code: 'migration_source_unsafe',
        refs: [rel, 'unknown-semantic-root'],
      },
    })
  }

  await inventoryEvidenceRoot(csRoot, 'brainstorms', manifestByPath, provenance, discarded)
  await inventoryEvidenceRoot(csRoot, 'audits', manifestByPath, provenance, discarded)
  await inventoryEvidenceRoot(csRoot, 'feedback', manifestByPath, provenance, discarded)
  await inventoryEvidenceRoot(csRoot, 'reference', manifestByPath, provenance, discarded)
  await inventoryEvidenceRoot(csRoot, 'gates', manifestByPath, provenance, discarded)
  await inventoryEvidenceRoot(csRoot, 'runtime-manifest', manifestByPath, provenance, discarded)
  await inventoryRequirementsNonAdr(csRoot, manifestByPath, provenance, discarded)
  await inventoryCategoryGitkeeps(csRoot, manifestByPath, discarded)
}

async function inventoryCategoryGitkeeps(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  discarded: DiscardedRecord[],
): Promise<void> {
  for (const cat of [
    'features',
    'issues',
    'refactors',
    'goals',
    'roadmap',
    'compound',
    'requirements',
  ]) {
    const rel = `${cat}/.gitkeep`
    if (manifestByPath.has(rel)) {
      pushDiscarded(discarded, rel, manifestByPath, null, 'empty-placeholder')
    }
  }
}

async function inventoryEvidenceRoot(
  csRoot: string,
  dirName: string,
  manifestByPath: Map<string, ManifestFile>,
  provenance: ProvenanceRecord[],
  discarded: DiscardedRecord[],
): Promise<void> {
  const base = join(csRoot, dirName)
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return
  }
  for (const name of names) {
    const rel = `${dirName}/${name}`
    const mf = manifestByPath.get(rel)
    if (!mf) continue
    if (name === '.gitkeep') {
      pushDiscarded(discarded, rel, manifestByPath, null, 'empty-placeholder')
      continue
    }
    if (mf.type === 'directory') {
      await walkEvidenceDir(csRoot, rel, manifestByPath, provenance, discarded, null)
      continue
    }
    provenance.push({
      source_path: rel,
      source_sha256: mf.sha256 ?? '',
      owner_source_key: null,
      role: 'evidence-only',
      stage_contribution: [],
    })
  }
}

async function inventoryRequirementsNonAdr(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  provenance: ProvenanceRecord[],
  discarded: DiscardedRecord[],
): Promise<void> {
  const base = join(csRoot, 'requirements')
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return
  }
  for (const name of names) {
    const rel = `requirements/${name}`
    const mf = manifestByPath.get(rel)
    if (!mf) continue
    if (name === '.gitkeep') continue
    if (name === 'adrs' && mf.type === 'directory') {
      await walkEvidenceDir(csRoot, rel, manifestByPath, provenance, discarded, null)
      continue
    }
    if (mf.type === 'file') {
      provenance.push({
        source_path: rel,
        source_sha256: mf.sha256 ?? '',
        owner_source_key: null,
        role: 'evidence-only',
        stage_contribution: [],
      })
    }
  }
}

async function walkEvidenceDir(
  csRoot: string,
  relDir: string,
  manifestByPath: Map<string, ManifestFile>,
  provenance: ProvenanceRecord[],
  discarded: DiscardedRecord[],
  owner: string | null,
): Promise<void> {
  for (const [rel, mf] of manifestByPath) {
    if (!rel.startsWith(`${relDir}/`)) continue
    const rest = rel.slice(relDir.length + 1)
    if (rest.includes('/')) continue
    if (mf.type === 'directory') continue
    if (basename(rel) === '.gitkeep') {
      pushDiscarded(discarded, rel, manifestByPath, null, 'empty-placeholder')
      continue
    }
    provenance.push({
      source_path: rel,
      source_sha256: mf.sha256 ?? '',
      owner_source_key: owner,
      role: 'evidence-only',
      stage_contribution: [],
    })
  }
}

async function scanAggregates(
  csRoot: string,
  dirName: string,
  kind: AggregatePayload['kind'],
  manifestByPath: Map<string, ManifestFile>,
  entities: SourceEntity[],
  provenance: ProvenanceRecord[],
): Promise<void> {
  const base = join(csRoot, dirName)
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return
  }
  for (const name of names) {
    if (name === '.gitkeep') continue
    const relDir = `${dirName}/${name}`
    const mf = manifestByPath.get(relDir)
    if (!mf || mf.type !== 'directory') continue
    const digest = aggregateDigest(relDir, manifestByPath)
    entities.push({
      category: kind,
      source_key: name,
      source_digest: digest,
      payload: {
        kind,
        relDir,
        isSemanticallyEmpty: false,
      } satisfies AggregatePayload,
    })
    await scanAggregateSupport(csRoot, relDir, name, manifestByPath, provenance)
  }
}

function aggregateDigest(relDir: string, manifestByPath: Map<string, ManifestFile>): string {
  const files: Array<{ path: string; sha256: string }> = []
  const prefix = `${relDir}/`
  for (const [path, mf] of manifestByPath) {
    if (!path.startsWith(prefix)) continue
    if (mf.type !== 'file' || !mf.sha256) continue
    files.push({ path, sha256: mf.sha256 })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return sha256Canonical(files)
}

async function scanAggregateSupport(
  csRoot: string,
  relDir: string,
  ownerKey: string,
  manifestByPath: Map<string, ManifestFile>,
  provenance: ProvenanceRecord[],
): Promise<void> {
  const prefix = `${relDir}/`
  for (const [rel, mf] of manifestByPath) {
    if (!rel.startsWith(prefix)) continue
    const rest = rel.slice(prefix.length)
    if (rest.includes('/')) continue
    if (mf.type !== 'file' || !mf.sha256) continue
    const stages = await inferStageContribution(csRoot, rel)
    provenance.push({
      source_path: rel,
      source_sha256: mf.sha256,
      owner_source_key: ownerKey,
      role: 'support',
      stage_contribution: stages,
    })
  }
}

async function inferStageContribution(csRoot: string, relPath: string): Promise<Stage[]> {
  const stages = new Set<Stage>()
  if (relPath.endsWith('.json') || relPath.endsWith('.yaml') || relPath.endsWith('.yml')) {
    if (relPath.includes('-checklist.')) stages.add('implementation')
    return sortStages([...stages])
  }
  if (!relPath.endsWith('.md')) return []
  let text: string
  try {
    text = await readFile(join(csRoot, ...relPath.split('/')), 'utf8')
  } catch {
    return []
  }
  const { frontmatter } = parseMarkdownDocument(text)
  const docType = typeof frontmatter.doc_type === 'string' ? frontmatter.doc_type : ''
  const status = typeof frontmatter.status === 'string' ? frontmatter.status : ''
  if (docType.endsWith('-acceptance') && (status === 'passed' || status === 'accepted')) {
    stages.add('acceptance')
  } else if (
    (docType.endsWith('-qa') ||
      docType.endsWith('-code-review') ||
      docType.endsWith('-design-review')) &&
    status === 'passed'
  ) {
    stages.add('review')
    if (docType.endsWith('-qa')) stages.add('qa')
    else stages.add('review')
  } else if (docType.endsWith('-implementation') && status === 'completed') {
    stages.add('implementation')
  } else if (docType.endsWith('-design') || docType.endsWith('-report')) {
    stages.add('design')
  } else if (docType.includes('design')) {
    stages.add('design')
  }
  return sortStages([...stages])
}

function sortStages(stages: Stage[]): Stage[] {
  return STAGE_ORDER.filter((s) => stages.includes(s))
}

async function scanRoadmaps(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  entities: SourceEntity[],
  provenance: ProvenanceRecord[],
): Promise<void> {
  const base = join(csRoot, 'roadmap')
  let slugs: string[]
  try {
    slugs = await readdir(base)
  } catch {
    return
  }
  for (const slug of slugs) {
    if (slug === '.gitkeep') continue
    const relDir = `roadmap/${slug}`
    if (!manifestByPath.get(relDir)?.type) continue
    const roadmapRel = `${relDir}/${slug}-roadmap.md`
    const itemsRel = `${relDir}/${slug}-items.yaml`
    const roadmapMf = manifestByPath.get(roadmapRel)
    const itemsMf = manifestByPath.get(itemsRel)
    if (!roadmapMf?.sha256 || !itemsMf) continue

    const roadmapText = await readFile(join(csRoot, ...roadmapRel.split('/')), 'utf8')
    const { frontmatter } = parseMarkdownDocument(roadmapText)
    const itemsText = await readFile(join(csRoot, ...itemsRel.split('/')), 'utf8')
    const itemsDoc = parseYaml(itemsText) as {
      created?: string
      items?: unknown[]
    }
    entities.push({
      category: 'roadmap',
      source_key: slug,
      source_digest: roadmapMf.sha256,
      payload: {
        slug,
        roadmapRelPath: roadmapRel,
        itemsRelPath: itemsRel,
        frontmatter,
        created: readCreatedField(frontmatter),
        itemsCreated: typeof itemsDoc.created === 'string' ? itemsDoc.created : null,
      } satisfies RoadmapPayload,
    })

    await scanRoadmapSupport(csRoot, relDir, slug, manifestByPath, provenance)

    const items = parseRoadmapItems(itemsDoc, slug)
    for (const item of items) {
      const locator: SourceLocator = { roadmap_slug: slug, item_slug: item.slug }
      entities.push({
        category: 'roadmap-item',
        source_key: item.slug,
        source_locator: locator,
        source_digest: sha256Canonical(item),
        payload: {
          roadmapSlug: slug,
          item,
        } satisfies RoadmapItemPayload,
      })
    }
  }
}

function parseRoadmapItems(doc: { items?: unknown[] }, roadmapSlug: string): RoadmapItemRecord[] {
  if (!Array.isArray(doc.items)) {
    throw new MigrationError('migration_semantic_fidelity_failed', {
      detail: {
        code: 'migration_semantic_fidelity_failed',
        message_code: 'migration_semantic_fidelity_failed',
        refs: [`roadmap/${roadmapSlug}:items`],
      },
    })
  }
  return doc.items.map((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw itemShapeError(roadmapSlug, i)
    }
    const obj = raw as Record<string, unknown>
    if (typeof obj.slug !== 'string' || typeof obj.description !== 'string') {
      throw itemShapeError(roadmapSlug, i)
    }
    const depends_on = Array.isArray(obj.depends_on) ? obj.depends_on.map((d) => String(d)) : []
    if (typeof obj.status !== 'string') throw itemShapeError(roadmapSlug, i)
    const item: RoadmapItemRecord = {
      slug: obj.slug,
      description: obj.description,
      depends_on,
      status: obj.status,
    }
    if (typeof obj.feature === 'string' && obj.feature.length > 0) item.feature = obj.feature
    if (typeof obj.notes === 'string') item.notes = obj.notes
    if (typeof obj.minimal_loop === 'boolean') item.minimal_loop = obj.minimal_loop
    return item
  })
}

function itemShapeError(roadmapSlug: string, index: number): MigrationError {
  return new MigrationError('migration_semantic_fidelity_failed', {
    detail: {
      code: 'migration_semantic_fidelity_failed',
      message_code: 'migration_semantic_fidelity_failed',
      refs: [`roadmap/${roadmapSlug}:item:${index}`],
    },
  })
}

async function scanRoadmapSupport(
  csRoot: string,
  relDir: string,
  ownerKey: string,
  manifestByPath: Map<string, ManifestFile>,
  provenance: ProvenanceRecord[],
): Promise<void> {
  const prefix = `${relDir}/`
  for (const [rel, mf] of manifestByPath) {
    if (!rel.startsWith(prefix)) continue
    if (rel === `${relDir}/${ownerKey}-roadmap.md`) continue
    if (rel === `${relDir}/${ownerKey}-items.yaml`) continue
    if (mf.type !== 'file' || !mf.sha256) continue
    if (basename(rel) === '.gitkeep') continue
    provenance.push({
      source_path: rel,
      source_sha256: mf.sha256,
      owner_source_key: ownerKey,
      role: 'support',
      stage_contribution: ['intent'],
    })
  }
}

async function scanAdrs(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  entities: SourceEntity[],
  provenance: ProvenanceRecord[],
): Promise<void> {
  const prefix = 'requirements/adrs/'
  for (const [rel, mf] of manifestByPath) {
    if (!rel.startsWith(prefix)) continue
    if (!rel.endsWith('.md')) continue
    if (mf.type !== 'file' || !mf.sha256) continue
    const text = await readFile(join(csRoot, ...rel.split('/')), 'utf8')
    const parsed = parseMarkdownDocument(text)
    entities.push({
      category: 'adr',
      source_key: rel,
      source_digest: mf.sha256,
      payload: {
        relPath: rel,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        isSemanticallyEmpty: isSemanticallyEmpty(parsed.body),
      } satisfies DocFilePayload,
    })
    void provenance
  }
}

async function scanCompound(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  entities: SourceEntity[],
  provenance: ProvenanceRecord[],
): Promise<void> {
  const prefix = 'compound/'
  for (const [rel, mf] of manifestByPath) {
    if (!rel.startsWith(prefix)) continue
    if (!rel.endsWith('.md')) continue
    if (basename(rel) === '.gitkeep') continue
    if (mf.type !== 'file' || !mf.sha256) continue
    const text = await readFile(join(csRoot, ...rel.split('/')), 'utf8')
    const parsed = parseMarkdownDocument(text)
    entities.push({
      category: 'compound',
      source_key: rel,
      source_digest: mf.sha256,
      payload: {
        relPath: rel,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        isSemanticallyEmpty: isSemanticallyEmpty(parsed.body),
      } satisfies DocFilePayload,
    })
    void provenance
  }
}

async function scanAttention(
  csRoot: string,
  manifestByPath: Map<string, ManifestFile>,
  entities: SourceEntity[],
): Promise<void> {
  const rel = 'attention.md'
  const mf = manifestByPath.get(rel)
  if (!mf?.sha256) return
  const buf = await readSourceFile(csRoot, rel)
  const text = buf.toString('utf8')
  const fileSha = attentionFileDigest(text)
  const { rules } = parseAttentionRules(text, fileSha)
  for (const rule of rules) {
    entities.push({
      category: 'attention-rule',
      source_key: rule.source_key,
      source_digest: rule.source_digest,
      payload: {
        h2: rule.h2,
        ordinal: rule.ordinal,
        body: rule.body,
        tags: rule.tags,
        attentionRelPath: rel,
        attentionFileSha256: fileSha,
      } satisfies AttentionRulePayload,
    })
  }
}

function readCreatedField(fm: Record<string, unknown>): string | null {
  if (typeof fm.created === 'string') return fm.created
  if (typeof fm.date === 'string') return fm.date
  return null
}

function pushDiscarded(
  discarded: DiscardedRecord[],
  rel: string,
  manifestByPath: Map<string, ManifestFile>,
  heading: string | null,
  reason: DiscardedRecord['reason'],
): void {
  const sha = manifestByPath.get(rel)?.sha256 ?? sha256Buffer(Buffer.alloc(0))
  discarded.push({
    source_path: rel,
    heading,
    source_sha256: sha,
    reason,
  })
}

function sortDiscarded(rows: DiscardedRecord[]): void {
  rows.sort((a, b) => {
    const ka = `${a.source_path}\0${a.heading ?? ''}\0${a.reason}`
    const kb = `${b.source_path}\0${b.heading ?? ''}\0${b.reason}`
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

function sortProvenance(rows: ProvenanceRecord[]): void {
  rows.sort((a, b) => {
    const ka = `${a.source_path}\0${a.role}\0${a.owner_source_key ?? ''}`
    const kb = `${b.source_path}\0${b.role}\0${b.owner_source_key ?? ''}`
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

/** Count entities by mandatory category (scan-stage discovered). */
export function countEntitiesByCategory(
  entities: SourceEntity[],
): Record<(typeof CODESTABLE_MANDATORY)[number], number> {
  const counts = Object.fromEntries(CODESTABLE_MANDATORY.map((c) => [c, 0])) as Record<
    (typeof CODESTABLE_MANDATORY)[number],
    number
  >
  for (const e of entities) {
    if ((CODESTABLE_MANDATORY as readonly string[]).includes(e.category)) {
      counts[e.category as (typeof CODESTABLE_MANDATORY)[number]] += 1
    }
  }
  return counts
}

const CODESTABLE_MANDATORY = [
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

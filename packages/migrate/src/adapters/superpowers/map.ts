/**
 * Superpowers 14→8 profiles + 6 notes mapper (D12/D12c).
 */

import { compareUtf8, sha256Canonical, sha256Text } from '../../canonical.ts'
import { knKey, rpKey, sortByMappingIdentity } from '../../keys.ts'
import { parseMarkdownDocument } from '../../markdown.ts'
import type {
  DiscardedRecord,
  ErrorDetail,
  FieldMapEntry,
  MapContext,
  MappingEntry,
  MigrationDecisions,
  MigrationPlan,
  PlannedKnowledge,
  PlannedRoleProfile,
  ProvenanceRecord,
  SourceEntity,
  StableErrorCode,
} from '../../types.ts'
import { extractFragmentSections, listRealH2Headings, throwSemanticFidelity } from './extract.ts'
import {
  attributionComment,
  fragmentRelPath,
  NOTE_SLUGS,
  NOTE_TEMPLATES,
  type NoteTemplate,
  noteTags,
  PROFILE_SLUGS,
  PROFILE_TEMPLATES,
  type ProfileTemplate,
  SUPERPOWERS_ADAPTER_EPOCH,
  SUPERPOWERS_ADAPTER_ID,
} from './templates.ts'

export interface SuperpowersBundleFile {
  path: string
  sha256: string
  text: string | null
  isBinary: boolean
}

export interface SuperpowersSkillPayload {
  slug: string
  files: SuperpowersBundleFile[]
}

/**
 * Maps scanned Superpowers entities into profiles, notes, and report sidecars.
 */
export function mapSuperpowersEntities(
  entities: SourceEntity[],
  decisions: MigrationDecisions,
  ctx: MapContext,
): MigrationPlan {
  const discarded = [...ctx.discarded]
  const provenance = [...ctx.provenance]
  const errors: MigrationPlan['errors'] = []
  const entries: MappingEntry[] = []
  const profiles: PlannedRoleProfile[] = []
  const knowledge: PlannedKnowledge[] = []
  const ownerSkip = new Map(
    decisions.entries.map((e) => [`${e.ref.category}\0${e.ref.source_key}`, e]),
  )

  const bySlug = new Map<string, SourceEntity>()
  for (const entity of entities) {
    bySlug.set(entity.source_key, entity)
  }

  for (const template of PROFILE_TEMPLATES) {
    const entity = bySlug.get(template.slug)
    if (!entity) {
      recordEntityError(errors, 'superpowers-profile', template.slug, 'missing entity')
      continue
    }
    const skipKey = `superpowers-profile\0${template.slug}`
    if (ownerSkip.has(skipKey)) {
      entries.push(
        buildMappingEntry(
          entity,
          'superpowers-profile',
          rpKey(template.profileName),
          [],
          'skip',
          'owner-deprecated',
        ),
      )
      ownerSkip.delete(skipKey)
      continue
    }
    try {
      const payload = entity.payload as SuperpowersSkillPayload
      const result = mapProfile(template, payload, discarded, provenance)
      profiles.push(result.profile)
      entries.push(
        buildMappingEntry(
          entity,
          'superpowers-profile',
          result.profile.target_key,
          result.fieldMap,
          'migrate',
          undefined,
          undefined,
          {
            name: result.profile.name,
            capabilities: result.profile.capabilities,
            boundaries: result.profile.boundaries,
            deliverables: result.profile.deliverables,
            verification: result.profile.verification,
            prompt_fragments: result.profile.prompt_fragments,
          },
        ),
      )
    } catch (error) {
      recordEntityError(errors, 'superpowers-profile', template.slug, error)
    }
  }

  for (const template of NOTE_TEMPLATES) {
    const entity = bySlug.get(template.slug)
    if (!entity) {
      recordEntityError(errors, 'superpowers-note', template.slug, 'missing entity')
      continue
    }
    const skipKey = `superpowers-note\0${template.slug}`
    if (ownerSkip.has(skipKey)) {
      entries.push(
        buildMappingEntry(
          entity,
          'superpowers-note',
          knKey('superpowers-note', template.slug),
          [],
          'skip',
          'owner-deprecated',
        ),
      )
      ownerSkip.delete(skipKey)
      continue
    }
    try {
      const payload = entity.payload as SuperpowersSkillPayload
      const result = mapNote(template, payload, discarded, provenance)
      knowledge.push(result.note)
      entries.push(
        buildMappingEntry(
          entity,
          'superpowers-note',
          result.note.target_key,
          result.fieldMap,
          'migrate',
          undefined,
          undefined,
          {
            type: result.note.type,
            title: result.note.title,
            status: result.note.status,
            tags: result.note.tags,
            created: result.note.created,
            source: result.note.source,
            body_sha256: sha256Text(result.note.body),
          },
        ),
      )
    } catch (error) {
      recordEntityError(errors, 'superpowers-note', template.slug, error)
    }
  }

  if (ownerSkip.size > 0) {
    for (const [, dec] of ownerSkip) {
      errors.push({
        code: 'migration_skip_invalid',
        category: dec.ref.category,
        source_key: dec.ref.source_key,
        detail: {
          code: 'migration_skip_invalid',
          message_code: 'migration_skip_invalid',
          refs: ['decisions:unmatched', dec.ref.source_key],
        },
      })
    }
  }

  sortDiscarded(discarded)
  sortProvenance(provenance)

  const sortedEntries = sortByMappingIdentity(entries)
  const hasErrors = errors.length > 0

  return {
    from: 'superpowers',
    adapter_id: SUPERPOWERS_ADAPTER_ID,
    plan_version: 1,
    source_manifest_sha256: ctx.source_manifest_sha256,
    decisions_sha256: ctx.decisions_sha256,
    entries: sortedEntries,
    work_items: [],
    knowledge,
    profiles,
    provenance,
    discarded,
    errors,
    has_errors: hasErrors,
  }
}

function mapProfile(
  template: ProfileTemplate,
  payload: SuperpowersSkillPayload,
  discarded: DiscardedRecord[],
  provenance: ProvenanceRecord[],
): { profile: PlannedRoleProfile; fieldMap: FieldMapEntry[] } {
  assertFixedFields(template)
  const filesByRel = indexBundleFiles(payload)
  const fragmentContents: Record<string, string> = {}
  const promptFragments: string[] = []
  const fieldMap: FieldMapEntry[] = []
  const usedPaths = new Set<string>()

  for (const spec of template.fragments) {
    const rel = `skills/${template.slug}/${spec.file}`
    const file = filesByRel.get(spec.file)
    if (!file || file.isBinary || file.text === null) {
      throwSemanticFidelity(`missing markdown ${spec.file}`, [rel])
    }
    usedPaths.add(spec.file)
    addProvenance(provenance, rel, file.sha256, template.slug)
    const extracted = extractFragmentSections(file.text, spec.headings, {
      sourcePath: rel,
      sourceSha256: file.sha256,
      skillSlug: template.slug,
    })
    mergeDiscarded(discarded, extracted.discarded)
    const relFragment = fragmentRelPath(template.slug, spec.fragment)
    const body = `${attributionComment(template.slug)}\n${extracted.text}`
    fragmentContents[relFragment] = body
    promptFragments.push(relFragment)
    fieldMap.push({
      target_field: `fragment:${spec.fragment}`,
      source_refs: sortRefs([rel]),
    })
  }

  fieldMap.push(
    { target_field: 'capabilities', source_refs: sortRefs([`skills/${template.slug}/SKILL.md`]) },
    { target_field: 'boundaries', source_refs: sortRefs([`skills/${template.slug}/SKILL.md`]) },
    { target_field: 'deliverables', source_refs: sortRefs([`skills/${template.slug}/SKILL.md`]) },
    { target_field: 'verification', source_refs: sortRefs([`skills/${template.slug}/SKILL.md`]) },
  )
  fieldMap.sort((a, b) => compareUtf8(a.target_field, b.target_field))

  const skillFile = filesByRel.get('SKILL.md')
  if (skillFile?.text) {
    const h2s = listRealH2Headings(skillFile.text)
    const selected = new Set(
      template.fragments.flatMap((spec) =>
        spec.headings.filter((h) => h.kind === 'h2').map((h) => h.text),
      ),
    )
    for (const section of template.discardSkillSections) {
      if (h2s.includes(section)) {
        pushDiscard(discarded, {
          source_path: `skills/${template.slug}/SKILL.md`,
          heading: section,
          source_sha256: skillFile.sha256,
          reason: 'unselected-markdown',
        })
      }
    }
    for (const heading of h2s) {
      if (selected.has(heading) || template.discardSkillSections.includes(heading)) continue
      pushDiscard(discarded, {
        source_path: `skills/${template.slug}/SKILL.md`,
        heading,
        source_sha256: skillFile.sha256,
        reason: 'unselected-markdown',
      })
    }
  }

  for (const relFile of template.discardWholeFiles) {
    const file = filesByRel.get(relFile)
    if (!file) continue
    pushDiscard(discarded, {
      source_path: `skills/${template.slug}/${relFile}`,
      heading: null,
      source_sha256: file.sha256,
      reason: classifyDiscardReason(`skills/${template.slug}/${relFile}`),
    })
    usedPaths.add(relFile)
  }

  for (const [relFile, file] of filesByRel) {
    if (relFile === 'SKILL.md' || usedPaths.has(relFile)) continue
    if (template.fragments.some((spec) => spec.file === relFile)) continue
    pushDiscard(discarded, {
      source_path: `skills/${template.slug}/${relFile}`,
      heading: null,
      source_sha256: file.sha256,
      reason: classifyDiscardReason(`skills/${template.slug}/${relFile}`),
    })
  }

  const profile: PlannedRoleProfile = {
    target_key: rpKey(template.profileName),
    name: template.profileName,
    capabilities: template.capabilities,
    boundaries: template.boundaries,
    deliverables: template.deliverables,
    verification: template.verification,
    prompt_fragments: promptFragments,
    fragment_contents: fragmentContents,
    source_refs: sortRefs(payload.files.map((f) => `skills/${template.slug}/${basename(f.path)}`)),
  }
  return { profile, fieldMap }
}

function mapNote(
  template: NoteTemplate,
  payload: SuperpowersSkillPayload,
  discarded: DiscardedRecord[],
  provenance: ProvenanceRecord[],
): { note: PlannedKnowledge; fieldMap: FieldMapEntry[] } {
  const filesByRel = indexBundleFiles(payload)
  const skill = filesByRel.get('SKILL.md')
  if (!skill || skill.isBinary || skill.text === null) {
    throwSemanticFidelity('missing SKILL.md', [`skills/${template.slug}/SKILL.md`])
  }
  addProvenance(provenance, `skills/${template.slug}/SKILL.md`, skill.sha256, template.slug)

  const parsed = parseMarkdownDocument(skill.text)
  const skillBody = parsed.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const sections: string[] = [attributionComment(template.slug), skillBody]

  const companionPaths = payload.files
    .map((f) => basename(f.path))
    .filter((name) => name !== 'SKILL.md')
    .sort(compareUtf8)

  for (const relFile of companionPaths) {
    const file = filesByRel.get(relFile)
    if (!file) continue
    const absPath = `skills/${template.slug}/${relFile}`
    if (file.isBinary || file.text === null) {
      pushDiscard(discarded, {
        source_path: absPath,
        heading: null,
        source_sha256: file.sha256,
        reason: 'binary-asset',
      })
      continue
    }
    addProvenance(provenance, absPath, file.sha256, template.slug)
    sections.push(
      `<!-- companion: ${absPath} -->\n\n\`\`\`text\n${file.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd()}\n\`\`\``,
    )
  }

  sections.push(`## RoleKit 迁移说明\n\n${template.migrationSentence}`)
  const body = `${sections.join('\n\n')}\n`

  const note: PlannedKnowledge = {
    target_key: knKey('superpowers-note', template.slug),
    type: 'note',
    title: `Superpowers: ${template.slug}`,
    status: 'active',
    tags: noteTags(template.slug),
    created: SUPERPOWERS_ADAPTER_EPOCH,
    source: `skills/${template.slug}/SKILL.md`,
    body,
    source_refs: sortRefs(payload.files.map((f) => `skills/${template.slug}/${basename(f.path)}`)),
  }

  const fieldMap: FieldMapEntry[] = [
    { target_field: 'body', source_refs: sortRefs([`skills/${template.slug}/SKILL.md`]) },
    {
      target_field: 'migration_sentence',
      source_refs: sortRefs([`skills/${template.slug}/SKILL.md`]),
    },
  ].sort((a, b) => compareUtf8(a.target_field, b.target_field))

  return { note, fieldMap }
}

function buildMappingEntry(
  entity: SourceEntity,
  category: 'superpowers-profile' | 'superpowers-note',
  targetKey: string,
  fieldMap: FieldMapEntry[],
  action: 'migrate' | 'skip' | 'error' = 'migrate',
  skipReason?: 'owner-deprecated' | 'empty-placeholder' | 'duplicate',
  errorCode?: string,
  projection?: unknown,
): MappingEntry {
  let detail: {
    id: string
    passed: boolean
    expected_sha256: string | null
    actual_sha256: string | null
    code: string
  }
  if (action === 'error') {
    detail = {
      id: 'error',
      passed: false,
      expected_sha256: null,
      actual_sha256: null,
      code: errorCode ?? 'migration_semantic_fidelity_failed',
    }
  } else if (action === 'skip') {
    const reasonSha = sha256Canonical(skipReason ?? null)
    detail = {
      id: 'skip_reason',
      passed: true,
      expected_sha256: reasonSha,
      actual_sha256: reasonSha,
      code: 'ok',
    }
  } else {
    const sha = sha256Canonical(
      projection ?? {
        category,
        action,
        source_digest: entity.source_digest,
        target_key: targetKey,
        merge_into: null,
      },
    )
    detail = {
      id: 'projection',
      passed: true,
      expected_sha256: sha,
      actual_sha256: sha,
      code: 'ok',
    }
  }
  const entry: MappingEntry = {
    category,
    source_key: entity.source_key,
    source_digest: entity.source_digest,
    action,
    field_map: action === 'migrate' ? fieldMap : [],
    assertions: [
      {
        id: detail.id,
        passed: detail.passed,
        detail_sha256: sha256Canonical(detail),
      },
    ],
  }
  if (action === 'migrate') {
    entry.target_key = targetKey
    entry.target_id = null
  }
  if (action === 'skip') {
    entry.skip_reason = skipReason
    entry.target_key = targetKey
    entry.target_id = null
  }
  return entry
}

function assertFixedFields(template: ProfileTemplate): void {
  for (const [name, values] of [
    ['capabilities', template.capabilities],
    ['boundaries', template.boundaries],
    ['deliverables', template.deliverables],
    ['verification', template.verification],
  ] as const) {
    if (values.length === 0 || values.some((v) => v.trim().length === 0)) {
      throwSemanticFidelity(`empty fixed field ${name}`, [`skills/${template.slug}/SKILL.md`])
    }
  }
}

function indexBundleFiles(payload: SuperpowersSkillPayload): Map<string, SuperpowersBundleFile> {
  const map = new Map<string, SuperpowersBundleFile>()
  for (const file of payload.files) {
    map.set(basename(file.path), file)
  }
  return map
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function classifyDiscardReason(sourcePath: string): DiscardedRecord['reason'] {
  const base = basename(sourcePath)
  if (sourcePath.includes('/agents/')) return 'host-agent-prompt'
  if (base.endsWith('-prompt.md')) return 'host-agent-prompt'
  if (base === 'code-reviewer.md') return 'host-agent-prompt'
  if (/\.(sh|js|cjs|ts|html)$/i.test(base)) return 'source-script'
  if (/\.(dot|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(base)) return 'binary-asset'
  if (/\.(yaml|yml)$/i.test(base) && sourcePath.includes('/agents/')) return 'host-agent-prompt'
  if (/\.(yaml|yml)$/i.test(base)) return 'source-script'
  if (/\.md$/i.test(base)) return 'unselected-markdown'
  return 'binary-asset'
}

export function classifyPackageDiscard(sourcePath: string): DiscardedRecord['reason'] {
  const base = basename(sourcePath)
  if (base === 'README.md' || base === 'CODE_OF_CONDUCT.md') return 'package-evidence'
  if (sourcePath.startsWith('.codex-plugin/')) return 'package-evidence'
  if (/\.(svg|png|jpg|jpeg|gif|webp|ico)$/i.test(base)) return 'binary-asset'
  if (/\.md$/i.test(base)) return 'unselected-markdown'
  return 'binary-asset'
}

export function isNoteSlug(slug: string): slug is NoteTemplate['slug'] {
  return NOTE_SLUGS.has(slug as NoteTemplate['slug'])
}

export function isProfileSlug(slug: string): slug is ProfileTemplate['slug'] {
  return PROFILE_SLUGS.has(slug as ProfileTemplate['slug'])
}

function addProvenance(
  provenance: ProvenanceRecord[],
  sourcePath: string,
  sha256: string,
  owner: string,
): void {
  provenance.push({
    source_path: sourcePath,
    source_sha256: sha256,
    owner_source_key: owner,
    role: 'support',
    stage_contribution: [],
  })
}

function pushDiscard(discarded: DiscardedRecord[], record: DiscardedRecord): void {
  const key = `${record.source_path}\0${record.heading ?? ''}\0${record.reason}`
  if (discarded.some((d) => `${d.source_path}\0${d.heading ?? ''}\0${d.reason}` === key)) return
  discarded.push(record)
}

function mergeDiscarded(target: DiscardedRecord[], incoming: DiscardedRecord[]): void {
  for (const record of incoming) pushDiscard(target, record)
}

function sortDiscarded(records: DiscardedRecord[]): void {
  records.sort((a, b) => {
    const ka = `${a.source_path}\0${a.heading ?? ''}\0${a.reason}`
    const kb = `${b.source_path}\0${b.heading ?? ''}\0${b.reason}`
    return compareUtf8(ka, kb)
  })
}

function sortProvenance(records: ProvenanceRecord[]): void {
  records.sort((a, b) => {
    const ka = `${a.source_path}\0${a.role}\0${a.owner_source_key ?? ''}`
    const kb = `${b.source_path}\0${b.role}\0${b.owner_source_key ?? ''}`
    return compareUtf8(ka, kb)
  })
}

function sortRefs(refs: string[]): string[] {
  return [...refs].sort(compareUtf8)
}

function recordEntityError(
  errors: MigrationPlan['errors'],
  category: 'superpowers-profile' | 'superpowers-note',
  sourceKey: string,
  error: unknown,
): void {
  const detail = toErrorDetail(error, [`skills/${sourceKey}`])
  errors.push({
    code: detail.code,
    category,
    source_key: sourceKey,
    detail,
  })
}

function toErrorDetail(error: unknown, refs: string[]): ErrorDetail {
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code?: StableErrorCode }).code
    if (code === 'migration_semantic_fidelity_failed') {
      return {
        code,
        message_code: code,
        refs,
      }
    }
  }
  return {
    code: 'migration_semantic_fidelity_failed',
    message_code: 'migration_semantic_fidelity_failed',
    refs,
  }
}

/**
 * Computes bundle source_digest from manifest file entries.
 */
export function bundleSourceDigest(
  slug: string,
  manifestFiles: Array<{ path: string; sha256: string | null }>,
): string {
  const prefix = `skills/${slug}/`
  const bundleFiles = manifestFiles
    .filter(
      (f): f is typeof f & { sha256: string } => f.path.startsWith(prefix) && f.sha256 !== null,
    )
    .map((f) => ({ path: f.path, sha256: f.sha256 }))
    .sort((a, b) => compareUtf8(a.path, b.path))
  return sha256Canonical(bundleFiles)
}

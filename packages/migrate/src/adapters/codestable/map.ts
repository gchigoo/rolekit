/**
 * CodeStable 8-step map pipeline (D8b).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { compareUtf8, sha256Canonical, sortUniqueUtf8 } from '../../canonical.ts'
import { emptyDecisions } from '../../decisions.ts'
import {
  knKey,
  normalizeCreated,
  sortByMappingIdentity,
  wiAggregateKey,
  wiRoadmapItemKey,
  wiRoadmapKey,
} from '../../keys.ts'
import {
  bodySha256,
  buildCodestableMandatoryCounts,
  collectReferencedTargetKeys,
  findReferencedSkipViolations,
  knDuplicateProjection,
  validateDependsGraph,
  validateGoalDoneInvariant,
  wiDuplicateProjection,
} from '../../map/pipeline.ts'
import { leadingDate, parseMarkdownDocument, unicodeTrim } from '../../markdown.ts'
import { mapLifecycleStatus, stageToStatus } from '../../status.ts'
import type {
  AssertionEntry,
  DecisionEntry,
  ErrorDetail,
  MapContext,
  MappingAction,
  MappingEntry,
  MigrationDecisions,
  MigrationPlan,
  PlannedKnowledge,
  PlannedWorkItem,
  SkipReason,
  SourceEntity,
  StableErrorCode,
} from '../../types.ts'
import { MigrationError } from '../../types.ts'
import type {
  AggregatePayload,
  AttentionRulePayload,
  DocFilePayload,
  RoadmapItemPayload,
  RoadmapPayload,
} from './scan.ts'
import { CODESTABLE_ADAPTER_ID } from './scan.ts'

interface EntityState {
  entity: SourceEntity
  action: MappingAction
  target_key?: string
  merge_into?: string
  skip_reason?: SkipReason
  error?: ErrorDetail
}

/**
 * Maps scanned CodeStable entities to a MigrationPlan (logical keys only).
 */
export function mapCodestable(
  entities: SourceEntity[],
  decisions: MigrationDecisions,
  ctx: MapContext,
): MigrationPlan {
  const csRoot = ctx.source_root
  let states = step1Recognize(entities)
  states = step2OwnerSkip(states, decisions)
  states = step3RoadmapBind(states, csRoot)

  const projectEpoch = computeProjectEpoch(states, csRoot)
  const construction = step4ConstructTargets(states, csRoot, projectEpoch)
  let { states: statesAfter4, workItems, knowledge } = construction

  const dupResult = step5Duplicates(statesAfter4, workItems, knowledge)
  statesAfter4 = dupResult.states
  workItems = dupResult.workItems
  knowledge = dupResult.knowledge

  statesAfter4 = step6ReferencedSkips(statesAfter4, workItems)

  const graphIssues = [...validateDependsGraph(workItems), ...validateGoalDoneInvariant(workItems)]
  statesAfter4 = applyGraphIssues(statesAfter4, graphIssues)

  const entries = step8BuildEntries(statesAfter4, workItems, knowledge)
  const errors = collectErrors(statesAfter4)

  return {
    from: 'codestable',
    adapter_id: CODESTABLE_ADAPTER_ID,
    plan_version: 1,
    source_manifest_sha256: ctx.source_manifest_sha256,
    decisions_sha256: ctx.decisions_sha256,
    entries,
    work_items: workItems,
    knowledge,
    profiles: [],
    provenance: ctx.provenance,
    discarded: ctx.discarded,
    errors,
    has_errors: errors.length > 0 || entries.some((e) => e.action === 'error'),
  }
}

function step1Recognize(entities: SourceEntity[]): EntityState[] {
  return entities.map((entity) => {
    if (
      entity.category === 'feature' ||
      entity.category === 'issue' ||
      entity.category === 'refactor' ||
      entity.category === 'goal'
    ) {
      return {
        entity,
        action: 'migrate',
        target_key: wiAggregateKey(entity.category, entity.source_key),
      }
    }
    if (entity.category === 'roadmap') {
      const payload = entity.payload as RoadmapPayload
      return {
        entity,
        action: 'migrate',
        target_key: wiRoadmapKey(payload.slug),
      }
    }
    if (entity.category === 'roadmap-item') {
      const payload = entity.payload as RoadmapItemPayload
      return {
        entity,
        action: 'migrate',
        target_key: wiRoadmapItemKey(payload.roadmapSlug, payload.item.slug),
      }
    }
    if (entity.category === 'adr' || entity.category === 'compound') {
      const payload = entity.payload as DocFilePayload
      const target_key = knKey(entity.category, entity.source_key)
      if (payload.isSemanticallyEmpty) {
        return {
          entity,
          action: 'skip',
          skip_reason: 'empty-placeholder',
          target_key,
        }
      }
      return { entity, action: 'migrate', target_key }
    }
    if (entity.category === 'attention-rule') {
      return {
        entity,
        action: 'migrate',
        target_key: knKey('attention-rule', entity.source_key),
      }
    }
    return { entity, action: 'migrate' }
  })
}

function step2OwnerSkip(states: EntityState[], decisions: MigrationDecisions): EntityState[] {
  const entries = decisions.entries.length > 0 ? decisions.entries : emptyDecisions().entries
  const matched = new Set<number>()
  const out = [...states]

  for (const entry of entries) {
    const idx = out.findIndex((s) => entityRefMatches(s.entity, entry.ref))
    if (idx < 0) throw skipInvalid(['decisions:unmatched', entry.ref.source_key])
    if (matched.has(idx)) throw skipInvalid(['decisions:multi-match', entry.ref.source_key])
    matched.add(idx)
    out[idx] = {
      ...out[idx]!,
      action: 'skip',
      skip_reason: 'owner-deprecated',
      target_key: out[idx]!.target_key ?? resolveDefaultTargetKey(out[idx]!.entity),
      merge_into: undefined,
    }
  }
  return out
}

function step3RoadmapBind(states: EntityState[], csRoot: string): EntityState[] {
  const out = [...states]
  const featureBindings = new Map<string, number[]>()

  for (let i = 0; i < out.length; i++) {
    const st = out[i]!
    if (st.entity.category !== 'roadmap-item' || st.action === 'skip' || st.action === 'error') {
      continue
    }
    const payload = st.entity.payload as RoadmapItemPayload
    const feature = payload.item.feature?.trim()
    if (!feature) continue

    if (!featureDirExists(csRoot, feature)) {
      out[i] = errorState(st, mergeConflictDetail([locatorRef(st.entity)]))
      continue
    }

    const list = featureBindings.get(feature) ?? []
    list.push(i)
    featureBindings.set(feature, list)
  }

  for (const [feature, indices] of featureBindings) {
    if (indices.length === 1) {
      out[indices[0]!] = {
        ...out[indices[0]!]!,
        action: 'merge',
        merge_into: wiAggregateKey('feature', feature),
        target_key: undefined,
      }
      continue
    }
    const locators = sortUniqueUtf8(indices.map((idx) => locatorRef(out[idx]!.entity)))
    const detail = mergeConflictDetail(locators)
    for (const idx of indices) out[idx] = errorState(out[idx]!, detail)
    const featureIdx = out.findIndex(
      (s) => s.entity.category === 'feature' && s.entity.source_key === feature,
    )
    if (featureIdx >= 0) out[featureIdx] = errorState(out[featureIdx]!, detail)
  }

  return out
}

function featureDirExists(csRoot: string, feature: string): boolean {
  try {
    const names = readdirSync(join(csRoot, 'features'))
    return names.includes(feature)
  } catch {
    return false
  }
}

function step4ConstructTargets(
  states: EntityState[],
  csRoot: string,
  projectEpoch: string,
): {
  states: EntityState[]
  workItems: PlannedWorkItem[]
  knowledge: PlannedKnowledge[]
} {
  const out = [...states]
  const workItems: PlannedWorkItem[] = []
  const knowledge: PlannedKnowledge[] = []
  const itemFinalTarget = buildItemFinalTargetMap(out)

  for (let i = 0; i < out.length; i++) {
    const st = out[i]!
    if (st.action === 'error' || st.action === 'skip') continue
    try {
      if (
        st.entity.category === 'feature' ||
        st.entity.category === 'issue' ||
        st.entity.category === 'refactor' ||
        st.entity.category === 'goal'
      ) {
        const payload = st.entity.payload as AggregatePayload
        const bound = findBoundItem(out, st.entity.source_key)
        const created = bound
          ? resolveFeatureCreated(csRoot, st.entity.source_key)
          : resolveAggregateCreated(csRoot, payload)
        const status = bound
          ? mapLifecycleStatus(bound.item.status)
          : resolveAggregateStatus(csRoot, payload)
        const title = bound ? requireItemTitle(bound.item) : st.entity.source_key
        workItems.push({
          target_key: st.target_key!,
          kind: payload.kind,
          title,
          status,
          depends_on_keys: [],
          created,
          source_refs: [payload.relDir],
        })
      } else if (st.entity.category === 'roadmap') {
        const payload = st.entity.payload as RoadmapPayload
        workItems.push({
          target_key: st.target_key!,
          kind: 'goal',
          title: payload.slug,
          status: resolveRoadmapDocStatus(payload),
          depends_on_keys: [],
          created: resolveRoadmapCreated(payload),
          source_refs: [payload.roadmapRelPath],
        })
      } else if (st.entity.category === 'roadmap-item' && st.action === 'migrate') {
        const payload = st.entity.payload as RoadmapItemPayload
        const roadmapPayload = findRoadmapPayload(out, payload.roadmapSlug)
        workItems.push({
          target_key: st.target_key!,
          kind: 'feature',
          title: requireItemTitle(payload.item),
          status: mapLifecycleStatus(payload.item.status),
          depends_on_keys: resolveItemDepends(payload, out, itemFinalTarget),
          created: resolveRoadmapCreated(roadmapPayload),
          source_refs: [locatorRef(st.entity)],
        })
      } else if (st.entity.category === 'roadmap-item' && st.action === 'merge') {
        const payload = st.entity.payload as RoadmapItemPayload
        const featureKey = st.merge_into!
        const wi = workItems.find((w) => w.target_key === featureKey)
        if (wi) {
          wi.title = requireItemTitle(payload.item)
          wi.status = mapLifecycleStatus(payload.item.status)
          wi.depends_on_keys = sortUniqueUtf8([
            ...wi.depends_on_keys,
            ...resolveItemDepends(payload, out, itemFinalTarget),
          ])
        }
      } else if (st.entity.category === 'adr') {
        knowledge.push(buildAdrKnowledge(st))
      } else if (st.entity.category === 'compound') {
        knowledge.push(buildCompoundKnowledge(st))
      } else if (st.entity.category === 'attention-rule') {
        knowledge.push(buildAttentionKnowledge(st, projectEpoch))
      }
    } catch (error) {
      if (error instanceof MigrationError) {
        out[i] = errorState(st, error.detail!)
      } else {
        throw error
      }
    }
  }

  attachRoadmapGoalDepends(out, workItems, itemFinalTarget)
  return { states: out, workItems, knowledge }
}

function buildItemFinalTargetMap(states: EntityState[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const st of states) {
    if (st.entity.category !== 'roadmap-item') continue
    if (st.action === 'merge' && st.merge_into) {
      map.set(locatorRef(st.entity), st.merge_into)
    } else if (st.action === 'migrate' && st.target_key) {
      map.set(locatorRef(st.entity), st.target_key)
    } else if (st.action === 'error' || st.action === 'skip') {
      map.set(locatorRef(st.entity), '')
    }
  }
  return map
}

function attachRoadmapGoalDepends(
  states: EntityState[],
  workItems: PlannedWorkItem[],
  itemFinalTarget: Map<string, string>,
): void {
  for (const st of states) {
    if (st.entity.category !== 'roadmap' || st.action === 'error' || st.action === 'skip') continue
    const payload = st.entity.payload as RoadmapPayload
    const goal = workItems.find((w) => w.target_key === wiRoadmapKey(payload.slug))
    if (!goal) continue
    const deps: string[] = []
    for (const other of states) {
      if (other.entity.category !== 'roadmap-item') continue
      if (other.action === 'error') continue
      const p = other.entity.payload as RoadmapItemPayload
      if (p.roadmapSlug !== payload.slug) continue
      const target = itemFinalTarget.get(locatorRef(other.entity))
      if (target) deps.push(target)
    }
    goal.depends_on_keys = sortUniqueUtf8(deps)
  }
}

function resolveItemDepends(
  payload: RoadmapItemPayload,
  states: EntityState[],
  itemFinalTarget: Map<string, string>,
): string[] {
  const deps: string[] = []
  for (const depSlug of payload.item.depends_on) {
    const depLocator = `${payload.roadmapSlug}/${depSlug}`
    const depState = states.find(
      (s) =>
        s.entity.category === 'roadmap-item' &&
        s.entity.source_locator?.roadmap_slug === payload.roadmapSlug &&
        s.entity.source_locator.item_slug === depSlug,
    )
    if (!depState) throw depInvalid([depLocator])
    if (depState.action === 'skip') throw skipInvalid([depLocator, 'depends_on'])
    if (depState.action === 'error') throw depInvalid([depLocator])
    const feature = (depState.entity.payload as RoadmapItemPayload).item.feature?.trim()
    if (feature && depState.action === 'merge') {
      deps.push(wiAggregateKey('feature', feature))
      continue
    }
    const target = itemFinalTarget.get(depLocator)
    if (!target) throw depInvalid([depLocator])
    deps.push(target)
  }
  return sortUniqueUtf8(deps)
}

function step5Duplicates(
  states: EntityState[],
  workItems: PlannedWorkItem[],
  knowledge: PlannedKnowledge[],
): { states: EntityState[]; workItems: PlannedWorkItem[]; knowledge: PlannedKnowledge[] } {
  const out = [...states]
  const wiDupSha = new Map<string, string>()
  for (const w of [...workItems].sort((a, b) => compareUtf8(a.target_key, b.target_key))) {
    wiDupSha.set(w.target_key, wiDuplicateProjection(w))
  }
  const shaToFirstWi = new Map<string, string>()
  for (const [key, sha] of wiDupSha) {
    if (!shaToFirstWi.has(sha)) shaToFirstWi.set(sha, key)
  }

  const droppedWi = new Set<string>()
  for (let i = 0; i < out.length; i++) {
    const st = out[i]!
    if (st.action !== 'migrate' || !st.target_key) continue
    if (!wiDupSha.has(st.target_key)) continue
    const sha = wiDupSha.get(st.target_key)!
    const canonical = shaToFirstWi.get(sha)!
    if (canonical !== st.target_key) {
      droppedWi.add(st.target_key)
      out[i] = {
        ...st,
        action: 'skip',
        skip_reason: 'duplicate',
        target_key: canonical,
      }
    }
  }

  const knShaByTarget = new Map<string, string>()
  const knFirstBySha = new Map<string, string>()
  for (const k of [...knowledge].sort((a, b) => compareUtf8(a.target_key, b.target_key))) {
    const sha = knDuplicateProjection(k, bodySha256(k.body))
    knShaByTarget.set(k.target_key, sha)
    if (!knFirstBySha.has(sha)) knFirstBySha.set(sha, k.target_key)
  }
  const droppedKn = new Set<string>()
  for (let i = 0; i < out.length; i++) {
    const st = out[i]!
    if (st.action !== 'migrate' || !st.target_key) continue
    if (
      st.entity.category !== 'adr' &&
      st.entity.category !== 'compound' &&
      st.entity.category !== 'attention-rule'
    ) {
      continue
    }
    const sha = knShaByTarget.get(st.target_key)
    const canonical = sha ? knFirstBySha.get(sha) : undefined
    if (canonical && canonical !== st.target_key) {
      droppedKn.add(st.target_key)
      out[i] = {
        ...st,
        action: 'skip',
        skip_reason: 'duplicate',
        target_key: canonical,
      }
    }
  }

  return {
    states: out,
    workItems: workItems.filter((w) => !droppedWi.has(w.target_key)),
    knowledge: knowledge.filter((k) => !droppedKn.has(k.target_key)),
  }
}

function step6ReferencedSkips(states: EntityState[], workItems: PlannedWorkItem[]): EntityState[] {
  const entries = step8BuildEntries(states, [], [])
  const refs = collectReferencedTargetKeys(entries, workItems)
  const violations = findReferencedSkipViolations(entries, refs)
  if (violations.length === 0) return states
  const out = [...states]
  for (let i = 0; i < out.length; i++) {
    const st = out[i]!
    if (st.action !== 'skip' || !st.target_key) continue
    if (violations.includes(st.target_key)) {
      out[i] = errorState(st, {
        code: 'migration_skip_invalid',
        message_code: 'migration_skip_invalid',
        refs: [st.target_key],
      })
    }
  }
  return out
}

function applyGraphIssues(
  states: EntityState[],
  issues: Array<{ code: StableErrorCode; refs: string[] }>,
): EntityState[] {
  if (issues.length === 0) return states
  const out = [...states]
  const errorKeys = new Set<string>()
  for (const issue of issues) {
    for (const ref of issue.refs) errorKeys.add(ref)
  }
  for (let i = 0; i < out.length; i++) {
    const st = out[i]!
    if (st.target_key && errorKeys.has(st.target_key) && st.action !== 'error') {
      out[i] = errorState(st, {
        code: 'migration_dependency_invalid',
        message_code: 'migration_dependency_invalid',
        refs: sortUniqueUtf8([...errorKeys]),
      })
    }
    if (st.merge_into && errorKeys.has(st.merge_into) && st.action !== 'error') {
      out[i] = errorState(st, {
        code: 'migration_dependency_invalid',
        message_code: 'migration_dependency_invalid',
        refs: sortUniqueUtf8([...errorKeys]),
      })
    }
  }
  return out
}

/**
 * Builds MappingEntry.assertions that hash semantic-diff detail objects (D10a).
 */
function buildEntityAssertions(
  st: EntityState,
  workByKey: Map<string, PlannedWorkItem>,
  knByKey: Map<string, PlannedKnowledge>,
): AssertionEntry[] {
  if (st.action === 'error') {
    const detail = {
      id: 'error',
      passed: false,
      expected_sha256: null as string | null,
      actual_sha256: null as string | null,
      code: st.error?.code ?? 'migration_semantic_fidelity_failed',
    }
    return [{ id: 'error', passed: false, detail_sha256: sha256Canonical(detail) }]
  }
  if (st.action === 'skip') {
    const reasonSha = sha256Canonical(st.skip_reason ?? null)
    const detail = {
      id: 'skip_reason',
      passed: true,
      expected_sha256: reasonSha,
      actual_sha256: reasonSha,
      code: 'ok',
    }
    return [{ id: 'skip_reason', passed: true, detail_sha256: sha256Canonical(detail) }]
  }
  const key = st.target_key ?? st.merge_into
  let projection: unknown = {
    category: st.entity.category,
    action: st.action,
    source_digest: st.entity.source_digest,
    target_key: st.target_key ?? null,
    merge_into: st.merge_into ?? null,
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
      body_sha256: bodySha256(k.body),
    }
  }
  const sha = sha256Canonical(projection)
  const detail = {
    id: 'projection',
    passed: true,
    expected_sha256: sha,
    actual_sha256: sha,
    code: 'ok',
  }
  return [{ id: 'projection', passed: true, detail_sha256: sha256Canonical(detail) }]
}

function step8BuildEntries(
  states: EntityState[],
  workItems: PlannedWorkItem[],
  knowledge: PlannedKnowledge[],
): MappingEntry[] {
  const workByKey = new Map(workItems.map((w) => [w.target_key, w]))
  const knByKey = new Map(knowledge.map((k) => [k.target_key, k]))
  const entries: MappingEntry[] = states.map((st) => {
    const field_map =
      st.action === 'migrate' || st.action === 'merge'
        ? [{ target_field: 'source', source_refs: sortUniqueUtf8([st.entity.source_key]) }]
        : []
    field_map.sort((a, b) => compareUtf8(a.target_field, b.target_field))
    const assertions = buildEntityAssertions(st, workByKey, knByKey)
    const entry: MappingEntry = {
      category: st.entity.category,
      source_key: st.entity.source_key,
      ...(st.entity.source_locator ? { source_locator: st.entity.source_locator } : {}),
      source_digest: st.entity.source_digest,
      action: st.action,
      field_map,
      assertions,
    }
    if (st.action === 'migrate' && st.target_key) {
      entry.target_key = st.target_key
      entry.target_id = null
    }
    if (st.action === 'merge' && st.merge_into) {
      entry.merge_into = st.merge_into
      entry.target_id = null
    }
    if (st.action === 'skip') {
      entry.skip_reason = st.skip_reason
      if (st.target_key) entry.target_key = st.target_key
      entry.target_id = null
    }
    return entry
  })
  return sortByMappingIdentity(entries)
}

function collectErrors(states: EntityState[]): MigrationPlan['errors'] {
  return states
    .filter((s) => s.error)
    .map((s) => ({
      code: s.error!.code,
      category: s.entity.category,
      source_key: s.entity.source_key,
      ...(s.entity.source_locator ? { source_locator: s.entity.source_locator } : {}),
      detail: s.error!,
    }))
}

function computeProjectEpoch(states: EntityState[], csRoot: string): string {
  void csRoot
  const candidates: string[] = []
  for (const st of states) {
    if (st.entity.category === 'roadmap') {
      const p = st.entity.payload as RoadmapPayload
      if (p.created) candidates.push(normalizeCreated(p.created))
      if (p.itemsCreated) candidates.push(normalizeCreated(p.itemsCreated))
    }
    if (
      st.entity.category === 'feature' ||
      st.entity.category === 'issue' ||
      st.entity.category === 'refactor' ||
      st.entity.category === 'goal'
    ) {
      const ld = leadingDate(st.entity.source_key)
      if (ld) candidates.push(normalizeCreated(ld))
    }
  }
  if (candidates.length === 0) throw fidelityError(['project_epoch:missing'])
  candidates.sort(compareUtf8)
  return candidates[0]!
}

function findBoundItem(states: EntityState[], featureKey: string): RoadmapItemPayload | null {
  for (const st of states) {
    if (st.entity.category !== 'roadmap-item' || st.action !== 'merge') continue
    const p = st.entity.payload as RoadmapItemPayload
    if (p.item.feature === featureKey) return p
  }
  return null
}

function findRoadmapPayload(states: EntityState[], slug: string): RoadmapPayload {
  const st = states.find(
    (s) => s.entity.category === 'roadmap' && (s.entity.payload as RoadmapPayload).slug === slug,
  )
  if (!st) throw fidelityError([slug, 'roadmap'])
  return st.entity.payload as RoadmapPayload
}

function resolveAggregateCreated(csRoot: string, payload: AggregatePayload): string {
  const sourceKey = payload.relDir.split('/').pop() ?? ''
  const ld = leadingDate(sourceKey)
  if (ld) return normalizeCreated(ld)
  return scanAggregateCreatedFromFrontmatter(csRoot, payload)
}

function resolveFeatureCreated(csRoot: string, featureKey: string): string {
  const ld = leadingDate(featureKey)
  if (ld) return normalizeCreated(ld)
  return scanAggregateCreatedFromFrontmatter(csRoot, {
    kind: 'feature',
    relDir: `features/${featureKey}`,
    isSemanticallyEmpty: false,
  })
}

function scanAggregateCreatedFromFrontmatter(csRoot: string, payload: AggregatePayload): string {
  const dir = join(csRoot, ...payload.relDir.split('/'))
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    throw fidelityError([payload.relDir, 'created'])
  }
  const prefix = `${payload.kind}-`
  const sourceKey = payload.relDir.split('/').pop() ?? ''
  const dates: string[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const text = readFileSync(join(dir, name), 'utf8')
    const { frontmatter } = parseMarkdownDocument(text)
    const docType = typeof frontmatter.doc_type === 'string' ? frontmatter.doc_type : ''
    const entity =
      frontmatter[payload.kind] ??
      frontmatter.feature ??
      frontmatter.issue ??
      frontmatter.refactor ??
      frontmatter.goal
    const entityStr = typeof entity === 'string' ? entity : ''
    if (!docType.startsWith(prefix)) continue
    if (entityStr && entityStr !== sourceKey) continue
    dates.push(readStrictCreated(frontmatter, `${payload.relDir}/${name}`))
  }
  if (dates.length === 0) throw fidelityError([payload.relDir, 'created'])
  dates.sort(compareUtf8)
  return dates[0]!
}

function readStrictCreated(fm: Record<string, unknown>, ref: string): string {
  const created = fm.created
  const date = fm.date
  if (typeof created === 'string' && typeof date === 'string') {
    const nc = normalizeCreated(created)
    const nd = normalizeCreated(date)
    if (nc !== nd) throw fidelityError([ref, 'created-date-mismatch'])
    return nc
  }
  if (typeof created === 'string') return normalizeCreated(created)
  if (typeof date === 'string') return normalizeCreated(date)
  throw fidelityError([ref, 'created'])
}

function resolveAggregateStatus(csRoot: string, payload: AggregatePayload): string {
  const dir = join(csRoot, ...payload.relDir.split('/'))
  const sourceKey = payload.relDir.split('/').pop() ?? ''
  const { stage } = resolveAggregateStageSync(dir, sourceKey, payload.kind)
  return stageToStatus(stage)
}

function resolveAggregateStageSync(
  dir: string,
  sourceKey: string,
  kind: AggregatePayload['kind'],
): { stage: 'accepted' | 'verify' | 'implementing' | 'design' | 'missing' } {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return { stage: 'missing' }
  }
  const order = ['missing', 'design', 'implementing', 'verify', 'accepted'] as const
  let best: (typeof order)[number] = 'missing'
  for (const name of names) {
    if (!name.endsWith('.md') && !name.endsWith('.yaml') && !name.endsWith('.yml')) continue
    const text = readFileSync(join(dir, name), 'utf8')
    const { frontmatter } = parseMarkdownDocument(text)
    const docType = typeof frontmatter.doc_type === 'string' ? frontmatter.doc_type : ''
    const entityField =
      frontmatter[kind] ??
      frontmatter.feature ??
      frontmatter.issue ??
      frontmatter.refactor ??
      frontmatter.goal
    if (typeof entityField === 'string' && entityField !== sourceKey) continue
    const status = typeof frontmatter.status === 'string' ? frontmatter.status : ''
    let stage: (typeof order)[number] | null = null
    if (docType.endsWith('-acceptance') && (status === 'passed' || status === 'accepted')) {
      stage = 'accepted'
    } else if (
      (docType.endsWith('-qa') ||
        docType.endsWith('-code-review') ||
        docType.endsWith('-design-review')) &&
      status === 'passed'
    ) {
      stage = 'verify'
    } else if (docType.endsWith('-implementation') && status === 'completed') {
      stage = 'implementing'
    } else if (name.includes('-checklist.') && checklistAllDone(text)) {
      stage = 'implementing'
    } else if (docType.endsWith('-design') || docType.endsWith('-report')) {
      stage = 'design'
    }
    if (stage && order.indexOf(stage) > order.indexOf(best)) best = stage
  }
  return { stage: best }
}

function checklistAllDone(text: string): boolean {
  try {
    const doc = parseYaml(text) as {
      steps?: Array<{ status?: string }>
      checks?: Array<{ status?: string }>
    }
    const items = [...(doc.steps ?? []), ...(doc.checks ?? [])]
    if (items.length === 0) return false
    return items.every((i) => i.status === 'done')
  } catch {
    return false
  }
}

function resolveRoadmapCreated(payload: RoadmapPayload): string {
  if (payload.itemsCreated) return normalizeCreated(payload.itemsCreated)
  if (payload.created) return normalizeCreated(payload.created)
  throw fidelityError([payload.slug, 'created'])
}

function resolveRoadmapDocStatus(payload: RoadmapPayload): string {
  const raw = payload.frontmatter.status
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new MigrationError('migration_status_missing', {
      detail: {
        code: 'migration_status_missing',
        message_code: 'migration_status_missing',
        refs: [payload.slug],
      },
    })
  }
  return mapLifecycleStatus(String(raw))
}

function requireItemTitle(item: RoadmapItemPayload['item']): string {
  const title = unicodeTrim(item.description)
  if (!title) throw fidelityError([item.slug, 'title'])
  return title
}

function buildAdrKnowledge(st: EntityState): PlannedKnowledge {
  const payload = st.entity.payload as DocFilePayload
  const title = unicodeTrim(String(payload.frontmatter.title ?? ''))
  if (!title) throw fidelityError([payload.relPath, 'title'])
  const created = readStrictCreated(payload.frontmatter, payload.relPath)
  const statusRaw = String(payload.frontmatter.status ?? 'accepted').trim()
  const status = mapAdrStatus(statusRaw)
  const tags = buildAdrTags(payload.frontmatter, statusRaw)
  const body = normalizeLf(payload.body)
  assertAdrSections(body, payload.relPath)
  return {
    target_key: st.target_key!,
    type: 'adr',
    title,
    status,
    tags,
    created,
    source: payload.relPath,
    body,
    source_refs: [payload.relPath],
  }
}

function buildCompoundKnowledge(st: EntityState): PlannedKnowledge {
  const payload = st.entity.payload as DocFilePayload
  const docTypeRaw = payload.frontmatter.doc_type
  if (docTypeRaw === undefined || docTypeRaw === null || unicodeTrim(String(docTypeRaw)) === '') {
    throw new MigrationError('migration_type_missing', {
      detail: {
        code: 'migration_type_missing',
        message_code: 'migration_type_missing',
        refs: [payload.relPath],
      },
    })
  }
  const docType = unicodeTrim(String(docTypeRaw))
  const knType = mapCompoundDocType(docType, payload.relPath)
  const title = unicodeTrim(String(payload.frontmatter.title ?? ''))
  if (!title) throw fidelityError([payload.relPath, 'title'])
  let created: string
  try {
    created = readStrictCreated(payload.frontmatter, payload.relPath)
  } catch {
    const ld = leadingDate(baseName(payload.relPath))
    if (!ld) throw fidelityError([payload.relPath, 'created'])
    created = normalizeCreated(ld)
  }
  return {
    target_key: st.target_key!,
    type: knType,
    title,
    status: 'active',
    tags: sortUniqueUtf8([`doc_type:${docType}`]),
    created,
    source: payload.relPath,
    body: normalizeLf(payload.body),
    source_refs: [payload.relPath],
  }
}

function buildAttentionKnowledge(st: EntityState, projectEpoch: string): PlannedKnowledge {
  const payload = st.entity.payload as AttentionRulePayload
  return {
    target_key: st.target_key!,
    type: 'rule',
    title: `${payload.h2} #${payload.ordinal}`,
    status: 'active',
    tags: payload.tags,
    created: projectEpoch,
    source: payload.attentionRelPath,
    body: payload.body,
    source_refs: [payload.attentionRelPath],
  }
}

function mapCompoundDocType(docType: string, ref: string): 'learning' | 'note' {
  if (docType === 'learning' || docType === 'pitfall' || docType === 'trick') return 'learning'
  if (
    docType === 'explore' ||
    docType === 'spike' ||
    docType === 'question' ||
    docType === 'research' ||
    docType === 'note' ||
    docType === 'knowledge'
  ) {
    return 'note'
  }
  throw fidelityError([ref, `doc_type:${docType}`])
}

function mapAdrStatus(raw: string): 'active' | 'superseded' | 'deprecated' {
  if (raw === 'accepted' || raw === 'proposed') return 'active'
  if (raw === 'superseded') return 'superseded'
  if (raw === 'deprecated') return 'deprecated'
  throw fidelityError([`adr-status:${raw}`])
}

function buildAdrTags(fm: Record<string, unknown>, statusRaw: string): string[] {
  const tags: string[] = []
  if (statusRaw === 'proposed') tags.push('proposed')
  if (Array.isArray(fm.tags)) {
    for (const t of fm.tags) if (typeof t === 'string') tags.push(t)
  }
  return sortUniqueUtf8(tags)
}

function assertAdrSections(body: string, ref: string): void {
  for (const h of ['## Context', '## Decision', '## Consequences', '## Alternatives Considered']) {
    if (!body.includes(h)) throw fidelityError([ref, h])
  }
}

function normalizeLf(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function baseName(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] ?? p
}

function entityRefMatches(entity: SourceEntity, ref: DecisionEntry['ref']): boolean {
  if (entity.category !== ref.category || entity.source_key !== ref.source_key) return false
  if (ref.source_locator) {
    if (!entity.source_locator) return false
    return (
      entity.source_locator.roadmap_slug === ref.source_locator.roadmap_slug &&
      entity.source_locator.item_slug === ref.source_locator.item_slug
    )
  }
  return !entity.source_locator
}

function resolveDefaultTargetKey(entity: SourceEntity): string {
  if (entity.category === 'roadmap') return wiRoadmapKey((entity.payload as RoadmapPayload).slug)
  if (entity.category === 'roadmap-item') {
    const p = entity.payload as RoadmapItemPayload
    return wiRoadmapItemKey(p.roadmapSlug, p.item.slug)
  }
  if (
    entity.category === 'feature' ||
    entity.category === 'issue' ||
    entity.category === 'refactor' ||
    entity.category === 'goal'
  ) {
    return wiAggregateKey(entity.category, entity.source_key)
  }
  return knKey(entity.category, entity.source_key)
}

function locatorRef(entity: SourceEntity): string {
  const loc = entity.source_locator!
  return `${loc.roadmap_slug}/${loc.item_slug}`
}

function errorState(st: EntityState, detail: ErrorDetail): EntityState {
  return {
    ...st,
    action: 'error',
    target_key: undefined,
    merge_into: undefined,
    skip_reason: undefined,
    error: detail,
  }
}

function mergeConflictDetail(locators: string[]): ErrorDetail {
  return {
    code: 'migration_merge_conflict',
    message_code: 'migration_merge_conflict',
    refs: locators,
  }
}

function fidelityError(refs: string[]): MigrationError {
  return new MigrationError('migration_semantic_fidelity_failed', {
    detail: {
      code: 'migration_semantic_fidelity_failed',
      message_code: 'migration_semantic_fidelity_failed',
      refs,
    },
  })
}

function depInvalid(refs: string[]): MigrationError {
  return new MigrationError('migration_dependency_invalid', {
    detail: {
      code: 'migration_dependency_invalid',
      message_code: 'migration_dependency_invalid',
      refs,
    },
  })
}

function skipInvalid(refs: string[]): MigrationError {
  return new MigrationError('migration_skip_invalid', {
    detail: {
      code: 'migration_skip_invalid',
      message_code: 'migration_skip_invalid',
      refs,
    },
  })
}

/** Builds mandatory category counts from mapping entries. */
export function codestableMandatoryCounts(entries: MappingEntry[]) {
  return buildCodestableMandatoryCounts(entries)
}

export { buildCodestableMandatoryCounts }

/**
 * Shared migrate types (internal; not public artifact schemas).
 */

export type MigrationFrom = 'codestable' | 'superpowers'

export type MappingCategory =
  | 'feature'
  | 'issue'
  | 'refactor'
  | 'goal'
  | 'roadmap'
  | 'roadmap-item'
  | 'adr'
  | 'compound'
  | 'attention-rule'
  | 'superpowers-profile'
  | 'superpowers-note'

export type MappingAction = 'migrate' | 'merge' | 'skip' | 'error'

export type SkipReason = 'empty-placeholder' | 'owner-deprecated' | 'duplicate'

export type StableErrorCode =
  | 'migration_source_not_found'
  | 'migration_source_unsafe'
  | 'migration_path_overlap'
  | 'migration_source_version_unsupported'
  | 'migration_license_invalid'
  | 'migration_status_missing'
  | 'migration_status_unknown'
  | 'migration_type_missing'
  | 'migration_merge_conflict'
  | 'migration_dependency_invalid'
  | 'migration_skip_invalid'
  | 'migration_target_exists'
  | 'migration_lock_held'
  | 'migration_source_changed'
  | 'migration_validation_failed'
  | 'migration_semantic_fidelity_failed'
  | 'migration_staging_conflict'
  | 'migration_promote_failed'
  | 'migration_io_failed'
  | 'usage_error'

export interface SourceLocator {
  roadmap_slug: string
  item_slug: string
}

export interface ManifestFile {
  path: string
  type: 'file' | 'directory'
  size: number
  sha256: string | null
}

export interface SourceManifest {
  version: 1
  adapter_id: string
  files: ManifestFile[]
}

export interface EntityRef {
  category: MappingCategory
  source_key: string
  source_locator?: SourceLocator
}

export interface DecisionEntry {
  ref: EntityRef
  action: 'skip'
  reason: string
  approved_by: string
  approved_at: string
}

export interface MigrationDecisions {
  version: 1
  entries: DecisionEntry[]
}

export interface ProvenanceRecord {
  source_path: string
  source_sha256: string
  owner_source_key: string | null
  role: 'support' | 'evidence-only'
  stage_contribution: Array<'intent' | 'design' | 'implementation' | 'review' | 'qa' | 'acceptance'>
}

export type DiscardReason =
  | 'forbidden-block'
  | 'unselected-markdown'
  | 'host-agent-prompt'
  | 'source-script'
  | 'binary-asset'
  | 'package-evidence'
  | 'empty-placeholder'

export interface DiscardedRecord {
  source_path: string
  heading: string | null
  source_sha256: string
  reason: DiscardReason
}

export interface FieldMapEntry {
  target_field: string
  source_refs: string[]
}

export interface AssertionEntry {
  id: string
  passed: boolean
  detail_sha256: string
}

export interface MappingEntry {
  category: MappingCategory
  source_key: string
  source_locator?: SourceLocator
  source_digest: string
  action: MappingAction
  target_key?: string
  target_id?: string | null
  merge_into?: string
  skip_reason?: SkipReason
  field_map: FieldMapEntry[]
  assertions: AssertionEntry[]
}

export interface ErrorDetail {
  code: StableErrorCode
  message_code: StableErrorCode
  refs: string[]
}

export interface ErrorDetailEntry {
  detail_sha256: string
  detail: ErrorDetail
}

export interface ReportError {
  code: StableErrorCode
  category: string | null
  source_key: string | null
  source_locator?: SourceLocator
  detail_sha256: string
}

export interface MandatoryCategoryCount {
  category: MappingCategory
  discovered: number
  migrated: number
  merged: number
  skipped: number
  failed: number
}

export interface MigrationCounts {
  discovered: number
  migrated: number
  merged: number
  skipped: number
  evidence: number
  discarded: number
  failed: number
  mandatory_by_category: MandatoryCategoryCount[]
}

export interface ReportJson {
  version: 1
  migration_id: string
  from: MigrationFrom
  mode: 'audit' | 'apply'
  status: 'succeeded' | 'failed'
  adapter_id: string
  plan_version: number
  source_manifest_sha256: string
  decisions_sha256: string
  fingerprint: string
  counts: MigrationCounts
  provenance: ProvenanceRecord[]
  discarded: DiscardedRecord[]
  errors: ReportError[]
}

export interface SemanticDiffDetail {
  id: string
  passed: boolean
  expected_sha256: string | null
  actual_sha256: string | null
  code: string
}

export interface SemanticDiffEntry {
  category: MappingCategory
  source_key: string
  target_id: string | null
  details: SemanticDiffDetail[]
}

export interface SemanticDiff {
  version: 1
  entries: SemanticDiffEntry[]
}

export interface TargetManifest {
  version: 1
  files: Array<{ path: string; size: number; sha256: string }>
}

export interface Receipt {
  version: 1
  migration_id: string
  from: MigrationFrom
  plan_version: number
  adapter_id: string
  fingerprint: string
  source_manifest_sha256: string
  decisions_sha256: string
  mapping_sha256: string
  semantic_diff_sha256: string
  target_manifest_sha256: string
  applied_at: string
}

export interface ReportPointer {
  base: 'target' | 'report-dir' | 'staging'
  path: string
}

/** Logical WorkItem projection before ID assignment. */
export interface PlannedWorkItem {
  target_key: string
  kind: 'feature' | 'issue' | 'refactor' | 'goal'
  title: string
  status: string
  depends_on_keys: string[]
  created: string
  source_refs: string[]
}

/** Logical Knowledge projection before ID assignment. */
export interface PlannedKnowledge {
  target_key: string
  type: 'rule' | 'adr' | 'learning' | 'note'
  title: string
  status: 'active' | 'superseded' | 'deprecated'
  tags: string[]
  created: string
  source: string
  body: string
  source_refs: string[]
}

/** Logical RoleProfile projection. */
export interface PlannedRoleProfile {
  target_key: string
  name: string
  capabilities: string[]
  boundaries: string[]
  deliverables: string[]
  verification: string[]
  prompt_fragments: string[]
  fragment_contents: Record<string, string>
  source_refs: string[]
}

export interface MigrationPlan {
  from: MigrationFrom
  adapter_id: string
  plan_version: 1
  source_manifest_sha256: string
  decisions_sha256: string
  entries: MappingEntry[]
  work_items: PlannedWorkItem[]
  knowledge: PlannedKnowledge[]
  profiles: PlannedRoleProfile[]
  provenance: ProvenanceRecord[]
  discarded: DiscardedRecord[]
  errors: Array<{
    code: StableErrorCode
    category: string | null
    source_key: string | null
    source_locator?: SourceLocator
    detail: ErrorDetail
  }>
  has_errors: boolean
}

export interface MaterializationPlan {
  apply_date: string
  apply_instant: string
  work_items: Array<PlannedWorkItem & { id: string; depends_on: string[] }>
  knowledge: Array<PlannedKnowledge & { id: string }>
  profiles: PlannedRoleProfile[]
  key_to_id: Record<string, string>
}

export interface SourceEntity {
  category: MappingCategory
  source_key: string
  source_locator?: SourceLocator
  source_digest: string
  payload: unknown
}

export interface DetectedSource {
  from: MigrationFrom
  adapter_id: string
  root: string
}

export interface SourceAdapter {
  readonly from: MigrationFrom
  detect(root: string): Promise<DetectedSource>
  scan(
    root: string,
    manifest: SourceManifest,
  ): Promise<{
    entities: SourceEntity[]
    provenance: ProvenanceRecord[]
    discarded: DiscardedRecord[]
  }>
  map(entities: SourceEntity[], decisions: MigrationDecisions, ctx: MapContext): MigrationPlan
}

export interface MapContext {
  adapter_id: string
  source_manifest_sha256: string
  decisions_sha256: string
  source_root: string
  manifest: SourceManifest
  provenance: ProvenanceRecord[]
  discarded: DiscardedRecord[]
}

export class MigrationError extends Error {
  readonly code: StableErrorCode
  readonly detail?: ErrorDetail
  readonly issues?: ErrorDetail[]
  readonly migration_id?: string
  readonly report?: ReportPointer
  readonly exitCode: 1 | 2

  constructor(
    code: StableErrorCode,
    options: {
      message?: string
      detail?: ErrorDetail
      issues?: ErrorDetail[]
      migration_id?: string
      report?: ReportPointer
      exitCode?: 1 | 2
    } = {},
  ) {
    super(options.message ?? code)
    this.name = 'MigrationError'
    this.code = code
    this.detail = options.detail
    this.issues = options.issues
    this.migration_id = options.migration_id
    this.report = options.report
    this.exitCode = options.exitCode ?? (code === 'usage_error' ? 2 : 1)
  }
}

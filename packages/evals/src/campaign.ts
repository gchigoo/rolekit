import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { evaluateRun } from './evaluate.ts'
import { auditRunIntegrity } from './integrity.ts'
import { checkResearch } from '../../../scripts/check-research.ts'

const ITEM_ORDER = [
  'RK-01',
  'RK-02',
  'RK-03',
  'RK-04',
  'RK-05',
  'RK-06',
  'CTX-01',
  'CTX-02',
  'CTX-03',
  'RK-07',
] as const
const CATEGORY_ORDER = [
  'identity',
  'plan',
  'source',
  'ledger',
  'orphan',
  'integrity',
  'scope',
  'research',
  'gate',
  'metric',
  'dependency',
  'live-evidence',
  'migration',
  'review',
  'promotion',
  'docs',
] as const
const SHA = /^[0-9a-f]{64}$/
/** D6a confirm trigger whitelist. */
export const CONFIRM_TRIGGERS = new Set([
  'new-dependency',
  'migration',
  'public-api-change',
  'delete',
  'ambiguous-requirement',
  'design-artifact',
  'final-acceptance',
])
const CALLER_PACK_FILES = [
  'receipt.json',
  'pre-state.json',
  'caller-process.json',
  'pre-supervisor.json',
  'terminal-supervisor.json',
  'caller-exit.json',
  'handoff-output.json',
] as const
const OWNER_PACK_FILES = [
  'receipt.json',
  'pre-state.json',
  'pre-supervisor.json',
  'pre-executor.json',
  'owner-exit.json',
  'orphan-exit.json',
  'reconcile-output.json',
] as const
const EMPTY_PATCH_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/

type ItemKey = (typeof ITEM_ORDER)[number]
type Stage = 'pre-review' | 'final'
type JsonObject = Record<string, unknown>

export interface DogfoodPlan {
  version: 1
  campaign_id: string
  projects: { 'rolekit-self': string; ctxline: string }
  items: DogfoodPlanItem[]
  steer_assertions?: Array<{
    item_key: string
    nonce_sha256: string
    proves_delivery?: boolean
    relative_file?: string
    acceptance_argv?: string[]
  }>
  [key: string]: unknown
}

export interface DogfoodPlanItem {
  key: ItemKey
  project: 'rolekit-self' | 'ctxline'
  profile: 'implementer' | 'reviewer' | 'researcher' | 'qa'
  patch_class: 'code' | 'test' | 'research' | 'review'
  lane: 'delegated'
  [key: string]: unknown
}

export interface CampaignInput {
  campaignRoot: string
  campaignId: string
  plan: DogfoodPlan
}

export interface CampaignBlocker {
  category: (typeof CATEGORY_ORDER)[number]
  code: string
  key: ItemKey | null
  run_ref: string | null
  evidence_sha256: string | null
}

export interface LedgerRun {
  run_ref: string
  key: ItemKey | null
  attempt: number | null
  predecessor_run_ref: string | null
  reservation_sha256: string | null
  candidate_build_receipt_sha256: string | null
  candidate_start_intent_sha256: string | null
  candidate_start_result_sha256: string | null
  run_content_sha256: string | null
  task_sha256: string | null
  result_sha256: string | null
  verification_sha256: string | null
  events_sha256: string | null
  status: 'completed' | 'blocked' | 'question' | 'failed' | 'cancelled' | null
  contract_pass: boolean | null
  envelope_pass: boolean | null
  integrity_pass: boolean | null
  scope_violations_count: number | null
}

export interface LedgerWorkItem {
  key: ItemKey
  project: 'rolekit-self' | 'ctxline'
  workitem_id: string | null
  status: string | null
  lane: 'delegated' | null
  profile: DogfoodPlanItem['profile']
  patch_class: DogfoodPlanItem['patch_class']
  workitem_sha256: string | null
  evidence_commit_sha256: string | null
  patch_sha256: string | null
  patch_qualifies: boolean | null
  run_refs: string[]
}

export interface LedgerGate {
  key: ItemKey
  run_ref: string | null
  source: 'run' | 'workitem'
  trigger: string
  decision: 'pending' | 'approved' | 'rejected'
  record_sha256: string
}

export interface ResearchCheck {
  key: 'RK-06'
  run_ref: string | null
  record_sha256: string | null
  pass: boolean
  reason:
    | 'no_completed_run'
    | 'command_missing'
    | 'credential_missing'
    | 'command_failed'
    | 'record_invalid'
    | null
}

export interface LiveEvidence {
  caller_crash: { receipt_sha256: string | null; pass: boolean }
  owner_loss: { receipt_sha256: string | null; pass: boolean }
  steer: {
    assertions: Array<{
      item_key: 'RK-03' | 'RK-05'
      nonce_sha256: string
      run_ref: string | null
      pass: boolean
    }>
    pass: boolean
  }
}

export interface CampaignSnapshot {
  version: 1
  stage: Stage
  audit: { status: 'pass' | 'fail'; blockers: CampaignBlocker[] }
  ledger: {
    version: 1
    campaign_id: string
    stage: Stage
    plan_sha256: string
    resolved_plan_sha256: string | null
    campaign_started_sha256: string | null
    campaign_sealed_sha256: string | null
    steer_nonces_sha256: string | null
    workitems: LedgerWorkItem[]
    runs: LedgerRun[]
    gates: LedgerGate[]
    research_checks: ResearchCheck[]
    live_evidence: LiveEvidence
  }
  metrics: DogfoodMetrics
  research_checks: ResearchCheck[]
  live_evidence: LiveEvidence
}

export type CampaignEvaluation = CampaignSnapshot & { stage: 'final' }

export interface DogfoodMetrics {
  version: 1
  campaign_id: string
  stage: Stage
  workitems: { expected: number; done: number; delegated: number }
  runs: { total: number; orphan: number; duplicate_refs: number }
  contract: Rate
  envelope: Rate
  integrity: Rate
  scope: { violations: number; runs_with_violations: number }
  gates: { human_confirm: number; invalid_confirm: number; pending: number }
  patch_classes: {
    code: number
    test: number
    research: number
    review: number
    qualifying_code_test: number
  }
  profiles: string[]
  research: { passed: number; total: number }
  live_evidence: { passed: number; total: 3 }
}

export interface SwitchDecision {
  version: 1
  campaign_id: string
  verdict: 'go' | 'hold'
  blockers: CampaignBlocker[]
  campaign_evaluation_sha256: string
  ledger_sha256: string
  metrics_sha256: string
}

interface Rate {
  passed: number
  total: number
  rate_ppm: number
}

interface EvidenceRow {
  key: string
  project: string
  pre_head: string
  commit: string
  patch_sha256: string | null
}

type AddBlocker = (
  category: CampaignBlocker['category'],
  code: string,
  key?: ItemKey | null,
  runRef?: string | null,
  evidence?: string | null,
) => void

/** The public evaluator always uses the final-stage formula. */
export async function evaluateCampaign(input: CampaignInput): Promise<CampaignEvaluation> {
  return (await buildCampaignArtifacts(input, 'final')) as CampaignEvaluation
}

/** Builds the one ledger/metrics/evaluation projection used by review and final audit. */
export async function buildCampaignArtifacts(
  input: CampaignInput,
  stage: Stage,
): Promise<CampaignSnapshot> {
  const blockers: CampaignBlocker[] = []
  const add: AddBlocker = (category, code, key = null, runRef = null, evidence = null) => {
    blockers.push({
      category,
      code,
      key,
      run_ref: runRef,
      evidence_sha256: evidence && SHA.test(evidence) ? evidence : null,
    })
  }
  const root = resolve(input.campaignRoot)
  if (!input.campaignId || input.plan.campaign_id !== input.campaignId)
    add('identity', 'campaign_identity_mismatch')
  if (input.plan.version !== 1) add('plan', 'plan_version_invalid')
  if (!safeProjectMap(root, input.plan.projects)) add('plan', 'project_map_invalid')
  const expectedKeys = stage === 'final' ? ITEM_ORDER : ITEM_ORDER.filter((key) => key !== 'RK-07')
  const planItems = expectedKeys
    .map((key) => input.plan.items.find((item) => item.key === key))
    .filter((item): item is DogfoodPlanItem => item !== undefined)
  if (
    planItems.length !== expectedKeys.length ||
    new Set(input.plan.items.map((item) => item.key)).size !== input.plan.items.length
  )
    add('plan', 'plan_items_invalid')

  const raw = join(root, '.rolekit', 'dogfood', 'campaigns', input.campaignId)
  const planPath = join(root, 'plan.yaml')
  const planSha = fileSha(planPath) ?? sha(canonical(input.plan))
  const startedPath = join(raw, 'campaign-started.json')
  const resolvedPath = join(raw, 'resolved-plan.json')
  const sealedPath = join(raw, 'campaign-sealed.json')
  const noncePath = join(raw, 'steer-nonces.json')
  const started = readJson(startedPath)
  const resolvedPlan = readJson(resolvedPath)
  if (
    !isObject(started) ||
    started.campaign_id !== input.campaignId ||
    started.plan_sha256 !== planSha
  )
    add('identity', 'campaign_started_invalid')
  if (!isObject(resolvedPlan)) add('ledger', 'resolved_plan_missing')
  if (stage === 'final' && !isObject(readJson(sealedPath))) add('ledger', 'campaign_not_sealed')

  const evidenceByKey = loadEvidenceRows(raw, root, input.plan.projects)
  const resolutions =
    isObject(resolvedPlan) && Array.isArray(resolvedPlan.items) ? resolvedPlan.items : []
  const workitems: LedgerWorkItem[] = []
  const owners = new Map<string, ItemKey[]>()
  const workitemDocs = new Map<ItemKey, JsonObject>()
  for (const item of planItems) {
    const resolution = resolutions.find((entry) => isObject(entry) && entry.key === item.key)
    const workitemId =
      isObject(resolution) && typeof resolution.workitem_id === 'string'
        ? resolution.workitem_id
        : null
    const workitemPath = workitemId
      ? join(
          root,
          input.plan.projects[item.project],
          '.rolekit',
          'work-items',
          `${workitemId}.yaml`,
        )
      : null
    const bytes = workitemPath ? readBytes(workitemPath) : null
    const workitem = bytes ? parseDocument(bytes.toString('utf8')) : undefined
    if (!workitemId || !isObject(workitem)) add('ledger', 'workitem_missing', item.key)
    if (isObject(workitem)) workitemDocs.set(item.key, workitem)
    const refs =
      isObject(workitem) && Array.isArray(workitem.runs)
        ? workitem.runs
            .filter((id): id is string => typeof id === 'string')
            .map((id) => runRef(item.project, id))
        : []
    for (const ref of refs) owners.set(ref, [...(owners.get(ref) ?? []), item.key])
    const evidence = evidenceByKey.get(item.key) ?? null
    const projectRoot = join(root, input.plan.projects[item.project])
    const patchInfo = computePatchInfo(projectRoot, item, evidence, refs)
    workitems.push({
      key: item.key,
      project: item.project,
      workitem_id: workitemId,
      status: isObject(workitem) && typeof workitem.status === 'string' ? workitem.status : null,
      lane: isObject(workitem) && workitem.lane === 'delegated' ? 'delegated' : null,
      profile: item.profile,
      patch_class: item.patch_class,
      workitem_sha256: bytes ? sha(bytes) : null,
      evidence_commit_sha256: patchInfo.evidence_commit_sha256,
      patch_sha256: patchInfo.patch_sha256,
      patch_qualifies: patchInfo.patch_qualifies,
      run_refs: refs,
    })
  }

  for (const item of planItems) {
    const runsDir = join(root, input.plan.projects[item.project], '.rolekit', 'runs')
    for (const id of directoryNames(runsDir)) {
      const ref = runRef(item.project, id)
      if (!owners.has(ref)) owners.set(ref, [])
    }
  }

  const runs: LedgerRun[] = []
  for (const [ref, refOwners] of [...owners].sort(([a], [b]) =>
    Buffer.from(a).compare(Buffer.from(b)),
  )) {
    const dir = resolve(root, ...ref.split('/'))
    const state = readJson(join(dir, 'run-state.json'))
    const result = readJson(join(dir, 'result.json'))
    const terminal = isObject(state) && state.phase === 'terminal' && isObject(result)
    const evaluation = terminal ? evaluateRun(dir) : null
    const integrity = terminal ? await auditRunIntegrity(dir) : null
    const owner = refOwners.length === 1 ? (refOwners[0] ?? null) : null
    if (refOwners.length === 0) add('orphan', 'orphan_run', null, ref)
    if (refOwners.length > 1) add('orphan', 'duplicate_run_ref', null, ref)
    if (!terminal) add('ledger', 'run_not_terminal', owner, ref)
    if (integrity && !integrity.pass) add('integrity', 'run_integrity_failed', owner, ref)
    const scope =
      isObject(result) && Array.isArray(result.scope_violations)
        ? result.scope_violations.length
        : null
    const resultStatus = isObject(result) && isResultStatus(result.status) ? result.status : null
    if (scope === null) add('scope', 'scope_not_evaluated', owner, ref)
    else if (scope > 0)
      add('scope', 'scope_violation', owner, ref, fileSha(join(dir, 'result.json')))
    runs.push({
      run_ref: ref,
      key: owner,
      attempt:
        isObject(state) && Number.isSafeInteger(state.attempt) ? Number(state.attempt) : null,
      predecessor_run_ref: null,
      reservation_sha256: null,
      candidate_build_receipt_sha256: null,
      candidate_start_intent_sha256: null,
      candidate_start_result_sha256: null,
      run_content_sha256: scanRunContent(dir).sha256,
      task_sha256: fileSha(join(dir, 'task.json')),
      result_sha256: fileSha(join(dir, 'result.json')),
      verification_sha256: fileSha(join(dir, 'verification.json')),
      events_sha256: fileSha(join(dir, 'events.jsonl')),
      status: resultStatus,
      contract_pass: evaluation ? evaluation.contract === 'pass' : null,
      envelope_pass: evaluation ? evaluation.envelope.pass : null,
      integrity_pass: integrity?.pass ?? null,
      scope_violations_count: scope,
    })
  }

  // Recompute patch_qualifies now that run contract/verification is known.
  for (const item of workitems) {
    if (item.patch_class !== 'code' && item.patch_class !== 'test') continue
    if (item.patch_qualifies !== true) continue
    if (!hasPassingRelatedRun(root, item.run_refs, runs)) item.patch_qualifies = false
  }

  const gates = collectLedgerGates(workitems, workitemDocs, root)
  for (const gate of gates) {
    if (!CONFIRM_TRIGGERS.has(gate.trigger))
      add('gate', 'invalid_confirm_trigger', gate.key, gate.run_ref, gate.record_sha256)
    if (gate.decision === 'pending')
      add('gate', 'confirm_pending', gate.key, gate.run_ref, gate.record_sha256)
  }

  const researchChecks: ResearchCheck[] = [
    evaluateResearchCheck(root, workitems, runs, raw),
  ]
  const live = evaluateLiveEvidence(root, raw, input.plan, workitems, runs, add)
  if (!researchChecks[0]?.pass)
    add('research', 'research_check_failed', 'RK-06', researchChecks[0]?.run_ref ?? null)

  const ledger = {
    version: 1 as const,
    campaign_id: input.campaignId,
    stage,
    plan_sha256: planSha,
    resolved_plan_sha256: fileSha(resolvedPath),
    campaign_started_sha256: fileSha(startedPath),
    campaign_sealed_sha256: stage === 'final' ? fileSha(sealedPath) : null,
    steer_nonces_sha256: fileSha(noncePath),
    workitems,
    runs,
    gates,
    research_checks: researchChecks,
    live_evidence: live,
  }
  const metrics = computeMetrics(
    input.campaignId,
    stage,
    workitems,
    runs,
    gates,
    researchChecks,
    live,
  )
  addMetricBlockers(metrics, runs, stage, add)
  const sorted = sortBlockers(blockers)
  return {
    version: 1,
    stage,
    audit: { status: sorted.length === 0 ? 'pass' : 'fail', blockers: sorted },
    ledger,
    metrics,
    research_checks: researchChecks,
    live_evidence: live,
  }
}

/**
 * Builds D10 SwitchDecision from one evaluation plus review/promotion/docs evidence.
 */
export function buildSwitchDecision(
  evaluation: CampaignEvaluation,
  options: {
    campaignRoot: string
    canonicalRoot?: string | null
  },
): SwitchDecision {
  const blockers = [...evaluation.audit.blockers]
  const add = (
    category: CampaignBlocker['category'],
    code: string,
    key: ItemKey | null = null,
    evidence: string | null = null,
  ) => {
    blockers.push({
      category,
      code,
      key,
      run_ref: null,
      evidence_sha256: evidence && SHA.test(evidence) ? evidence : null,
    })
  }
  const root = resolve(options.campaignRoot)
  const campaignId = evaluation.ledger.campaign_id
  const selfRoot = join(root, 'projects', 'rolekit-self')
  const reviewPath = join(selfRoot, 'dogfood', 'reviews', 'rk-07.json')
  const review = readJson(reviewPath)
  if (!isObject(review)) add('review', 'rk07_review_missing', 'RK-07')
  else {
    const findings = Array.isArray(review.blocking_findings) ? review.blocking_findings : null
    if (review.verdict !== 'pass' || !findings || findings.length > 0)
      add('review', 'rk07_review_failed', 'RK-07', fileSha(reviewPath))
  }

  const raw = join(root, '.rolekit', 'dogfood', 'campaigns', campaignId)
  const stagingDir = join(raw, 'publish')
  const artifactsPath = join(stagingDir, 'campaign-artifacts.json')
  const artifacts = readJson(artifactsPath)
  const evaluationSha = sha(canonical(evaluation))
  const ledgerSha = sha(canonical(evaluation.ledger))
  const metricsSha = sha(canonical(evaluation.metrics))
  if (!isObject(artifacts)) add('promotion', 'campaign_artifacts_missing')
  else {
    if (artifacts.campaign_evaluation_sha256 !== evaluationSha)
      add('promotion', 'promotion_digest_mismatch', null, evaluationSha)
    if (artifacts.ledger_sha256 !== ledgerSha)
      add('promotion', 'promotion_ledger_mismatch', null, ledgerSha)
    if (artifacts.metrics_sha256 !== metricsSha)
      add('promotion', 'promotion_metrics_mismatch', null, metricsSha)
  }

  const canonicalRoot = options.canonicalRoot ? resolve(options.canonicalRoot) : null
  if (canonicalRoot) {
    for (const name of [
      'campaign-evaluation.json',
      'ledger-summary.json',
      'metrics.json',
      'campaign-artifacts.json',
    ] as const) {
      const staging = join(stagingDir, name)
      const promoted = join(canonicalRoot, 'dogfood', 'reports', campaignId, name)
      const left = readBytes(staging)
      const right = readBytes(promoted)
      if (!left || !right || !left.equals(right))
        add('promotion', 'canonical_report_mismatch', null, left ? sha(left) : null)
    }
    const cutover = join(canonicalRoot, 'docs', 'operator-cutover.md')
    const adapters = join(canonicalRoot, 'adapters')
    if (!existsSync(cutover) || !existsSync(adapters)) add('docs', 'docs_surface_missing')
  } else if (evaluation.audit.status === 'pass') {
    add('docs', 'canonical_root_missing')
  }

  if (!evaluation.ledger.campaign_sealed_sha256) add('ledger', 'campaign_not_sealed')

  const sorted = sortBlockers(blockers)
  return {
    version: 1,
    campaign_id: campaignId,
    verdict: sorted.length === 0 ? 'go' : 'hold',
    blockers: sorted,
    campaign_evaluation_sha256: evaluationSha,
    ledger_sha256: ledgerSha,
    metrics_sha256: metricsSha,
  }
}

/** Renders SwitchDecision markdown deterministically. */
export function renderSwitchDecisionMarkdown(decision: SwitchDecision): string {
  const blockers =
    decision.blockers.length === 0
      ? '(none)'
      : decision.blockers
          .map(
            (item) =>
              `${item.category}/${item.code}${item.key ? `@${item.key}` : ''}${item.run_ref ? `:${item.run_ref}` : ''}`,
          )
          .join(', ')
  return [
    '# SwitchDecision',
    '',
    `- campaign_id: ${decision.campaign_id}`,
    `- verdict: ${decision.verdict}`,
    `- blockers: ${blockers}`,
    `- campaign_evaluation_sha256: ${decision.campaign_evaluation_sha256}`,
    `- ledger_sha256: ${decision.ledger_sha256}`,
    `- metrics_sha256: ${decision.metrics_sha256}`,
    '',
    'Note: SwitchDecision=go is not lifecycle cutover.',
    '',
  ].join('\n')
}

/** Writes D10 decision JSON+MD to raw and, when go+canonical, to reports. */
export function writeSwitchDecisionFiles(
  decision: SwitchDecision,
  options: { campaignRoot: string; canonicalRoot?: string | null },
): { jsonPath: string; mdPath: string } {
  const root = resolve(options.campaignRoot)
  const rawDecisionDir = join(
    root,
    '.rolekit',
    'dogfood',
    'campaigns',
    decision.campaign_id,
    'decisions',
    decision.campaign_evaluation_sha256,
  )
  mkdirSync(rawDecisionDir, { recursive: true })
  const jsonBody = canonical(decision)
  const mdBody = renderSwitchDecisionMarkdown(decision)
  const rawJson = join(rawDecisionDir, 'switch-decision.json')
  const rawMd = join(rawDecisionDir, 'switch-decision.md')
  writeFileSync(rawJson, jsonBody)
  writeFileSync(rawMd, mdBody)

  const sealed = existsSync(
    join(root, '.rolekit', 'dogfood', 'campaigns', decision.campaign_id, 'campaign-sealed.json'),
  )
  const canonicalRoot = options.canonicalRoot ? resolve(options.canonicalRoot) : null
  if (decision.verdict === 'go' && sealed && canonicalRoot) {
    const reportDir = join(canonicalRoot, 'dogfood', 'reports', decision.campaign_id)
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'switch-decision.json'), jsonBody)
    writeFileSync(join(reportDir, 'switch-decision.md'), mdBody)
    return {
      jsonPath: join(reportDir, 'switch-decision.json'),
      mdPath: join(reportDir, 'switch-decision.md'),
    }
  }
  return { jsonPath: rawJson, mdPath: rawMd }
}

/** Deterministic content digest used by campaign ledger and sealing. */
export function scanRunContent(runDir: string): { sha256: string | null; errors: string[] } {
  const root = resolve(runDir)
  const errors: string[] = []
  const manifest: Array<{ path: string; sha256: string }> = []
  const walk = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))
    } catch {
      errors.push('run_unreadable')
      return
    }
    for (const name of names) {
      const abs = join(dir, name)
      const rel = relative(root, abs).replaceAll('\\', '/')
      if (!rel.includes('/') && (name === '.lock' || name === '.supervisor.lock')) continue
      if (basename(rel).endsWith('.tmp')) {
        errors.push('temporary_file')
        continue
      }
      let stat
      try {
        stat = lstatSync(abs)
      } catch {
        errors.push('entry_unreadable')
        continue
      }
      if (stat.isSymbolicLink()) {
        errors.push('symlink_entry')
        continue
      }
      if (stat.isDirectory()) walk(abs)
      else if (stat.isFile()) {
        const bytes = readBytes(abs)
        if (bytes) manifest.push({ path: rel, sha256: sha(bytes) })
        else errors.push('file_unreadable')
      } else errors.push('non_regular_entry')
    }
  }
  const state = readJson(join(root, 'run-state.json'))
  if (!isObject(state) || state.phase !== 'terminal' || !existsSync(join(root, 'result.json')))
    errors.push('run_not_terminal')
  if (errors.length === 0) walk(root)
  if (errors.length > 0) return { sha256: null, errors: [...new Set(errors)].sort() }
  manifest.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
  return { sha256: sha(canonical(manifest)), errors: [] }
}

/** D9 expected steer message for RK-03 / RK-05. */
export function buildExpectedSteerMessage(
  itemKey: 'RK-03' | 'RK-05',
  nonce: string,
  relativeFile?: string,
): string {
  if (itemKey === 'RK-03') return `rolekit-steer/v1 nonce=${nonce} action=continue`
  const delivery = Buffer.from(`rolekit-steer/v1\nnonce=${nonce}\n`, 'utf8')
  return `rolekit-steer/v1 nonce=${nonce} action=write_exact relative_file=${relativeFile} content_base64=${delivery.toString('base64')}`
}

/** D6a path classification for patch_qualifies. */
export function pathsQualifyPatch(
  patchClass: 'code' | 'test' | 'research' | 'review',
  paths: string[],
): boolean {
  const normalized = paths.map((path) => path.replaceAll('\\', '/'))
  if (patchClass === 'code') {
    return normalized.some(
      (path) => isSourceOrScriptPath(path) && !isDocsPath(path) && !isTestPath(path),
    )
  }
  if (patchClass === 'test') return normalized.some((path) => isTestPath(path))
  return false
}

function computeMetrics(
  campaignId: string,
  stage: Stage,
  workitems: LedgerWorkItem[],
  runs: LedgerRun[],
  gates: LedgerGate[],
  research: ResearchCheck[],
  live: LiveEvidence,
): DogfoodMetrics {
  const refs = new Map<string, number>()
  for (const item of workitems)
    for (const ref of item.run_refs) refs.set(ref, (refs.get(ref) ?? 0) + 1)
  const rate = (passed: number): Rate => ({
    passed,
    total: runs.length,
    rate_ppm: runs.length === 0 ? 0 : Math.floor((passed * 1_000_000) / runs.length),
  })
  const classes = (name: LedgerWorkItem['patch_class']) =>
    workitems.filter((item) => item.patch_class === name).length
  return {
    version: 1,
    campaign_id: campaignId,
    stage,
    workitems: {
      expected: workitems.length,
      done: workitems.filter((item) => item.status === 'done').length,
      delegated: workitems.filter((item) => item.lane === 'delegated').length,
    },
    runs: {
      total: runs.length,
      orphan: runs.filter((run) => (refs.get(run.run_ref) ?? 0) === 0).length,
      duplicate_refs: runs.reduce(
        (sum, run) => sum + Math.max(0, (refs.get(run.run_ref) ?? 0) - 1),
        0,
      ),
    },
    contract: rate(runs.filter((run) => run.contract_pass === true).length),
    envelope: rate(runs.filter((run) => run.envelope_pass === true).length),
    integrity: rate(runs.filter((run) => run.integrity_pass === true).length),
    scope: {
      violations: runs.reduce((sum, run) => sum + (run.scope_violations_count ?? 0), 0),
      runs_with_violations: runs.filter((run) => (run.scope_violations_count ?? 0) > 0).length,
    },
    gates: {
      human_confirm: gates.filter(
        (gate) => gate.decision === 'approved' || gate.decision === 'rejected',
      ).length,
      invalid_confirm: gates.filter((gate) => !CONFIRM_TRIGGERS.has(gate.trigger)).length,
      pending: gates.filter((gate) => gate.decision === 'pending').length,
    },
    patch_classes: {
      code: classes('code'),
      test: classes('test'),
      research: classes('research'),
      review: classes('review'),
      qualifying_code_test: workitems.filter(
        (item) =>
          (item.patch_class === 'code' || item.patch_class === 'test') &&
          item.patch_qualifies === true,
      ).length,
    },
    profiles: ['implementer', 'qa', 'reviewer', 'researcher'].filter((profile) =>
      workitems.some((item) => item.profile === profile),
    ),
    research: { passed: research.filter((check) => check.pass).length, total: research.length },
    live_evidence: {
      passed:
        Number(live.caller_crash.pass) + Number(live.owner_loss.pass) + Number(live.steer.pass),
      total: 3,
    },
  }
}

function addMetricBlockers(
  metrics: DogfoodMetrics,
  runs: LedgerRun[],
  stage: Stage,
  add: AddBlocker,
): void {
  if (metrics.workitems.done !== metrics.workitems.expected) add('metric', 'workitems_not_done')
  if (metrics.workitems.delegated !== metrics.workitems.expected)
    add('metric', 'workitems_not_delegated')
  if (metrics.runs.total === 0) add('metric', 'runs_missing')
  if (metrics.runs.orphan > 0) add('metric', 'orphan_runs_present')
  if (metrics.runs.duplicate_refs > 0) add('metric', 'duplicate_run_refs')
  if (metrics.contract.rate_ppm !== 1_000_000) add('metric', 'contract_rate_failed')
  if (metrics.envelope.rate_ppm !== 1_000_000) add('metric', 'envelope_rate_failed')
  if (metrics.integrity.rate_ppm !== 1_000_000) add('metric', 'integrity_rate_failed')
  if (runs.some((run) => run.scope_violations_count === null)) add('scope', 'scope_not_evaluated')
  if (metrics.scope.violations > 0) add('scope', 'scope_metric_failed')
  if (metrics.gates.invalid_confirm > 0) add('gate', 'invalid_confirm_metric')
  if (metrics.gates.pending > 0) add('gate', 'pending_confirm_metric')
  if (metrics.patch_classes.qualifying_code_test < 6)
    add('metric', 'qualifying_code_test_below_minimum')
  if (stage === 'final') {
    if (
      metrics.patch_classes.code !== 6 ||
      metrics.patch_classes.test !== 1 ||
      metrics.patch_classes.research !== 1 ||
      metrics.patch_classes.review !== 2
    )
      add('metric', 'patch_class_counts_invalid')
  }
  const requiredProfiles = ['implementer', 'reviewer', 'researcher']
  if (!requiredProfiles.every((profile) => metrics.profiles.includes(profile)))
    add('metric', 'profiles_incomplete')
  if (metrics.research.passed !== metrics.research.total || metrics.research.total < 1)
    add('metric', 'research_metric_failed')
  if (metrics.live_evidence.passed !== 3) add('metric', 'live_evidence_metric_failed')
}

/**
 * Evaluate RK-06 research check via check:research on the completed run.
 */
function evaluateResearchCheck(
  root: string,
  workitems: LedgerWorkItem[],
  runs: LedgerRun[],
  raw: string,
): ResearchCheck {
  const runRefValue = completedRun(workitems, runs, 'RK-06')
  if (!runRefValue) {
    return {
      key: 'RK-06',
      run_ref: null,
      record_sha256: null,
      pass: false,
      reason: 'no_completed_run',
    }
  }
  const runDir = resolve(root, ...runRefValue.split('/'))
  const selfCwd = join(root, 'projects', 'rolekit-self')
  const result = checkResearch(runDir)
  const recordDir = join(raw, 'research-checks', 'RK-06')
  mkdirSync(recordDir, { recursive: true })
  const recordPath = join(recordDir, 'latest.json')
  const record = {
    key: 'RK-06',
    run_ref: runRefValue,
    result_sha256: fileSha(join(runDir, 'result.json')),
    exit: result.ok ? 0 : 1,
    pass: result.ok,
    assertions: result.assertions,
  }
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`)
  if (!existsSync(join(selfCwd, 'package.json'))) {
    return {
      key: 'RK-06',
      run_ref: runRefValue,
      record_sha256: fileSha(recordPath),
      pass: false,
      reason: 'command_missing',
    }
  }
  const script = join(selfCwd, 'scripts', 'check-research.ts')
  const cli = spawnSync(process.execPath, [script, runDir], {
    cwd: selfCwd,
    encoding: 'utf8',
    shell: false,
  })
  const pass = result.ok && cli.status === 0
  return {
    key: 'RK-06',
    run_ref: runRefValue,
    record_sha256: fileSha(recordPath),
    pass,
    reason: pass ? null : 'command_failed',
  }
}

function evaluateLiveEvidence(
  root: string,
  raw: string,
  plan: DogfoodPlan,
  workitems: LedgerWorkItem[],
  runs: LedgerRun[],
  add: AddBlocker,
): LiveEvidence {
  const caller = evaluateCallerCrashPack(join(raw, 'live-evidence', 'caller-crash'), add)
  const owner = evaluateOwnerLossPack(join(raw, 'live-evidence', 'owner-loss'), add)
  const steer = evaluateSteerAssertions(root, raw, plan, workitems, runs, add)
  return {
    caller_crash: caller,
    owner_loss: owner,
    steer,
  }
}

function evaluateCallerCrashPack(
  packDir: string,
  add: AddBlocker,
): { receipt_sha256: string | null; pass: boolean } {
  const missing = CALLER_PACK_FILES.filter((name) => !existsSync(join(packDir, name)))
  const receiptSha = fileSha(join(packDir, 'receipt.json'))
  if (missing.length > 0) {
    add('live-evidence', 'caller_crash_pack_incomplete', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const receipt = readJson(join(packDir, 'receipt.json'))
  if (!isObject(receipt) || receipt.type !== 'caller-crash-handoff' || receipt.item_key !== 'RK-01') {
    add('live-evidence', 'caller_crash_receipt_invalid', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const callerProcess = readJson(join(packDir, 'caller-process.json'))
  const preSupervisor = readJson(join(packDir, 'pre-supervisor.json'))
  const terminalSupervisor = readJson(join(packDir, 'terminal-supervisor.json'))
  if (!hasProcessIdentityFields(callerProcess)) {
    add('live-evidence', 'caller_process_identity_invalid', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  if (!hasProcessIdentityFields(preSupervisor)) {
    add('live-evidence', 'caller_supervisor_identity_invalid', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  if (!hasProcessIdentityFields(terminalSupervisor)) {
    add('live-evidence', 'caller_terminal_supervisor_invalid', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const pre = isObject(receipt.pre) ? receipt.pre : null
  if (
    !pre ||
    pre.state_sha256 !== fileSha(join(packDir, 'pre-state.json')) ||
    pre.caller_process_sha256 !== fileSha(join(packDir, 'caller-process.json')) ||
    pre.supervisor_snapshot_sha256 !== fileSha(join(packDir, 'pre-supervisor.json'))
  ) {
    add('live-evidence', 'caller_crash_hash_mismatch', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const exit = isObject(receipt.caller_exit) ? receipt.caller_exit : null
  if (!exit || exit.receipt_sha256 !== fileSha(join(packDir, 'caller-exit.json'))) {
    add('live-evidence', 'caller_exit_hash_mismatch', 'RK-01', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  return { receipt_sha256: receiptSha, pass: true }
}

function evaluateOwnerLossPack(
  packDir: string,
  add: AddBlocker,
): { receipt_sha256: string | null; pass: boolean } {
  const missedPath = join(packDir, 'window-missed.json')
  const receiptPath = join(packDir, 'receipt.json')
  const hasMissed = existsSync(missedPath)
  const hasReceipt = existsSync(receiptPath)
  if (hasMissed && hasReceipt) {
    add('live-evidence', 'owner_loss_pack_conflict', 'RK-04')
    return { receipt_sha256: fileSha(receiptPath), pass: false }
  }
  if (hasMissed && !hasReceipt) {
    const missedSha = fileSha(missedPath)
    add('live-evidence', 'owner_loss_window_missed', 'RK-04', null, missedSha)
    return { receipt_sha256: missedSha, pass: false }
  }
  const missing = OWNER_PACK_FILES.filter((name) => !existsSync(join(packDir, name)))
  const receiptSha = fileSha(receiptPath)
  if (missing.length > 0) {
    add('live-evidence', 'owner_loss_pack_incomplete', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const receipt = readJson(receiptPath)
  if (!isObject(receipt) || receipt.type !== 'owner-loss-retry' || receipt.item_key !== 'RK-04') {
    add('live-evidence', 'owner_loss_receipt_invalid', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const pre = isObject(receipt.pre) ? receipt.pre : null
  if (!pre || typeof pre.deadline_at !== 'string' || typeof pre.captured_at !== 'string') {
    add('live-evidence', 'owner_loss_timing_missing', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const ownerExit = isObject(receipt.owner_exit) ? receipt.owner_exit : null
  const reconcile = isObject(receipt.reconcile) ? receipt.reconcile : null
  if (!ownerExit || typeof ownerExit.observed_at !== 'string') {
    add('live-evidence', 'owner_loss_timing_missing', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  const deadline = Date.parse(String(pre.deadline_at))
  const captured = Date.parse(String(pre.captured_at))
  const ownerObserved = Date.parse(String(ownerExit.observed_at))
  const reconcileObserved =
    reconcile && typeof reconcile.observed_at === 'string'
      ? Date.parse(String(reconcile.observed_at))
      : Number.NaN
  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(captured) ||
    !Number.isFinite(ownerObserved) ||
    !(captured < ownerObserved) ||
    !(ownerObserved <= deadline - 60_000)
  ) {
    add('live-evidence', 'owner_loss_timing_invalid', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  if (!Number.isFinite(reconcileObserved) || !(reconcileObserved >= deadline + 1000)) {
    add('live-evidence', 'owner_loss_reconcile_timing_invalid', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  for (const [name, field] of [
    ['pre-state.json', 'state_sha256'],
    ['pre-supervisor.json', 'supervisor_snapshot_sha256'],
    ['pre-executor.json', 'executor_process_sha256'],
  ] as const) {
    if (pre[field] !== fileSha(join(packDir, name))) {
      add('live-evidence', 'owner_loss_hash_mismatch', 'RK-04', null, receiptSha)
      return { receipt_sha256: receiptSha, pass: false }
    }
  }
  if (!isProcessIdentity(readJson(join(packDir, 'pre-executor.json')))) {
    add('live-evidence', 'owner_executor_identity_invalid', 'RK-04', null, receiptSha)
    return { receipt_sha256: receiptSha, pass: false }
  }
  return { receipt_sha256: receiptSha, pass: true }
}

function evaluateSteerAssertions(
  root: string,
  raw: string,
  plan: DogfoodPlan,
  workitems: LedgerWorkItem[],
  runs: LedgerRun[],
  add: AddBlocker,
): LiveEvidence['steer'] {
  const nonceSource = readJson(join(raw, 'steer-nonces.json'))
  const nonces =
    isObject(nonceSource) && isObject(nonceSource.nonces) ? nonceSource.nonces : null
  const planned = (plan.steer_assertions ?? []).filter(
    (item) => item.item_key === 'RK-03' || item.item_key === 'RK-05',
  )
  if (planned.length !== 2) {
    add('live-evidence', 'steer_assertions_invalid')
    return { assertions: [], pass: false }
  }
  const assertions: LiveEvidence['steer']['assertions'] = []
  for (const item of planned) {
    const key = item.item_key as 'RK-03' | 'RK-05'
    const nonce = nonces && typeof nonces[key] === 'string' ? String(nonces[key]) : null
    if (!nonce || !NONCE_RE.test(nonce) || sha(Buffer.from(nonce, 'utf8')) !== item.nonce_sha256) {
      add('live-evidence', 'steer_nonce_mismatch', key)
      assertions.push({
        item_key: key,
        nonce_sha256: item.nonce_sha256,
        run_ref: null,
        pass: false,
      })
      continue
    }
    const expected = buildExpectedSteerMessage(key, nonce, item.relative_file)
    const expectedSha = sha(Buffer.from(expected, 'utf8'))
    const wi = workitems.find((entry) => entry.key === key)
    const hits: Array<{ run_ref: string; eligible: boolean }> = []
    for (const ref of wi?.run_refs ?? []) {
      const dir = resolve(root, ...ref.split('/'))
      const steerDir = join(dir, 'control', 'steer')
      if (!existsSync(steerDir)) continue
      const task = readJson(join(dir, 'task.json'))
      const run = runs.find((entry) => entry.run_ref === ref)
      for (const name of readdirSync(steerDir)) {
        const control = readJson(join(steerDir, name))
        if (!isObject(control) || control.state !== 'accepted') continue
        if (control.message !== expected || control.message_sha256 !== expectedSha) continue
        const eligible =
          isObject(task) && task.executor === 'pi' && run?.status === 'completed'
        hits.push({ run_ref: ref, eligible })
      }
    }
    if (hits.length === 0) {
      add('live-evidence', 'steer_selector_missing', key)
      assertions.push({
        item_key: key,
        nonce_sha256: item.nonce_sha256,
        run_ref: null,
        pass: false,
      })
      continue
    }
    if (hits.length > 1) {
      add('live-evidence', 'steer_selector_ambiguous', key, hits[0]?.run_ref ?? null)
      assertions.push({
        item_key: key,
        nonce_sha256: item.nonce_sha256,
        run_ref: null,
        pass: false,
      })
      continue
    }
    const hit = hits[0]
    if (!hit) continue
    if (!hit.eligible) {
      add('live-evidence', 'steer_run_ineligible', key, hit.run_ref)
      assertions.push({
        item_key: key,
        nonce_sha256: item.nonce_sha256,
        run_ref: null,
        pass: false,
      })
      continue
    }
    let deliveryOk = true
    if (key === 'RK-05') {
      deliveryOk = verifySteerDelivery(root, item, nonce)
      if (!deliveryOk) add('live-evidence', 'steer_delivery_content_mismatch', key, hit.run_ref)
    }
    assertions.push({
      item_key: key,
      nonce_sha256: item.nonce_sha256,
      run_ref: deliveryOk ? hit.run_ref : null,
      pass: deliveryOk,
    })
  }
  if (
    assertions.length === 2 &&
    assertions[0]?.run_ref &&
    assertions[1]?.run_ref &&
    assertions[0].run_ref === assertions[1].run_ref
  ) {
    add('live-evidence', 'steer_runs_not_distinct')
    assertions[0].pass = false
    assertions[1].pass = false
    assertions[0].run_ref = null
    assertions[1].run_ref = null
  }
  return {
    assertions,
    pass: assertions.length === 2 && assertions.every((item) => item.pass && item.run_ref),
  }
}

function verifySteerDelivery(
  root: string,
  assertion: NonNullable<DogfoodPlan['steer_assertions']>[number],
  nonce: string,
): boolean {
  if (!assertion.relative_file || !assertion.acceptance_argv) return false
  const projectRoot = join(root, 'projects', 'rolekit-self')
  const rel = assertion.relative_file
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return false
  const filePath = join(projectRoot, rel)
  const bytes = readBytes(filePath)
  if (!bytes) return false
  const expected = Buffer.from(`rolekit-steer/v1\nnonce=${nonce}\n`, 'utf8')
  if (!bytes.equals(expected)) return false
  const argv = assertion.acceptance_argv
  if (argv.length !== 4 || argv[0] !== 'node' || argv[2] !== rel || argv[3] !== assertion.nonce_sha256)
    return false
  const script = join(projectRoot, String(argv[1]))
  if (!existsSync(script)) return false
  const result = spawnSync(process.execPath, [script, rel, assertion.nonce_sha256], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    env: {
      SystemRoot: process.env.SystemRoot,
      SYSTEMROOT: process.env.SYSTEMROOT,
    },
  })
  return result.status === 0
}

function collectLedgerGates(
  workitems: LedgerWorkItem[],
  docs: Map<ItemKey, JsonObject>,
  root: string,
): LedgerGate[] {
  const gates: LedgerGate[] = []
  for (const item of workitems) {
    const doc = docs.get(item.key)
    const log = doc && Array.isArray(doc.gate_log) ? doc.gate_log : []
    for (const entry of log) {
      if (!isObject(entry) || entry.action !== 'confirm') continue
      const trigger = typeof entry.trigger === 'string' ? entry.trigger : 'unknown'
      const decision =
        entry.decision === 'approved' ||
        entry.decision === 'rejected' ||
        entry.decision === 'pending'
          ? entry.decision
          : 'pending'
      const record = canonical(entry)
      gates.push({
        key: item.key,
        run_ref: item.run_refs[item.run_refs.length - 1] ?? null,
        source: 'workitem',
        trigger,
        decision,
        record_sha256: sha(record),
      })
    }
    for (const ref of item.run_refs) {
      const gatesDir = join(resolve(root, ...ref.split('/')), 'gates')
      if (!existsSync(gatesDir)) continue
      for (const name of readdirSync(gatesDir)) {
        if (!name.endsWith('.json')) continue
        const path = join(gatesDir, name)
        const record = readJson(path)
        if (!isObject(record) || record.action !== 'confirm') continue
        const trigger = typeof record.trigger === 'string' ? record.trigger : 'unknown'
        const decision =
          record.decision === 'approved' ||
          record.decision === 'rejected' ||
          record.decision === 'pending'
            ? record.decision
            : 'pending'
        gates.push({
          key: item.key,
          run_ref: ref,
          source: 'run',
          trigger,
          decision,
          record_sha256: fileSha(path) ?? sha(canonical(record)),
        })
      }
    }
  }
  return gates.sort(
    (a, b) =>
      ITEM_ORDER.indexOf(a.key) - ITEM_ORDER.indexOf(b.key) ||
      a.source.localeCompare(b.source) ||
      (a.run_ref ?? '').localeCompare(b.run_ref ?? '') ||
      a.record_sha256.localeCompare(b.record_sha256),
  )
}

function loadEvidenceRows(
  raw: string,
  root: string,
  projects: DogfoodPlan['projects'],
): Map<ItemKey, EvidenceRow> {
  const map = new Map<ItemKey, EvidenceRow>()
  const logPath = join(raw, 'evidence-commit-log.jsonl')
  const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as EvidenceRow
      if (ITEM_ORDER.includes(row.key as ItemKey)) map.set(row.key as ItemKey, row)
    } catch {
      // ignore malformed lines
    }
  }
  for (const key of ITEM_ORDER) {
    if (map.has(key)) continue
    const project = key.startsWith('CTX') ? 'ctxline' : 'rolekit-self'
    const discovered = discoverGitEvidence(join(root, projects[project]), key)
    if (discovered) map.set(key, { ...discovered, key, project })
  }
  return map
}

function discoverGitEvidence(
  projectRoot: string,
  key: string,
): Omit<EvidenceRow, 'key' | 'project'> | null {
  if (!existsSync(join(projectRoot, '.git'))) return null
  const log = spawnSync(
    'git',
    ['log', '--format=%H%x00%P%x00%s', `--grep=evidence(${key}):`, '-n', '1'],
    { cwd: projectRoot, encoding: 'utf8', shell: false },
  )
  if (log.status !== 0 || !log.stdout.trim()) return null
  const [commit, parents, _subject] = log.stdout.trim().split('\0')
  if (!commit || !parents) return null
  const preHead = parents.split(/\s+/)[0]
  if (!preHead) return null
  const diff = spawnSync('git', ['diff', '--binary', `${preHead}..${commit}`], {
    cwd: projectRoot,
    encoding: 'buffer',
    shell: false,
  })
  const patchSha =
    diff.status === 0 ? sha(diff.stdout.length ? diff.stdout : Buffer.alloc(0)) : null
  return {
    pre_head: preHead,
    commit,
    patch_sha256: patchSha === sha(Buffer.alloc(0)) ? EMPTY_PATCH_SHA : patchSha,
  }
}

function computePatchInfo(
  projectRoot: string,
  item: DogfoodPlanItem,
  evidence: EvidenceRow | null,
  _runRefs: string[],
): {
  evidence_commit_sha256: string | null
  patch_sha256: string | null
  patch_qualifies: boolean | null
} {
  if (item.patch_class === 'research' || item.patch_class === 'review') {
    return {
      evidence_commit_sha256: evidence?.commit ?? null,
      patch_sha256: evidence?.patch_sha256 ?? null,
      patch_qualifies: null,
    }
  }
  if (!evidence?.pre_head || !evidence.commit) {
    return {
      evidence_commit_sha256: null,
      patch_sha256: null,
      patch_qualifies: false,
    }
  }
  const names = spawnSync('git', ['diff', '--name-only', `${evidence.pre_head}..${evidence.commit}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  })
  const paths =
    names.status === 0
      ? names.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : []
  const patchSha =
    evidence.patch_sha256 ??
    (() => {
      const diff = spawnSync(
        'git',
        ['diff', '--binary', `${evidence.pre_head}..${evidence.commit}`],
        { cwd: projectRoot, encoding: 'buffer', shell: false },
      )
      return diff.status === 0
        ? diff.stdout.length
          ? sha(diff.stdout)
          : EMPTY_PATCH_SHA
        : null
    })()
  const qualifies = pathsQualifyPatch(item.patch_class, paths)
  return {
    evidence_commit_sha256: evidence.commit,
    patch_sha256: patchSha,
    patch_qualifies: qualifies,
  }
}

function hasPassingRelatedRun(root: string, refs: string[], runs: LedgerRun[]): boolean {
  for (const ref of [...refs].reverse()) {
    const run = runs.find((entry) => entry.run_ref === ref)
    if (!run || run.status !== 'completed') continue
    if (run.contract_pass !== true) continue
    const verification = readJson(join(resolve(root, ...ref.split('/')), 'verification.json'))
    if (isObject(verification) && verification.passed === true) return true
  }
  return false
}

function isDocsPath(path: string): boolean {
  return (
    path.startsWith('docs/') ||
    path.includes('/docs/') ||
    path.endsWith('.md') ||
    path.startsWith('dogfood/campaign-input/') ||
    path.startsWith('dogfood/steer-evidence/')
  )
}

function isTestPath(path: string): boolean {
  return (
    /(^|\/)tests?\//.test(path) ||
    /(^|\/)test\//.test(path) ||
    /\.test\.[^.]+$/.test(path) ||
    /(^|\/)smoke\//.test(path)
  )
}

function isSourceOrScriptPath(path: string): boolean {
  if (path.includes('.rolekit/')) return false
  return (
    path.startsWith('packages/') ||
    path.startsWith('scripts/') ||
    path.startsWith('adapters/') ||
    path.startsWith('src/') ||
    /\.(ts|js|mjs|cjs|rs|go|py)$/.test(path)
  )
}

function isProcessIdentity(value: unknown): boolean {
  return (
    isObject(value) &&
    value.version === 1 &&
    Number.isSafeInteger(value.pid) &&
    typeof value.start_time_utc === 'string' &&
    typeof value.command_sha256 === 'string' &&
    SHA.test(String(value.command_sha256))
  )
}

function hasProcessIdentityFields(value: unknown): boolean {
  if (!isObject(value)) return false
  if (isProcessIdentity(value)) return true
  if (isProcessIdentity(value.process)) return true
  return (
    Number.isSafeInteger(value.pid) &&
    typeof value.start_time_utc === 'string' &&
    typeof value.command_sha256 === 'string' &&
    SHA.test(String(value.command_sha256))
  )
}

function safeProjectMap(root: string, projects: DogfoodPlan['projects']): boolean {
  if (
    projects?.['rolekit-self'] !== 'projects/rolekit-self' ||
    projects?.ctxline !== 'projects/ctxline'
  )
    return false
  return Object.values(projects).every(
    (path) =>
      !isAbsolute(path) &&
      !path.split(/[\\/]/).includes('..') &&
      resolve(root, path).startsWith(`${root}${sep}`),
  )
}
function runRef(project: string, id: string): string {
  return id.startsWith('projects/')
    ? id.replaceAll('\\', '/')
    : `projects/${project}/.rolekit/runs/${id}`
}
function completedRun(workitems: LedgerWorkItem[], runs: LedgerRun[], key: ItemKey): string | null {
  const refs = workitems.find((item) => item.key === key)?.run_refs ?? []
  return (
    [...refs]
      .reverse()
      .find((ref) => runs.find((run) => run.run_ref === ref)?.status === 'completed') ?? null
  )
}
function directoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('run-'),
      )
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
function parseDocument(text: string): unknown {
  try {
    return text.trimStart().startsWith('{') ? JSON.parse(text) : parseYaml(text)
  } catch {
    return undefined
  }
}
function readJson(path: string): unknown {
  const bytes = readBytes(path)
  return bytes ? parseDocument(bytes.toString('utf8')) : undefined
}
function readBytes(path: string): Buffer | null {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    return readFileSync(path)
  } catch {
    return null
  }
}
function fileSha(path: string): string | null {
  const bytes = readBytes(path)
  return bytes ? sha(bytes) : null
}
function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
/** RFC8785-style deterministic JSON (sorted keys, compact, no trailing newline). */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value as JsonObject)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as JsonObject)[key])}`)
    .join(',')}}`
}
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isResultStatus(value: unknown): value is LedgerRun['status'] {
  return ['completed', 'blocked', 'question', 'failed', 'cancelled'].includes(String(value))
}
function sortBlockers(blockers: CampaignBlocker[]): CampaignBlocker[] {
  const rank = new Map(CATEGORY_ORDER.map((value, index) => [value, index]))
  const unique = new Map(
    blockers.map((item) => [
      `${item.category}\0${item.key ?? ''}\0${item.run_ref ?? ''}\0${item.code}\0${item.evidence_sha256 ?? ''}`,
      item,
    ]),
  )
  return [...unique.values()].sort(
    (a, b) =>
      (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99) ||
      (a.key ?? '').localeCompare(b.key ?? '') ||
      (a.run_ref ?? '').localeCompare(b.run_ref ?? '') ||
      a.code.localeCompare(b.code) ||
      (a.evidence_sha256 ?? '').localeCompare(b.evidence_sha256 ?? ''),
  )
}

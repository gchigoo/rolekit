import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildExpectedSteerMessage,
  buildSwitchDecision,
  type CampaignEvaluation,
  CONFIRM_TRIGGERS,
  canonical,
  type DogfoodPlan,
  evaluateCampaign,
  pathsQualifyPatch,
} from '../src/campaign.ts'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}

function minimalPlan(campaignId: string): DogfoodPlan {
  const keys = [
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
  const patch: Record<string, DogfoodPlan['items'][number]['patch_class']> = {
    'RK-01': 'code',
    'RK-02': 'code',
    'RK-03': 'code',
    'RK-04': 'code',
    'RK-05': 'code',
    'RK-06': 'research',
    'CTX-01': 'code',
    'CTX-02': 'test',
    'CTX-03': 'review',
    'RK-07': 'review',
  }
  const profile: Record<string, DogfoodPlan['items'][number]['profile']> = {
    'RK-01': 'implementer',
    'RK-02': 'implementer',
    'RK-03': 'implementer',
    'RK-04': 'implementer',
    'RK-05': 'implementer',
    'RK-06': 'researcher',
    'CTX-01': 'implementer',
    'CTX-02': 'qa',
    'CTX-03': 'reviewer',
    'RK-07': 'reviewer',
  }
  return {
    version: 1,
    campaign_id: campaignId,
    projects: { 'rolekit-self': 'projects/rolekit-self', ctxline: 'projects/ctxline' },
    items: keys.map((key) => ({
      key,
      project: key.startsWith('CTX') ? 'ctxline' : 'rolekit-self',
      profile: profile[key]!,
      patch_class: patch[key]!,
      lane: 'delegated',
    })),
    steer_assertions: [
      {
        item_key: 'RK-03',
        nonce_sha256: sha('nonce-rk03-abcdefgh'),
        proves_delivery: false,
      },
      {
        item_key: 'RK-05',
        nonce_sha256: sha('nonce-rk05-abcdefgh'),
        proves_delivery: true,
        relative_file: `dogfood/steer-evidence/${campaignId}/rk-05.txt`,
        acceptance_argv: [
          'node',
          'dogfood/scripts/check-steer-delivery.mjs',
          `dogfood/steer-evidence/${campaignId}/rk-05.txt`,
          sha('nonce-rk05-abcdefgh'),
        ],
      },
    ],
  }
}

function seedCampaign(root: string, campaignId: string, plan: DogfoodPlan): void {
  mkdirSync(join(root, 'projects', 'rolekit-self', '.rolekit', 'work-items'), { recursive: true })
  mkdirSync(join(root, 'projects', 'ctxline', '.rolekit', 'work-items'), { recursive: true })
  const raw = join(root, '.rolekit', 'dogfood', 'campaigns', campaignId)
  mkdirSync(join(raw, 'live-evidence', 'caller-crash'), { recursive: true })
  mkdirSync(join(raw, 'live-evidence', 'owner-loss'), { recursive: true })
  writeFileSync(join(root, 'plan.yaml'), 'version: 1\n')
  const planSha = sha(canonical(plan))
  writeJson(join(raw, 'campaign-started.json'), {
    version: 1,
    campaign_id: campaignId,
    plan_sha256: planSha,
  })
  writeJson(join(raw, 'campaign-sealed.json'), { version: 1, campaign_id: campaignId })
  writeJson(join(raw, 'steer-nonces.json'), {
    version: 1,
    campaign_id: campaignId,
    nonces: { 'RK-03': 'nonce-rk03-abcdefgh', 'RK-05': 'nonce-rk05-abcdefgh' },
  })
  const items = plan.items.map((item, index) => {
    const id = `WI-${String(index + 1).padStart(3, '0')}`
    const projectRoot = join(root, plan.projects[item.project], '.rolekit', 'work-items')
    writeFileSync(
      join(projectRoot, `${id}.yaml`),
      [
        'schema: rolekit/work-item@1',
        `id: ${id}`,
        'status: done',
        'lane: delegated',
        'gate_log:',
        '  - trigger: final-acceptance',
        '    action: confirm',
        '    decision: approved',
        'runs: []',
      ].join('\n'),
    )
    return { key: item.key, project: item.project, workitem_id: id }
  })
  writeJson(join(raw, 'resolved-plan.json'), { plan_sha256: planSha, items })
  // Incomplete owner-loss pack: receipt only (REV-003 fail-closed).
  writeJson(join(raw, 'live-evidence', 'owner-loss', 'receipt.json'), {
    version: 1,
    type: 'owner-loss',
    item_key: 'RK-04',
  })
  // Non-conforming steer message on a fake run directory for RK-03.
  const runId = 'run-test-rk03'
  const runDir = join(root, 'projects', 'rolekit-self', '.rolekit', 'runs', runId)
  mkdirSync(join(runDir, 'control', 'steer'), { recursive: true })
  writeJson(join(runDir, 'control', 'steer', 'steer-1.json'), {
    version: 1,
    state: 'accepted',
    message: 'nonce-rk03-abcdefgh',
    message_sha256: sha('nonce-rk03-abcdefgh'),
  })
  writeFileSync(
    join(root, 'projects', 'rolekit-self', '.rolekit', 'work-items', 'WI-003.yaml'),
    [
      'schema: rolekit/work-item@1',
      'id: WI-003',
      'status: done',
      'lane: delegated',
      'gate_log:',
      '  - trigger: final-acceptance',
      '    action: confirm',
      '    decision: approved',
      `runs: [${runId}]`,
    ].join('\n'),
  )
}

describe('D6f patch_qualifies path classification', () => {
  it('code qualifies only with non-docs/non-test source or script paths', () => {
    assert.equal(pathsQualifyPatch('code', ['packages/runner/src/run-manager.ts']), true)
    assert.equal(pathsQualifyPatch('code', ['docs/operator.md']), false)
    assert.equal(pathsQualifyPatch('code', ['packages/runner/test/unit/x.test.ts']), false)
  })

  it('test qualifies with test paths and rejects source-only', () => {
    assert.equal(pathsQualifyPatch('test', ['tests/incomplete_stdin.rs']), true)
    assert.equal(pathsQualifyPatch('test', ['src/main.rs']), false)
  })
})

describe('D9 steer selector message forms', () => {
  it('builds RK-03/RK-05 design forms and rejects raw nonce/prose', () => {
    const nonce = '0ij0lfXy2nuIV2kSfhXXxCk1'
    assert.equal(
      buildExpectedSteerMessage('RK-03', nonce),
      'rolekit-steer/v1 nonce=0ij0lfXy2nuIV2kSfhXXxCk1 action=continue',
    )
    assert.notEqual(nonce, buildExpectedSteerMessage('RK-03', nonce))
  })
})

describe('D6a confirm whitelist', () => {
  it('accepts only the seven design triggers', () => {
    assert.equal(CONFIRM_TRIGGERS.has('final-acceptance'), true)
    assert.equal(CONFIRM_TRIGGERS.has('scope-violation'), false)
  })
})

describe('evaluateCampaign fail-closed predicates', () => {
  it('blocks qualifying_code_test=0, nonconforming steer, incomplete owner-loss, and records gates', async () => {
    const campaignId = 'rk-pred-test'
    const root = mkdtempSync(join(tmpdir(), 'rk-campaign-'))
    const plan = minimalPlan(campaignId)
    // Keep plan.yaml bytes aligned with campaign-started plan_sha256 via canonical(plan) helper path:
    // evaluateCampaign hashes plan.yaml file; seed uses sha(canonical(plan)). Write RFC8785 bytes.
    seedCampaign(root, campaignId, plan)
    writeFileSync(join(root, 'plan.yaml'), canonical(plan))
    const startedPath = join(
      root,
      '.rolekit',
      'dogfood',
      'campaigns',
      campaignId,
      'campaign-started.json',
    )
    writeJson(startedPath, {
      version: 1,
      campaign_id: campaignId,
      plan_sha256: sha(canonical(plan)),
    })

    const evaluation = await evaluateCampaign({
      campaignRoot: root,
      campaignId,
      plan,
    })
    assert.equal(evaluation.audit.status, 'fail')
    assert.equal(evaluation.metrics.patch_classes.qualifying_code_test, 0)
    assert.ok(
      evaluation.audit.blockers.some((item) => item.code === 'qualifying_code_test_below_minimum'),
    )
    assert.ok(evaluation.audit.blockers.some((item) => item.code === 'steer_selector_missing'))
    assert.ok(evaluation.audit.blockers.some((item) => item.code === 'owner_loss_pack_incomplete'))
    assert.ok(evaluation.ledger.gates.length > 0)
    assert.equal(evaluation.ledger.gates[0]?.trigger, 'final-acceptance')
    assert.equal(evaluation.live_evidence.owner_loss.pass, false)
    assert.equal(evaluation.live_evidence.steer.pass, false)
  })
})

describe('D10 switch-decision shas and hold merge', () => {
  it('emits three RFC8785 shas and merges review/promotion blockers', () => {
    const root = mkdtempSync(join(tmpdir(), 'rk-switch-'))
    mkdirSync(join(root, 'projects', 'rolekit-self'), { recursive: true })
    mkdirSync(join(root, '.rolekit', 'dogfood', 'campaigns', 'c1', 'publish'), {
      recursive: true,
    })
    const evaluation = {
      version: 1,
      stage: 'final',
      audit: { status: 'pass', blockers: [] },
      ledger: {
        version: 1,
        campaign_id: 'c1',
        stage: 'final',
        plan_sha256: sha('plan'),
        resolved_plan_sha256: null,
        campaign_started_sha256: null,
        campaign_sealed_sha256: sha('sealed'),
        steer_nonces_sha256: null,
        workitems: [],
        runs: [],
        gates: [],
        research_checks: [],
        live_evidence: {
          caller_crash: { receipt_sha256: null, pass: false },
          owner_loss: { receipt_sha256: null, pass: false },
          steer: { assertions: [], pass: false },
        },
      },
      metrics: {
        version: 1,
        campaign_id: 'c1',
        stage: 'final',
        workitems: { expected: 0, done: 0, delegated: 0 },
        runs: { total: 0, orphan: 0, duplicate_refs: 0 },
        contract: { passed: 0, total: 0, rate_ppm: 0 },
        envelope: { passed: 0, total: 0, rate_ppm: 0 },
        integrity: { passed: 0, total: 0, rate_ppm: 0 },
        scope: { violations: 0, runs_with_violations: 0 },
        gates: { human_confirm: 0, invalid_confirm: 0, pending: 0 },
        patch_classes: {
          code: 0,
          test: 0,
          research: 0,
          review: 0,
          qualifying_code_test: 0,
        },
        profiles: [],
        research: { passed: 0, total: 0 },
        live_evidence: { passed: 0, total: 3 },
      },
      research_checks: [],
      live_evidence: {
        caller_crash: { receipt_sha256: null, pass: false },
        owner_loss: { receipt_sha256: null, pass: false },
        steer: { assertions: [], pass: false },
      },
    } as CampaignEvaluation

    const decision = buildSwitchDecision(evaluation, { campaignRoot: root, canonicalRoot: null })
    assert.equal(decision.campaign_evaluation_sha256, sha(canonical(evaluation)))
    assert.equal(decision.ledger_sha256, sha(canonical(evaluation.ledger)))
    assert.equal(decision.metrics_sha256, sha(canonical(evaluation.metrics)))
    assert.equal(decision.verdict, 'hold')
    assert.ok(decision.blockers.some((item) => item.code === 'rk07_review_missing'))
    assert.ok(decision.blockers.some((item) => item.code === 'campaign_artifacts_missing'))
  })
})

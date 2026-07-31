import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GatePolicy } from '../src/schemas/gate-policy.ts'
import type { ResultEnvelope } from '../src/schemas/result-envelope.ts'
import type { WorkItem } from '../src/schemas/work-item.ts'
import {
  adoptRunResult,
  allStatuses,
  applyProcessGateAction,
  applyQuestionGateAction,
  approveWorkItemGate,
  attachRun,
  autoBridgeToVerifying,
  dropWorkItem,
  hasResolvedDesignArtifact,
  InvalidTransition,
  isLegalTransition,
  rejectWorkItemGate,
  resumeWorkItem,
  selectLane,
  transition,
} from '../src/workitem/index.ts'

const NOW = '2026-07-29T00:00:00.000Z'

function base(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    schema: 'rolekit/work-item@1',
    id: 'WI-20260729-001',
    kind: 'feature',
    title: 't',
    status: 'planned',
    gate: null,
    gate_log: [],
    lane: null,
    lane_reason: null,
    lane_overrides: [],
    depends_on: [],
    runs: [],
    created: NOW,
    updated: NOW,
    ...overrides,
  }
}

function envelope(status: ResultEnvelope['status']): ResultEnvelope {
  return {
    schema: 'rolekit/result-envelope@1',
    task_id: 't1',
    status,
    summary: 's',
    changed_files: [],
    verification: [],
    scope_violations: [],
    decisions: [],
    assumptions: [],
    evidence: [],
    risks: [],
    unresolved: status === 'completed' ? [] : ['x'],
    recommended_next_action: 'n',
  }
}

const policyA: GatePolicy = {
  schema: 'rolekit/gate-policy@1',
  default_action: 'ignore',
  triggers: {
    'new-dependency': 'confirm',
    migration: 'block',
    'public-api-change': 'confirm',
    delete: 'confirm',
    'scope-violation': 'block',
    'ambiguous-requirement': 'confirm',
    'design-artifact': 'confirm',
    'final-acceptance': 'confirm',
  },
}

const policyB: GatePolicy = {
  ...policyA,
  default_action: 'observe',
  triggers: { ...policyA.triggers, 'design-artifact': 'ignore' },
}

describe('workitem state machine', () => {
  it('8x8 matrix: legal edges succeed, illegal throw', () => {
    for (const from of allStatuses()) {
      for (const to of allStatuses()) {
        const item = base({
          status: from,
          gate:
            from === 'awaiting-gate' ? { trigger: 'design-artifact', origin: 'designing' } : null,
        })
        const legal =
          from === 'awaiting-gate'
            ? to === 'designing' || to === 'blocked' || to === 'dropped'
            : isLegalTransition(from, to)
        if (!legal) {
          assert.throws(() => transition(item, to, { now: NOW }), InvalidTransition)
          continue
        }
        if (to === 'awaiting-gate') {
          const origin =
            from === 'designing' || from === 'executing' || from === 'verifying' ? from : null
          if (!origin) {
            assert.throws(() => transition(item, to, { now: NOW }), InvalidTransition)
            continue
          }
          const next = transition(item, to, {
            now: NOW,
            gate: { trigger: 'x', origin },
          })
          assert.equal(next.status, 'awaiting-gate')
          assert.deepEqual(next.gate, { trigger: 'x', origin })
        } else {
          const next = transition(item, to, { now: NOW })
          assert.equal(next.status, to)
          assert.equal(next.gate, null)
        }
      }
    }
  })

  it('goal done invariant', () => {
    const goal = base({
      kind: 'goal',
      status: 'verifying',
      depends_on: ['WI-A', 'WI-B'],
    })
    assert.throws(
      () =>
        transition(goal, 'done', {
          now: NOW,
          deps: [
            { id: 'WI-A', status: 'done' },
            { id: 'WI-B', status: 'executing' },
          ],
        }),
      InvalidTransition,
    )
    const ok = transition(goal, 'done', {
      now: NOW,
      deps: [
        { id: 'WI-A', status: 'done' },
        { id: 'WI-B', status: 'dropped' },
      ],
    })
    assert.equal(ok.status, 'done')
  })

  it('attachRun first transitions; migrated first append and retry have no self-loop', () => {
    const first = attachRun(base({ status: 'planned' }), 'run-1', 'first', NOW)
    assert.equal(first.status, 'executing')
    assert.deepEqual(first.runs, ['run-1'])
    const migrated = attachRun(
      base({ status: 'executing', lane: null, runs: [] }),
      'run-migrated',
      'first',
      NOW,
    )
    assert.equal(migrated.status, 'executing')
    assert.deepEqual(migrated.runs, ['run-migrated'])
    const retry = attachRun(first, 'run-2', 'retry', NOW)
    assert.equal(retry.status, 'executing')
    assert.deepEqual(retry.runs, ['run-1', 'run-2'])
    assert.throws(() => attachRun(base({ status: 'planned' }), 'run-x', 'retry', NOW))
  })

  it('adoptRunResult D13 + successor no-op', () => {
    const exec = base({ status: 'executing', runs: ['run-1'], lane: 'delegated' })
    const completed = adoptRunResult(exec, 'run-1', envelope('completed'), NOW)
    assert.equal(completed.item.status, 'verifying')
    assert.equal(completed.no_op, false)
    const again = adoptRunResult(completed.item, 'run-1', envelope('completed'), NOW)
    assert.equal(again.no_op, true)
    assert.equal(again.item.status, 'verifying')

    const blocked = adoptRunResult(exec, 'run-1', envelope('blocked'), NOW)
    assert.equal(blocked.item.status, 'blocked')
    const failed = adoptRunResult(exec, 'run-1', envelope('failed'), NOW)
    assert.equal(failed.item.status, 'executing')
    assert.equal(failed.code, 'run_failed')
  })

  it('question policy actions and re-entry closure', () => {
    const executing = base({ status: 'executing', lane: 'delegated', runs: ['run-1'] })
    const ignored = applyQuestionGateAction(executing, 'run-1', 'ignore', NOW)
    assert.equal(ignored.item.status, 'executing')
    assert.equal(ignored.item.gate_log.length, 0)

    const observed = applyQuestionGateAction(executing, 'run-1', 'observe', NOW)
    assert.equal(observed.item.status, 'executing')
    assert.equal(observed.item.gate_log[0]?.trigger, 'ambiguous-requirement')
    assert.equal(applyQuestionGateAction(observed.item, 'run-1', 'observe', NOW).no_op, true)

    const confirmed = applyQuestionGateAction(executing, 'run-1', 'confirm', NOW)
    assert.equal(confirmed.item.status, 'awaiting-gate')
    assert.equal(confirmed.item.gate_log.length, 0)
    assert.equal(applyQuestionGateAction(confirmed.item, 'run-1', 'confirm', NOW).no_op, true)

    const blocked = applyQuestionGateAction(executing, 'run-1', 'block', NOW)
    assert.equal(blocked.item.status, 'blocked')
    assert.equal(blocked.item.gate_log[0]?.decision, 'blocked')
  })

  it('drop rejects pending gate and resume records run-count marker', () => {
    const pending = base({
      status: 'awaiting-gate',
      gate: { trigger: 'ambiguous-requirement', origin: 'executing' },
      lane: 'delegated',
      runs: ['run-1'],
    })
    const dropped = dropWorkItem(pending, NOW)
    assert.equal(dropped.status, 'dropped')
    assert.deepEqual(dropped.gate_log[0], {
      trigger: 'ambiguous-requirement',
      action: 'confirm',
      decision: 'rejected',
      ts: NOW,
    })

    const resumed = resumeWorkItem(
      base({ status: 'blocked', lane: 'delegated', runs: ['run-1', 'run-2'] }),
      'executing',
      NOW,
    )
    assert.equal(resumed.status, 'executing')
    assert.equal(resumed.gate_log[0]?.recovery_runs_count, 2)
    assert.throws(() => resumeWorkItem(base({ status: 'planned' }), 'executing', NOW))
    assert.throws(() =>
      resumeWorkItem(base({ status: 'verifying', lane: 'delegated' }), 'planned', NOW),
    )
  })

  it('gate four actions for design-artifact and final-acceptance', () => {
    const designing = base({ status: 'designing' })
    assert.equal(
      applyProcessGateAction(designing, 'design-artifact', 'ignore', NOW).status,
      'designing',
    )
    const observed = applyProcessGateAction(designing, 'design-artifact', 'observe', NOW)
    assert.equal(observed.gate_log[0]?.decision, 'auto-pass')
    const confirm = applyProcessGateAction(designing, 'design-artifact', 'confirm', NOW)
    assert.equal(confirm.status, 'awaiting-gate')
    assert.deepEqual(confirm.gate, { trigger: 'design-artifact', origin: 'designing' })
    const approved = approveWorkItemGate(confirm, NOW)
    assert.equal(approved.status, 'designing')
    assert.equal(approved.gate, null)
    assert.ok(hasResolvedDesignArtifact(approved))
    const skip = applyProcessGateAction(approved, 'design-artifact', 'confirm', NOW)
    assert.equal(skip.status, 'designing')
    assert.equal(skip.gate, null)

    const verifying = base({ status: 'verifying' })
    const faConfirm = applyProcessGateAction(verifying, 'final-acceptance', 'confirm', NOW)
    assert.equal(faConfirm.status, 'awaiting-gate')
    const faDone = approveWorkItemGate(faConfirm, NOW)
    assert.equal(faDone.status, 'done')
    const rejected = rejectWorkItemGate(faConfirm, NOW)
    assert.equal(rejected.status, 'blocked')
    assert.equal(
      applyProcessGateAction(verifying, 'final-acceptance', 'block', NOW).status,
      'blocked',
    )
    assert.equal(
      applyProcessGateAction(verifying, 'final-acceptance', 'ignore', NOW).status,
      'done',
    )
  })

  it('autoBridge D4 rules', () => {
    const direct = base({ status: 'executing', lane: 'direct', runs: [] })
    assert.equal(autoBridgeToVerifying(direct, [], NOW).status, 'verifying')
    const del = base({ status: 'executing', lane: 'delegated', runs: ['run-1'] })
    assert.equal(
      autoBridgeToVerifying(del, [{ run_id: 'run-1', state: 'finished', status: 'completed' }], NOW)
        .status,
      'verifying',
    )
    assert.throws(() =>
      autoBridgeToVerifying(del, [{ run_id: 'run-1', state: 'awaiting-gate' }], NOW),
    )
  })

  it('selectLane D7 thresholds and policy independence', () => {
    const item = base()
    const coordinated = selectLane(item, policyA, {
      estimated_files: 1,
      cross_module: true,
      migration: false,
      context_already_loaded: true,
    })
    assert.equal(coordinated.lane, 'coordinated')
    const direct = selectLane(item, policyA, {
      estimated_files: 3,
      cross_module: false,
      migration: false,
      context_already_loaded: true,
    })
    assert.equal(direct.lane, 'direct')
    const delegated = selectLane(item, policyA, {
      estimated_files: 4,
      cross_module: false,
      migration: false,
      context_already_loaded: true,
    })
    assert.equal(delegated.lane, 'delegated')
    const a = selectLane(item, policyA, {
      estimated_files: 2,
      cross_module: false,
      migration: false,
      context_already_loaded: false,
    })
    const b = selectLane(item, policyB, {
      estimated_files: 2,
      cross_module: false,
      migration: false,
      context_already_loaded: false,
    })
    assert.deepEqual(a, b)
  })

  it('final-acceptance approve from verifying origin goes done', () => {
    const item = base({
      status: 'awaiting-gate',
      gate: { trigger: 'final-acceptance', origin: 'verifying' },
    })
    assert.equal(approveWorkItemGate(item, NOW).status, 'done')
  })
})

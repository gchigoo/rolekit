import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluate, type PolicyEvaluation } from '../src/gate/policy-engine.ts'
import type { GatePolicy } from '../src/schemas/gate-policy.ts'

const basePolicy: GatePolicy = {
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

/**
 * Fixture caller simulating runner / WorkItem — must not re-fold priority.
 */
function consumeOverall(evaluation: PolicyEvaluation): string {
  return evaluation.overall
}

describe('PolicyEngine evaluate', () => {
  it('returns empty decisions and overall ignore when no hits', () => {
    const result = evaluate([], basePolicy)
    assert.deepEqual(result.decisions, [])
    assert.equal(result.overall, 'ignore')
  })

  it('keeps ignore decisions in order and folds overall ignore', () => {
    const observePolicy: GatePolicy = {
      ...basePolicy,
      default_action: 'ignore',
      triggers: { ...basePolicy.triggers, 'public-api-change': 'ignore' },
    }
    const result = evaluate([{ trigger: 'public-api-change' }], observePolicy)
    assert.equal(result.decisions.length, 1)
    assert.equal(result.decisions[0]?.action, 'ignore')
    assert.equal(result.overall, 'ignore')
  })

  it('applies observe and confirm explicitly', () => {
    const observe = evaluate([{ trigger: 'public-api-change' }], {
      ...basePolicy,
      triggers: { ...basePolicy.triggers, 'public-api-change': 'observe' },
    })
    assert.equal(observe.overall, 'observe')
    assert.equal(observe.decisions[0]?.reason, 'explicit:public-api-change')

    const confirm = evaluate([{ trigger: 'delete' }], basePolicy)
    assert.equal(confirm.overall, 'confirm')
  })

  it('unknown open trigger falls back to default_action with warning reason', () => {
    const result = evaluate([{ trigger: 'unknown-future-trigger' }], basePolicy)
    assert.equal(result.decisions[0]?.action, 'ignore')
    assert.match(result.decisions[0]?.reason ?? '', /fallback:default_action/)
    const observeDefault: GatePolicy = { ...basePolicy, default_action: 'observe' }
    const r2 = evaluate([{ trigger: 'unknown-future-trigger' }], observeDefault)
    assert.equal(r2.overall, 'observe')
  })

  it('folds multi-hit overall with block > confirm > observe > ignore', () => {
    const mixed = evaluate([{ trigger: 'public-api-change' }, { trigger: 'migration' }], basePolicy)
    assert.equal(mixed.decisions.length, 2)
    assert.equal(mixed.decisions[0]?.action, 'confirm')
    assert.equal(mixed.decisions[1]?.action, 'block')
    assert.equal(mixed.overall, 'block')
    assert.equal(consumeOverall(mixed), 'block')

    const observePolicy: GatePolicy = {
      ...basePolicy,
      triggers: {
        ...basePolicy.triggers,
        'public-api-change': 'observe',
        delete: 'ignore',
      },
    }
    const oc = evaluate(
      [{ trigger: 'delete' }, { trigger: 'public-api-change' }, { trigger: 'new-dependency' }],
      observePolicy,
    )
    assert.equal(oc.overall, 'confirm')
    assert.deepEqual(
      oc.decisions.map((d) => d.action),
      ['ignore', 'observe', 'confirm'],
    )
  })

  it('runner and WorkItem fixture callers see identical overall', () => {
    const hits = [{ trigger: 'migration' }, { trigger: 'new-dependency' }]
    const runnerView = evaluate(hits, basePolicy)
    const workItemView = evaluate(hits, basePolicy)
    assert.deepEqual(runnerView, workItemView)
    assert.equal(consumeOverall(runnerView), consumeOverall(workItemView))
  })
})

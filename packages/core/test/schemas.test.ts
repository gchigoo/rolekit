import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { schemaRegistry } from '../src/schema-registry.ts'
import type { RunEvent } from '../src/schemas/run-event.ts'
import type { WorkItem } from '../src/schemas/work-item.ts'
import { validateArtifact } from '../src/validate.ts'

describe('schema registry', () => {
  it('registers exactly 10 schema kinds', () => {
    assert.equal(schemaRegistry.size, 10)
  })
})

describe('RunEvent discriminated union', () => {
  const base = {
    schema: 'rolekit/run-event@1' as const,
    ts: '2026-07-28T04:15:00.000Z',
    run_id: 'run-1',
  }

  it('accepts all 7 event variants', () => {
    const events: RunEvent[] = [
      {
        ...base,
        type: 'started',
        payload: { task_id: 'RK-1', adapter: 'pi-rpc', worktree: '/tmp/wt' },
      },
      {
        ...base,
        type: 'tool_call',
        payload: { name: 'read_file', args_digest: 'abc' },
      },
      {
        ...base,
        type: 'message',
        payload: { role: 'system', text: 'status update' },
      },
      {
        ...base,
        type: 'gate',
        payload: {
          gate: 'new-dependency',
          action: 'confirm',
          decision: 'human-required',
          evidence: 'package.json changed',
        },
      },
      {
        ...base,
        type: 'verification',
        payload: { command: 'npm test', exit_code: 0 },
      },
      {
        ...base,
        type: 'escalation',
        payload: {
          rule: 'on_scope_change',
          action: 'return_blocked',
          detail: 'touched forbidden path',
        },
      },
      {
        ...base,
        type: 'finished',
        payload: { status: 'completed', reason: null },
      },
    ]
    for (const event of events) {
      const result = validateArtifact('rolekit/run-event@1', event)
      assert.equal(result.valid, true, `expected valid for type=${event.type}`)
    }
  })

  it('rejects unknown event type', () => {
    const result = validateArtifact('rolekit/run-event@1', {
      ...base,
      type: 'progress',
      payload: {},
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'structural')
    }
  })
})

describe('WorkItem structure', () => {
  const baseItem: WorkItem = {
    schema: 'rolekit/work-item@1',
    id: 'WI-1',
    kind: 'goal',
    title: 'Delivery goal',
    status: 'planned',
    gate: null,
    gate_log: [],
    lane: null,
    lane_reason: null,
    lane_overrides: [],
    depends_on: [],
    runs: [],
    created: '2026-07-28T00:00:00.000Z',
    updated: '2026-07-28T00:00:00.000Z',
  }

  it('accepts kind=goal', () => {
    const result = validateArtifact('rolekit/work-item@1', baseItem)
    assert.equal(result.valid, true)
  })

  it('rejects unknown kind', () => {
    const result = validateArtifact('rolekit/work-item@1', {
      ...baseItem,
      kind: 'epic',
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'structural')
    }
  })
})

describe('ExecutorProfile adapter', () => {
  it('accepts unregistered adapter name openai-responses', () => {
    const result = validateArtifact('rolekit/executor-profile@1', {
      schema: 'rolekit/executor-profile@1',
      name: 'research-openai',
      adapter: 'openai-responses',
    })
    assert.equal(result.valid, true)
  })

  it('rejects empty adapter as structural', () => {
    const result = validateArtifact('rolekit/executor-profile@1', {
      schema: 'rolekit/executor-profile@1',
      name: 'broken',
      adapter: '',
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'structural')
      assert.match(result.issues[0]?.path ?? '', /adapter/)
    }
  })
})

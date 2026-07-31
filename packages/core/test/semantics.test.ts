import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { KnowledgeEntryPayload } from '../src/schemas/knowledge-entry.ts'
import type { ResultEnvelope } from '../src/schemas/result-envelope.ts'
import type { TaskContract } from '../src/schemas/task-contract.ts'
import type { WorkItem } from '../src/schemas/work-item.ts'
import { validateArtifact } from '../src/validate.ts'

function sampleTask(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    schema: 'rolekit/task-contract@1',
    id: 'RK-1',
    kind: 'implementation',
    role: 'implementer',
    executor: 'pi-default',
    objective: 'Implement feature',
    context: { required_files: [], docs: [] },
    scope: { writable: ['src/**'], forbidden: ['secrets/**'] },
    constraints: [],
    deliverables: ['code'],
    acceptance: {
      commands: [{ run: 'npm test', expect_exit: 0 }],
      assertions: [],
    },
    execution: {
      worktree: 'isolated',
      max_tool_calls: 10,
      network: 'deny',
      timeout_minutes: 15,
    },
    escalation: {
      on_scope_change: 'return_blocked',
      on_new_dependency: 'require_approval',
      on_ambiguous_requirement: 'return_question',
    },
    ...overrides,
  }
}

describe('TaskContract semantic rules', () => {
  it('accepts non-empty commands and valid globs', () => {
    assert.equal(validateArtifact('rolekit/task-contract@1', sampleTask()).valid, true)
  })

  it('rejects empty acceptance.commands', () => {
    const result = validateArtifact(
      'rolekit/task-contract@1',
      sampleTask({ acceptance: { commands: [], assertions: [] } }),
    )
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
      assert.equal(result.issues[0]?.path, '/acceptance/commands')
    }
  })

  it('rejects invalid glob-ish scope patterns', () => {
    const result = validateArtifact(
      'rolekit/task-contract@1',
      sampleTask({ scope: { writable: ['src/**['], forbidden: [] } }),
    )
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
      assert.match(result.issues[0]?.path ?? '', /writable/)
    }
  })
})

describe('ResultEnvelope semantic rules', () => {
  const base: ResultEnvelope = {
    schema: 'rolekit/result-envelope@1',
    task_id: 'RK-1',
    status: 'failed',
    summary: 'failed',
    changed_files: [],
    verification: [],
    scope_violations: [],
    decisions: [],
    assumptions: [],
    evidence: [],
    risks: [],
    unresolved: ['missing dependency approval'],
    recommended_next_action: 'retry after approval',
  }

  it('requires unresolved when status is not completed', () => {
    const result = validateArtifact('rolekit/result-envelope@1', {
      ...base,
      unresolved: [],
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
    }
  })

  it('rejects completed with scope_violations', () => {
    const result = validateArtifact('rolekit/result-envelope@1', {
      ...base,
      status: 'completed',
      unresolved: [],
      scope_violations: ['src/forbidden.ts'],
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
    }
  })
})

describe('WorkItem semantic rules', () => {
  const base: WorkItem = {
    schema: 'rolekit/work-item@1',
    id: 'WI-1',
    kind: 'feature',
    title: 'Feature',
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

  it('requires gate when awaiting-gate', () => {
    const result = validateArtifact('rolekit/work-item@1', {
      ...base,
      status: 'awaiting-gate',
      gate: null,
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
    }
  })

  it('requires null gate for non-awaiting statuses', () => {
    const result = validateArtifact('rolekit/work-item@1', {
      ...base,
      status: 'executing',
      gate: { trigger: 'design-artifact', origin: 'designing' },
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
    }
  })

  it('accepts awaiting-gate with non-null gate', () => {
    const result = validateArtifact('rolekit/work-item@1', {
      ...base,
      status: 'awaiting-gate',
      gate: { trigger: 'design-artifact', origin: 'designing' },
    })
    assert.equal(result.valid, true)
  })

  it('requires recovery count only on the recovery marker triple', () => {
    for (const count of [0, 3]) {
      assert.equal(
        validateArtifact('rolekit/work-item@1', {
          ...base,
          gate_log: [
            {
              trigger: 'recovery-cycle',
              action: 'observe',
              decision: 'auto-pass',
              ts: base.updated,
              recovery_runs_count: count,
            },
          ],
        }).valid,
        true,
      )
    }
    const missing = validateArtifact('rolekit/work-item@1', {
      ...base,
      gate_log: [
        {
          trigger: 'recovery-cycle',
          action: 'observe',
          decision: 'auto-pass',
          ts: base.updated,
        },
      ],
    })
    assert.equal(missing.valid, false)
    const forbidden = validateArtifact('rolekit/work-item@1', {
      ...base,
      gate_log: [
        {
          trigger: 'design-artifact',
          action: 'observe',
          decision: 'auto-pass',
          ts: base.updated,
          recovery_runs_count: 0,
        },
      ],
    })
    assert.equal(forbidden.valid, false)
  })

  it('rejects negative and non-integer recovery counts structurally', () => {
    for (const recovery_runs_count of [-1, 1.5]) {
      const result = validateArtifact('rolekit/work-item@1', {
        ...base,
        gate_log: [
          {
            trigger: 'recovery-cycle',
            action: 'observe',
            decision: 'auto-pass',
            ts: base.updated,
            recovery_runs_count,
          },
        ],
      })
      assert.equal(result.valid, false)
      if (!result.valid) assert.equal(result.issues[0]?.layer, 'structural')
    }
  })
})

describe('KnowledgeEntry semantic rules', () => {
  const frontmatter = {
    schema: 'rolekit/knowledge-entry@1' as const,
    id: 'KN-1',
    type: 'adr' as const,
    title: 'Decision',
    status: 'active' as const,
    tags: [],
    created: '2026-07-28T00:00:00.000Z',
    source: null,
  }

  it('requires Nygard headings for type=adr', () => {
    const payload: KnowledgeEntryPayload = {
      frontmatter,
      body: '## Context\n\nOnly context present.\n',
    }
    const result = validateArtifact('rolekit/knowledge-entry@1', payload)
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.ok(result.issues.every((issue) => issue.layer === 'semantic'))
    }
  })

  it('accepts adr with all four headings', () => {
    const payload: KnowledgeEntryPayload = {
      frontmatter,
      body: [
        '## Context',
        'ctx',
        '## Decision',
        'dec',
        '## Consequences',
        'con',
        '## Alternatives Considered',
        'alt',
      ].join('\n'),
    }
    assert.equal(validateArtifact('rolekit/knowledge-entry@1', payload).valid, true)
  })

  it('rejects multi-paragraph rule body', () => {
    const payload: KnowledgeEntryPayload = {
      frontmatter: { ...frontmatter, type: 'rule', title: 'Rule' },
      body: 'First paragraph.\n\nSecond paragraph.\n',
    }
    const result = validateArtifact('rolekit/knowledge-entry@1', payload)
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.issues[0]?.layer, 'semantic')
    }
  })
})

describe('validateArtifact short-circuit and unknown_schema', () => {
  it('returns unknown_schema for unregistered kind', () => {
    const result = validateArtifact('rolekit/nope@1', {})
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.code, 'unknown_schema')
    }
  })

  it('does not run semantic rules after structural failure', () => {
    const result = validateArtifact('rolekit/work-item@1', {
      schema: 'rolekit/work-item@1',
      id: 'WI-1',
      // missing required fields → structural
    })
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.ok(result.issues.every((issue) => issue.layer === 'structural'))
    }
  })
})

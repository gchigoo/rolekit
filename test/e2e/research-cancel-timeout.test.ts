/**
 * cancel + timeout e2e for openai-responses via MockResponses.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { TaskContract } from '@rolekit/core'
import {
  clearOpenAiResponsesSessions,
  createOpenAiResponsesExecutor,
} from '../../packages/runner/src/executors/openai-responses.ts'
import { createMockResponses } from '../../packages/runner/test/helpers/mock-responses.ts'

afterEach(() => {
  clearOpenAiResponsesSessions()
})

describe('openai-responses cancel/timeout e2e (mock)', () => {
  it('cancel mid-poll: remote cancel + finished(cancelled) + D7a cancelled', async () => {
    const mock = createMockResponses({ statusSequence: ['queued', 'in_progress'] })
    let t = 0
    const { adapter, runDir, task, ctx } = harness(mock, {
      now: () => {
        t += 15_000
        return t
      },
      settings: { poll_interval_ms: 1 },
    })
    await adapter.start(task, ctx)
    await adapter.status('run-e2e-1')
    await adapter.cancel('run-e2e-1')
    const report = await adapter.collect('run-e2e-1')
    assert.equal(report.status, 'cancelled')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    assert.equal(mock.cancelCount, 1)
    assert.ok(mock.calls.some((c) => c.method === 'POST' && String(c.url).includes('/cancel')))
    assert.ok(exists(join(runDir, 'artifacts', 'activity.json')))
    assert.equal(exists(join(runDir, 'artifacts', 'report.md')), false)
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.match(events, /"type":"finished"/)
    assert.match(events, /"status":"cancelled"/)
  })

  it('timeout: remote cancel + finished(failed,timeout) + D7a failed', async () => {
    const mock = createMockResponses({ statusSequence: ['queued', 'in_progress'] })
    const { adapter, runDir, task, ctx } = harness(mock, {
      settings: { poll_interval_ms: 1, simulate_timeout_on_cancel: true },
    })
    await adapter.start(task, ctx)
    await adapter.cancel('run-e2e-1')
    const report = await adapter.collect('run-e2e-1')
    assert.equal(report.status, 'failed')
    assert.equal(report.summary, 'timeout')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    assert.equal(mock.cancelCount, 1)
    assert.equal(exists(join(runDir, 'artifacts', 'report.md')), false)
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.match(events, /"status":"failed"/)
    assert.match(events, /"reason":"timeout"/)
  })
})

function harness(
  mock: ReturnType<typeof createMockResponses>,
  opts: { now?: () => number; settings?: Record<string, unknown> },
) {
  const runDir = mkdtempSync(join(tmpdir(), 'rk-research-e2e-'))
  mkdirSync(join(runDir, 'artifacts'), { recursive: true })
  writeFileSync(join(runDir, 'run-state.json'), JSON.stringify({ run_id: 'run-e2e-1' }))
  writeFileSync(join(runDir, 'prompt.md'), 'Research latest Node.js release.\n')
  writeFileSync(join(runDir, 'events.jsonl'), '')
  const task = minimalTask()
  const adapter = createOpenAiResponsesExecutor(
    { projectRoot: process.cwd(), settings: opts.settings ?? {} },
    {
      fetch: mock.fetch,
      env: { OPENAI_API_KEY: 'sk-test' },
      now: opts.now ?? Date.now,
    },
  )
  const ctx = {
    worktreePath: runDir,
    runDir,
    attempt: 1,
    profile: {
      schema: 'rolekit/role-profile@1' as const,
      name: 'researcher',
      capabilities: [],
      boundaries: [],
      deliverables: [],
      verification: [],
      prompt_fragments: [],
    },
    policy: {
      schema: 'rolekit/gate-policy@1' as const,
      default_action: 'ignore' as const,
      triggers: {
        'new-dependency': 'confirm' as const,
        migration: 'block' as const,
        'public-api-change': 'confirm' as const,
        delete: 'confirm' as const,
        'scope-violation': 'block' as const,
        'ambiguous-requirement': 'confirm' as const,
        'design-artifact': 'confirm' as const,
        'final-acceptance': 'confirm' as const,
      },
    },
  }
  return { adapter, runDir, task, ctx }
}

function minimalTask(): TaskContract {
  return {
    schema: 'rolekit/task-contract@1',
    id: 'RK-E2E-RESEARCH',
    kind: 'research',
    role: 'researcher',
    executor: 'openai-responses',
    objective: 'research',
    context: { required_files: [], docs: [] },
    scope: { writable: [], forbidden: [] },
    constraints: [],
    deliverables: [],
    acceptance: {
      commands: [{ run: 'node -e "process.exit(0)"', expect_exit: 0 }],
      assertions: ['Post-run: npm run check:research'],
    },
    execution: {
      worktree: 'isolated',
      max_tool_calls: 5,
      network: 'allow',
      timeout_minutes: 5,
    },
    escalation: {
      on_scope_change: 'return_blocked',
      on_new_dependency: 'require_approval',
      on_ambiguous_requirement: 'return_question',
    },
  }
}

function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

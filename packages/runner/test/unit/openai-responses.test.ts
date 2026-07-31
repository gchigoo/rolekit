import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { TaskContract } from '@rolekit/core'
import { ExecutorIncompatibleError, ExecutorUnsupportedOperationError } from '../../src/errors.ts'
import {
  clearOpenAiResponsesSessions,
  createOpenAiResponsesExecutor,
} from '../../src/executors/openai-responses.ts'
import { createMockResponses } from '../helpers/mock-responses.ts'

afterEach(() => {
  clearOpenAiResponsesSessions()
})

describe('OpenAiResponsesExecutor', () => {
  it('probe missing key throws ExecutorIncompatibleError missing_api_key', async () => {
    const adapter = createOpenAiResponsesExecutor({ projectRoot: process.cwd() }, { env: {} })
    await assert.rejects(
      () => adapter.probe(),
      (err: unknown) => err instanceof ExecutorIncompatibleError && err.code === 'missing_api_key',
    )
  })

  it('probe returns capabilities without steer', async () => {
    const adapter = createOpenAiResponsesExecutor(
      { projectRoot: process.cwd() },
      { env: { OPENAI_API_KEY: 'sk-test' } },
    )
    const result = await adapter.probe()
    assert.equal(result.adapter, 'openai-responses')
    assert.equal(result.protocol_version, 'responses-v1')
    assert.deepEqual(result.capabilities, ['start', 'status', 'cancel', 'collect'])
  })

  it('steer throws unsupported_operation', async () => {
    const adapter = createOpenAiResponsesExecutor(
      { projectRoot: process.cwd() },
      { env: { OPENAI_API_KEY: 'sk-test' } },
    )
    await assert.rejects(
      () => adapter.steer('r1', 'x', { requestId: 'request-1' }),
      ExecutorUnsupportedOperationError,
    )
  })

  it('completed path: events dedupe + D7a two artifacts + evidence', async () => {
    const mock = createMockResponses({
      statusSequence: ['queued', 'in_progress', 'in_progress', 'completed'],
      completed: {
        text: 'Node.js findings here.',
        annotations: [
          {
            type: 'url_citation',
            start_index: 0,
            end_index: 7,
            url: 'https://nodejs.org/',
            title: 'Node.js',
          },
          {
            type: 'url_citation',
            start_index: 8,
            end_index: 16,
            url: 'https://nodejs.org/',
            title: 'Node.js',
          },
        ],
        tool_calls: [
          { id: 'ws_1', query: 'node latest' },
          { id: 'ws_1', query: 'node latest' },
        ],
      },
    })
    let t = 0
    const { adapter, runDir, task, runId } = setupAdapter(mock, {
      now: () => {
        t += 20_000
        return t
      },
      settings: { poll_interval_ms: 1 },
    })

    await adapter.start(task, ctxOf(runDir))
    for (let i = 0; i < 6; i += 1) {
      const st = await adapter.status(runId)
      if (st.state === 'finished') break
    }
    const report = await adapter.collect(runId)

    assert.equal(report.status, 'completed')
    assert.deepEqual(report.evidence, ['artifacts/report.md', 'artifacts/activity.json'])
    const reportMd = readFileSync(join(runDir, 'artifacts', 'report.md'), 'utf8')
    assert.match(reportMd, /\[\^1\]/)
    assert.match(reportMd, /\[\^1\]: \[Node\.js\]\(https:\/\/nodejs\.org\/\)/)
    // 同源复用编号，不应出现 [^2]
    assert.equal((reportMd.match(/\[\^2\]/g) ?? []).length, 0)

    const activity = JSON.parse(
      readFileSync(join(runDir, 'artifacts', 'activity.json'), 'utf8'),
    ) as { tool_calls: unknown[]; annotations: unknown[] }
    assert.ok(activity.tool_calls.length >= 1)
    assert.ok(activity.annotations.length >= 1)

    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })
    const toolEvents = events.filter((e) => e.type === 'tool_call')
    assert.equal(toolEvents.length, 1)
    const systemMsgs = events.filter((e) => e.type === 'message' && e.payload.role === 'system')
    assert.ok(systemMsgs.length >= 2)
    assert.ok(events.some((e) => e.type === 'finished' && e.payload.status === 'completed'))
  })

  it('cancel path: remote cancel + D7a cancelled row', async () => {
    const mock = createMockResponses({
      statusSequence: ['queued', 'in_progress'],
    })
    let t = 0
    const { adapter, runDir, task, runId } = setupAdapter(mock, {
      now: () => {
        t += 20_000
        return t
      },
      settings: { poll_interval_ms: 1 },
    })
    await adapter.start(task, ctxOf(runDir))
    await adapter.status(runId)
    await adapter.cancel(runId)
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'cancelled')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    assert.equal(mock.cancelCount, 1)
    assert.ok(exists(join(runDir, 'artifacts', 'activity.json')))
    assert.equal(exists(join(runDir, 'artifacts', 'report.md')), false)
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.match(events, /"status":"cancelled"/)
  })

  it('timeout cancel: D7a failed row + finished timeout', async () => {
    const mock = createMockResponses({
      statusSequence: ['queued', 'in_progress'],
    })
    const { adapter, runDir, task, runId } = setupAdapter(mock, {
      settings: { poll_interval_ms: 1, simulate_timeout_on_cancel: true },
    })
    await adapter.start(task, ctxOf(runDir))
    await adapter.cancel(runId)
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'failed')
    assert.equal(report.summary, 'timeout')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    assert.equal(exists(join(runDir, 'artifacts', 'report.md')), false)
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.match(events, /"status":"failed"/)
    assert.match(events, /"reason":"timeout"/)
  })

  it('API failed terminal: D7a failed activity only', async () => {
    const mock = createMockResponses({
      statusSequence: ['queued', 'failed'],
    })
    let t = 0
    const { adapter, runDir, task, runId } = setupAdapter(mock, {
      now: () => {
        t += 20_000
        return t
      },
      settings: { poll_interval_ms: 1 },
    })
    await adapter.start(task, ctxOf(runDir))
    for (let i = 0; i < 5; i += 1) {
      const st = await adapter.status(runId)
      if (st.state === 'finished') break
    }
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'failed')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    assert.equal(exists(join(runDir, 'artifacts', 'report.md')), false)
  })
})

function setupAdapter(
  mock: ReturnType<typeof createMockResponses>,
  opts: {
    now?: () => number
    settings?: Record<string, unknown>
    runId?: string
  } = {},
) {
  const runId = opts.runId ?? `run-${Math.random().toString(16).slice(2, 10)}`
  const runDir = mkdtempSync(join(tmpdir(), 'rk-oa-'))
  mkdirSync(join(runDir, 'artifacts'), { recursive: true })
  writeFileSync(join(runDir, 'run-state.json'), JSON.stringify({ run_id: runId }))
  writeFileSync(join(runDir, 'prompt.md'), 'Research Node.js latest release.\n')
  writeFileSync(join(runDir, 'events.jsonl'), '')
  const task = minimalTask()
  const adapter = createOpenAiResponsesExecutor(
    {
      projectRoot: process.cwd(),
      settings: opts.settings ?? { poll_interval_ms: 1 },
    },
    {
      fetch: mock.fetch,
      env: { OPENAI_API_KEY: 'sk-test' },
      now: opts.now ?? Date.now,
    },
  )
  return { adapter, runDir, task, runId }
}

function ctxOf(runDir: string) {
  return {
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
}

function minimalTask(): TaskContract {
  return {
    schema: 'rolekit/task-contract@1',
    id: 'RK-TEST',
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
      assertions: [],
    },
    execution: {
      worktree: 'isolated',
      max_tool_calls: 5,
      network: 'allow',
      timeout_minutes: 10,
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

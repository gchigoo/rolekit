import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { TaskContract } from '@rolekit/core'
import { ExecutorIncompatibleError, ExecutorUnsupportedOperationError } from '../../src/errors.ts'
import {
  clearChatgptCodexSessions,
  createChatgptCodexExecutor,
  normalizeSseEvent,
} from '../../src/executors/chatgpt-codex.ts'
import { createMockCodexSse } from '../helpers/mock-codex-sse.ts'

afterEach(() => {
  clearChatgptCodexSessions()
})

describe('ChatgptCodexExecutor', () => {
  it('probe missing auth throws missing_chatgpt_auth', async () => {
    const adapter = createChatgptCodexExecutor(
      { projectRoot: process.cwd() },
      { env: { ROLEKIT_CHATGPT_AUTH_FILE: join(tmpdir(), 'no-such-auth.json') } },
    )
    await assert.rejects(
      () => adapter.probe(),
      (err: unknown) =>
        err instanceof ExecutorIncompatibleError && err.code === 'missing_chatgpt_auth',
    )
  })

  it('probe returns capabilities without steer', async () => {
    const authPath = writeAuthFile()
    const adapter = createChatgptCodexExecutor(
      { projectRoot: process.cwd() },
      { env: { ROLEKIT_CHATGPT_AUTH_FILE: authPath } },
    )
    const result = await adapter.probe()
    assert.equal(result.adapter, 'chatgpt-codex')
    assert.equal(result.protocol_version, 'codex-responses-v1')
    assert.deepEqual(result.capabilities, ['start', 'status', 'cancel', 'collect'])
  })

  it('steer throws unsupported_operation', async () => {
    const authPath = writeAuthFile()
    const adapter = createChatgptCodexExecutor(
      { projectRoot: process.cwd() },
      { env: { ROLEKIT_CHATGPT_AUTH_FILE: authPath }, fetch: createMockCodexSse({}) },
    )
    await assert.rejects(
      () => adapter.steer('r1', 'x', { requestId: 'request-1' }),
      ExecutorUnsupportedOperationError,
    )
  })

  it('start returns immediately; completed SSE yields D7a two artifacts', async () => {
    const authPath = writeAuthFile()
    const mock = createMockCodexSse({
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
        ],
        tool_calls: [{ id: 'ws_1', query: 'node latest' }],
      },
    })
    const { adapter, runDir, task, runId, ctx } = setupAdapter(authPath, mock)
    const handle = await adapter.start(task, ctx)
    assert.equal(handle.run_id, runId)
    const st = await adapter.status(runId)
    assert.ok(st.state === 'running' || st.state === 'finished')
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'completed')
    assert.deepEqual(report.evidence, ['artifacts/report.md', 'artifacts/activity.json'])
    const activity = JSON.parse(
      readFileSync(join(runDir, 'artifacts', 'activity.json'), 'utf8'),
    ) as { tool_calls: unknown[] }
    assert.ok(activity.tool_calls.length >= 1)
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.match(events, /tool_call/)
    assert.match(events, /finished/)
    assert.doesNotMatch(events, /rt-test|eyJhbGci/)
  })

  it('cancel aborts SSE and writes D7a cancelled activity only', async () => {
    const authPath = writeAuthFile()
    let aborted = false
    const mock = createMockCodexSse({
      mode: 'slow-then-complete',
      onAbort: () => {
        aborted = true
      },
    })
    const { adapter, task, runId, ctx } = setupAdapter(authPath, mock)
    await adapter.start(task, ctx)
    await adapter.cancel(runId)
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'cancelled')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    assert.equal(aborted, true)
  })

  it('normalizeSseEvent maps response.completed to terminal snapshot', () => {
    const out = normalizeSseEvent({
      type: 'response.completed',
      response: { id: 'r1', status: 'completed', output: [] },
    })
    assert.ok(out.terminalSnapshot)
  })

  it('normalizeSseEvent does not treat web_search_call.completed as terminal', () => {
    const out = normalizeSseEvent({
      type: 'response.web_search_call.completed',
      item_id: 'ws_1',
      output_index: 1,
    })
    assert.equal(out.terminalSnapshot, undefined)
  })

  it('aggregates output_item.done when response.completed.output is empty', async () => {
    const authPath = writeAuthFile()
    const mock: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('auth.openai.com')) {
        return createMockCodexSse({})(input, init)
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder()
          const push = (obj: unknown) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
          }
          push({
            type: 'response.created',
            response: { id: 'resp_agg', model: 'gpt-5.6-sol', status: 'in_progress', output: [] },
          })
          push({
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              id: 'ws_agg',
              type: 'web_search_call',
              status: 'completed',
              action: { query: 'node release' },
            },
          })
          push({
            type: 'response.output_item.done',
            output_index: 1,
            item: {
              id: 'msg_agg',
              type: 'message',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: 'Node findings.',
                  annotations: [
                    {
                      type: 'url_citation',
                      start_index: 0,
                      end_index: 4,
                      url: 'https://nodejs.org/',
                      title: 'Node.js',
                    },
                  ],
                },
              ],
            },
          })
          push({
            type: 'response.completed',
            response: { id: 'resp_agg', model: 'gpt-5.6-sol', status: 'completed', output: [] },
          })
          controller.enqueue(enc.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    const { adapter, runDir, task, runId, ctx } = setupAdapter(authPath, mock)
    await adapter.start(task, ctx)
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'completed')
    const activity = JSON.parse(
      readFileSync(join(runDir, 'artifacts', 'activity.json'), 'utf8'),
    ) as { tool_calls: unknown[]; annotations: unknown[] }
    assert.equal(activity.tool_calls.length, 1)
    assert.equal(activity.annotations.length, 1)
    assert.match(readFileSync(join(runDir, 'artifacts', 'report.md'), 'utf8'), /Node/)
    assert.match(readFileSync(join(runDir, 'artifacts', 'report.md'), 'utf8'), /nodejs\.org/)
  })

  it('HTTP failure writes D7a failed activity with status failed', async () => {
    const authPath = writeAuthFile()
    const mock = createMockCodexSse({ mode: 'fail-http' })
    const { adapter, runDir, task, runId, ctx } = setupAdapter(authPath, mock)
    await adapter.start(task, ctx)
    const report = await adapter.collect(runId)
    assert.equal(report.status, 'failed')
    assert.deepEqual(report.evidence, ['artifacts/activity.json'])
    const activity = JSON.parse(
      readFileSync(join(runDir, 'artifacts', 'activity.json'), 'utf8'),
    ) as { status: string; usage?: { error_code?: string } }
    assert.equal(activity.status, 'failed')
    assert.equal(activity.usage?.error_code, 'http_500')
  })
})

function writeAuthFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rk-codex-auth-'))
  const path = join(dir, 'auth.json')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  writeFileSync(
    path,
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: `${header}.${payload}.sig`,
        refresh_token: 'rt-test',
        account_id: 'acct-test',
      },
    }),
    'utf8',
  )
  return path
}

function setupAdapter(
  authPath: string,
  fetchFn: typeof fetch,
  extraSettings: Record<string, unknown> = {},
) {
  const runDir = mkdtempSync(join(tmpdir(), 'rk-codex-run-'))
  mkdirSync(join(runDir, 'wt'), { recursive: true })
  const runId = 'RK-TEST-CODEX'
  writeFileSync(join(runDir, 'run-state.json'), JSON.stringify({ run_id: runId }), 'utf8')
  writeFileSync(join(runDir, 'prompt.md'), 'Research Node.js latest release.\n', 'utf8')
  const task: TaskContract = {
    schema: 'rolekit/task-contract@1',
    id: 'RK-TEST-CODEX',
    kind: 'research',
    role: 'researcher',
    executor: 'chatgpt-codex',
    objective: 'test',
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
  const ctx = {
    worktreePath: join(runDir, 'wt'),
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
  const adapter = createChatgptCodexExecutor(
    { projectRoot: runDir, settings: { max_tool_calls: 5, ...extraSettings } },
    { env: { ROLEKIT_CHATGPT_AUTH_FILE: authPath }, fetch: fetchFn },
  )
  return { adapter, runDir, task, runId, ctx }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExecutorReport, TaskContract } from '@rolekit/core'
import type { ExecutorAdapter } from '../adapter.ts'
import {
  ExecutorIncompatibleError,
  ExecutorLostError,
  ExecutorStartError,
  ExecutorUnsupportedOperationError,
} from '../errors.ts'
import { appendJsonl, readJsonIfExists } from '../fs-util.ts'
import type {
  AdapterCreateOptions,
  ProbeResult,
  RunContext,
  RunHandle,
  RunStatus,
} from '../types.ts'
import {
  type ActivityJson,
  buildActivityJson,
  buildReportMarkdown,
  extractFromResponse,
} from './openai-responses-artifacts.ts'

const PROTOCOL_VERSION = 'responses-v1'
const API_BASE = 'https://api.openai.com/v1'

export interface OpenAiResponsesDeps {
  fetch?: typeof globalThis.fetch
  env?: NodeJS.ProcessEnv
  now?: () => number
}

interface ResearchSession {
  run_id: string
  task: TaskContract
  ctx: RunContext
  settings: Record<string, unknown>
  response_id: string | null
  api_status: string | null
  last_polled_at: number
  seen_tool_ids: Set<string>
  last_emitted_status: string | null
  finished: boolean
  cancelled: boolean
  timeout_terminal: boolean
  last_response: unknown
  report: ExecutorReport | null
  activity: ActivityJson
}

const sessions = new Map<string, ResearchSession>()

/**
 * Creates OpenAiResponsesExecutor — Responses API background research adapter.
 */
export function createOpenAiResponsesExecutor(
  options: AdapterCreateOptions,
  deps: OpenAiResponsesDeps = {},
): ExecutorAdapter {
  const settings = options.settings ?? {}
  const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis)
  const env = deps.env ?? process.env
  const now = deps.now ?? Date.now

  return {
    async probe(): Promise<ProbeResult> {
      const key = env.OPENAI_API_KEY
      if (typeof key !== 'string' || key.trim().length === 0) {
        throw new ExecutorIncompatibleError('OPENAI_API_KEY is required', 'missing_api_key')
      }
      return {
        adapter: 'openai-responses',
        protocol_version: PROTOCOL_VERSION,
        capabilities: ['start', 'status', 'cancel', 'collect'],
      }
    },

    async start(task: TaskContract, ctx: RunContext): Promise<RunHandle> {
      const key = requireApiKey(env)
      const existing = sessions.get(pathKey(ctx.runDir))
      if (existing && !existing.finished) {
        return { run_id: existing.run_id, pid: process.pid }
      }

      const runId = await readRunId(ctx.runDir)
      const prompt = await readFile(join(ctx.runDir, 'prompt.md'), 'utf8')
      const model = String(settings.model ?? 'gpt-5.6')
      const body = buildCreateBody(prompt, model, settings)

      let created: unknown
      try {
        created = await apiJson(fetchFn, key, 'POST', `${API_BASE}/responses`, body)
      } catch (error) {
        throw new ExecutorStartError(
          error instanceof Error ? error.message : 'responses create failed',
        )
      }

      const extracted = extractFromResponse(created)
      const session: ResearchSession = {
        run_id: runId,
        task,
        ctx,
        settings,
        response_id: extracted.response_id,
        api_status: extracted.status ?? 'queued',
        last_polled_at: 0,
        seen_tool_ids: new Set(),
        last_emitted_status: null,
        finished: false,
        cancelled: false,
        timeout_terminal: settings.simulate_timeout_on_cancel === true,
        last_response: created,
        report: null,
        activity: buildActivityJson({
          response_id: extracted.response_id,
          model: extracted.model ?? model,
          status: extracted.status ?? 'queued',
          tool_calls: extracted.tool_calls,
          annotations: extracted.annotations,
          usage: extracted.usage,
        }),
      }
      sessions.set(pathKey(ctx.runDir), session)

      await appendJsonl(join(ctx.runDir, 'events.jsonl'), {
        schema: 'rolekit/run-event@1',
        ts: new Date().toISOString(),
        run_id: runId,
        type: 'started',
        payload: {
          task_id: task.id,
          adapter: 'openai-responses',
          worktree: ctx.worktreePath,
        },
      })

      await emitStatusTransition(session, session.api_status ?? 'queued')
      await emitNewToolCalls(session, extracted.tool_calls)

      if (isTerminalStatus(session.api_status)) {
        await settleFromResponse(session, created)
      }

      return { run_id: runId, pid: process.pid }
    },

    async status(runId: string): Promise<RunStatus> {
      const session = findByRunId(runId)
      if (!session) {
        return { state: 'finished', last_event_ts: new Date().toISOString() }
      }
      if (session.finished) {
        return { state: 'finished', last_event_ts: new Date().toISOString() }
      }

      const pollMs = Number(session.settings.poll_interval_ms ?? 10_000)
      const elapsed = now() - session.last_polled_at
      if (session.last_polled_at === 0 || elapsed >= pollMs) {
        session.last_polled_at = now()
        await pollOnce(session, fetchFn, env)
      }

      return {
        state: session.finished ? 'finished' : 'running',
        last_event_ts: new Date().toISOString(),
      }
    },

    async steer(_runId: string, _message: string, _control: { requestId: string }): Promise<void> {
      throw new ExecutorUnsupportedOperationError('openai-responses does not declare steer')
    },

    async cancel(runId: string): Promise<void> {
      const session = findByRunId(runId)
      if (!session || session.finished) {
        return
      }
      session.cancelled = true
      const key = env.OPENAI_API_KEY
      if (session.response_id && typeof key === 'string' && key.trim()) {
        try {
          await apiJson(fetchFn, key, 'POST', `${API_BASE}/responses/${session.response_id}/cancel`)
        } catch {
          // 远端 cancel 尽力而为（对齐 pi-rpc D10）
        }
      }
      await finalizeNonCompleted(session, session.timeout_terminal ? 'timeout' : 'cancelled')
    },

    async collect(runId: string): Promise<ExecutorReport> {
      const session = findByRunId(runId)
      if (!session) {
        throw new ExecutorLostError(`openai-responses session missing: ${runId}`)
      }
      if (!session.finished) {
        // 用真实时钟等待终态；deps.now 仅服务 poll 间隔，不得缩短 collect 超时
        await waitUntil(() => session.finished, 120_000)
      }
      if (!session.report) {
        throw new ExecutorLostError(`openai-responses report missing: ${runId}`)
      }
      return session.report
    },
  }
}

async function pollOnce(
  session: ResearchSession,
  fetchFn: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (!session.response_id) {
    throw new ExecutorLostError('openai-responses missing response_id')
  }
  const key = requireApiKey(env)
  let response: unknown
  try {
    response = await apiJson(fetchFn, key, 'GET', `${API_BASE}/responses/${session.response_id}`)
  } catch (error) {
    await finalizeNonCompleted(session, 'lost')
    throw error instanceof ExecutorLostError
      ? error
      : new ExecutorLostError(error instanceof Error ? error.message : 'poll lost')
  }

  session.last_response = response
  const extracted = extractFromResponse(response)
  session.api_status = extracted.status
  session.activity = buildActivityJson({
    response_id: extracted.response_id ?? session.response_id,
    model: extracted.model ?? session.activity.model,
    status: extracted.status,
    tool_calls: mergeToolCalls(session.activity.tool_calls, extracted.tool_calls),
    annotations: extracted.annotations,
    usage: extracted.usage,
  })

  await emitStatusTransition(session, extracted.status)
  await emitNewToolCalls(session, extracted.tool_calls)

  if (isTerminalStatus(extracted.status)) {
    await settleFromResponse(session, response)
  }
}

async function settleFromResponse(session: ResearchSession, response: unknown): Promise<void> {
  if (session.finished) return
  const extracted = extractFromResponse(response)
  const status = extracted.status ?? 'failed'

  if (status === 'completed') {
    await mkdir(join(session.ctx.runDir, 'artifacts'), { recursive: true })
    const activity = buildActivityJson({
      response_id: extracted.response_id ?? session.response_id,
      model: extracted.model ?? session.activity.model,
      status,
      tool_calls: mergeToolCalls(session.activity.tool_calls, extracted.tool_calls),
      annotations: extracted.annotations,
      usage: extracted.usage,
    })
    const reportMd = buildReportMarkdown(extracted.text || '(empty)', extracted.annotations)
    await writeFile(
      join(session.ctx.runDir, 'artifacts', 'activity.json'),
      `${JSON.stringify(activity, null, 2)}\n`,
      'utf8',
    )
    await writeFile(join(session.ctx.runDir, 'artifacts', 'report.md'), reportMd, 'utf8')
    session.activity = activity
    session.report = {
      schema: 'rolekit/executor-report@1',
      task_id: session.task.id,
      status: 'completed',
      summary: 'research completed',
      changed_files: [],
      decisions: [],
      assumptions: [],
      evidence: ['artifacts/report.md', 'artifacts/activity.json'],
      risks: [],
      unresolved: [],
      recommended_next_action: 'run check:research',
    }
    session.finished = true
    if (!session.ctx.supervisorOwnsTerminal) await emitFinished(session, 'completed', null)
    return
  }

  if (status === 'cancelled' || session.cancelled) {
    await finalizeNonCompleted(session, 'cancelled')
    return
  }

  await finalizeNonCompleted(session, status === 'incomplete' ? 'failed' : 'failed')
}

async function finalizeNonCompleted(
  session: ResearchSession,
  reason: 'cancelled' | 'timeout' | 'failed' | 'lost',
): Promise<void> {
  if (session.finished) return
  await mkdir(join(session.ctx.runDir, 'artifacts'), { recursive: true })
  const activity = buildActivityJson({
    response_id: session.response_id,
    model: session.activity.model,
    status: reason === 'timeout' ? 'failed' : (session.api_status ?? reason),
    tool_calls: session.activity.tool_calls,
    annotations: session.activity.annotations,
    usage: session.activity.usage,
  })
  await writeFile(
    join(session.ctx.runDir, 'artifacts', 'activity.json'),
    `${JSON.stringify(activity, null, 2)}\n`,
    'utf8',
  )
  session.activity = activity
  const envelopeStatus = reason === 'cancelled' ? 'cancelled' : 'failed'
  const finishedReason =
    reason === 'cancelled'
      ? 'cancelled'
      : reason === 'timeout'
        ? 'timeout'
        : reason === 'lost'
          ? 'lost'
          : reason
  session.report = {
    schema: 'rolekit/executor-report@1',
    task_id: session.task.id,
    status: envelopeStatus,
    summary: finishedReason,
    changed_files: [],
    decisions: [],
    assumptions: [],
    evidence: ['artifacts/activity.json'],
    risks: [],
    unresolved: [finishedReason],
    recommended_next_action: 'inspect',
  }
  session.finished = true
  if (!session.ctx.supervisorOwnsTerminal) {
    await emitFinished(session, envelopeStatus, finishedReason)
  }
}

async function emitStatusTransition(
  session: ResearchSession,
  status: string | null | undefined,
): Promise<void> {
  if (!status || status === session.last_emitted_status) return
  session.last_emitted_status = status
  await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
    schema: 'rolekit/run-event@1',
    ts: new Date().toISOString(),
    run_id: session.run_id,
    type: 'message',
    payload: { role: 'system', text: `openai-responses status: ${status}` },
  })
}

async function emitNewToolCalls(
  session: ResearchSession,
  toolCalls: Array<{ id: string; type: string; query?: string }>,
): Promise<void> {
  for (const call of toolCalls) {
    if (session.seen_tool_ids.has(call.id)) continue
    session.seen_tool_ids.add(call.id)
    await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
      schema: 'rolekit/run-event@1',
      ts: new Date().toISOString(),
      run_id: session.run_id,
      type: 'tool_call',
      payload: {
        name: call.type,
        args_digest: call.query ?? call.id,
      },
    })
  }
}

async function emitFinished(
  session: ResearchSession,
  status: ExecutorReport['status'],
  reason: string | null,
): Promise<void> {
  await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
    schema: 'rolekit/run-event@1',
    ts: new Date().toISOString(),
    run_id: session.run_id,
    type: 'finished',
    payload: { status, reason },
  })
}

function buildCreateBody(
  prompt: string,
  model: string,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const searchContext = String(settings.search_context_size ?? 'high')
  const tool: Record<string, unknown> = {
    type: 'web_search',
    search_context_size: searchContext,
  }
  const allowed = asStringArray(settings.allowed_domains)
  const blocked = asStringArray(settings.blocked_domains)
  if (allowed.length > 0 || blocked.length > 0) {
    const filters: Record<string, unknown> = {}
    if (allowed.length > 0) filters.allowed_domains = allowed.slice(0, 100)
    if (blocked.length > 0) filters.blocked_domains = blocked.slice(0, 100)
    tool.filters = filters
  }
  const body: Record<string, unknown> = {
    model,
    input: prompt,
    background: true,
    tools: [tool],
    max_tool_calls: Number(settings.max_tool_calls ?? 30),
    reasoning: {
      effort: String(settings.reasoning_effort ?? 'xhigh'),
    },
  }
  return body
}

async function apiJson(
  fetchFn: typeof fetch,
  apiKey: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch (error) {
    throw new ExecutorLostError(error instanceof Error ? error.message : 'network error')
  }
  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }
  }
  if (!res.ok) {
    const msg = `OpenAI ${method} ${url} -> ${res.status}`
    if (res.status === 404) {
      throw new ExecutorLostError(msg)
    }
    throw new Error(msg)
  }
  return parsed
}

function requireApiKey(env: NodeJS.ProcessEnv): string {
  const key = env.OPENAI_API_KEY
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new ExecutorIncompatibleError('OPENAI_API_KEY is required', 'missing_api_key')
  }
  return key
}

function isTerminalStatus(status: string | null | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'incomplete'
  )
}

function mergeToolCalls(
  prev: ActivityJson['tool_calls'],
  next: ActivityJson['tool_calls'],
): ActivityJson['tool_calls'] {
  const map = new Map<string, ActivityJson['tool_calls'][number]>()
  for (const t of prev) map.set(t.id, t)
  for (const t of next) map.set(t.id, t)
  return [...map.values()]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').slice(0, 100)
}

async function readRunId(runDirectory: string): Promise<string> {
  const state = await readJsonIfExists<{ run_id: string }>(join(runDirectory, 'run-state.json'))
  if (!state) {
    throw new Error('run-state missing for openai-responses start')
  }
  return state.run_id
}

function pathKey(runDirectory: string): string {
  return runDirectory.replace(/\\/g, '/').toLowerCase()
}

function findByRunId(runId: string): ResearchSession | undefined {
  for (const session of sessions.values()) {
    if (session.run_id === runId) return session
  }
  return undefined
}

async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return
    await sleep(20)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Test helper: clear in-memory sessions. */
export function clearOpenAiResponsesSessions(): void {
  sessions.clear()
}

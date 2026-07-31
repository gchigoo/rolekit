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
  type ChatgptAuthDeps,
  ensureAccessToken,
  isAccessTokenExpired,
  loadChatgptAuth,
  resolveChatgptAuthPath,
} from './chatgpt-auth.ts'
import {
  type ActivityJson,
  buildActivityJson,
  buildReportMarkdown,
  extractFromResponse,
} from './openai-responses-artifacts.ts'

const PROTOCOL_VERSION = 'codex-responses-v1'
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

export interface ChatgptCodexDeps extends ChatgptAuthDeps {
  fetch?: typeof globalThis.fetch
  now?: () => number
}

interface CodexSession {
  run_id: string
  task: TaskContract
  ctx: RunContext
  settings: Record<string, unknown>
  response_id: string | null
  api_status: string | null
  seen_tool_ids: Set<string>
  last_emitted_status: string | null
  finished: boolean
  cancelled: boolean
  timeout_terminal: boolean
  last_response: unknown
  /** Codex SSE 的 response.completed.output 常为空；从 output_item.* 聚合 */
  outputItems: Map<string, Record<string, unknown>>
  report: ExecutorReport | null
  activity: ActivityJson
  abort: AbortController
  drainPromise: Promise<void> | null
}

const sessions = new Map<string, CodexSession>()

/**
 * Creates ChatgptCodexExecutor — ChatGPT subscription Codex Responses SSE adapter.
 */
export function createChatgptCodexExecutor(
  options: AdapterCreateOptions,
  deps: ChatgptCodexDeps = {},
): ExecutorAdapter {
  const settings = options.settings ?? {}
  const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis)
  const env = deps.env ?? process.env
  const home = deps.homedir
  const now = deps.now ?? Date.now

  return {
    async probe(): Promise<ProbeResult> {
      const path = resolveChatgptAuthPath(env, home)
      const auth = await loadChatgptAuth(path)
      const accessOk =
        Boolean(auth.tokens.access_token) && !isAccessTokenExpired(auth.tokens.access_token, now())
      if (!accessOk && !auth.tokens.refresh_token) {
        throw new ExecutorIncompatibleError(
          'ChatGPT access_token expired and refresh_token missing',
          'missing_chatgpt_auth',
        )
      }
      return {
        adapter: 'chatgpt-codex',
        protocol_version: PROTOCOL_VERSION,
        capabilities: ['start', 'status', 'cancel', 'collect'],
      }
    },

    async start(task: TaskContract, ctx: RunContext): Promise<RunHandle> {
      const path = resolveChatgptAuthPath(env, home)
      let creds: { accessToken: string; accountId: string }
      try {
        creds = await ensureAccessToken(path, { fetch: fetchFn, env, homedir: home, now })
      } catch (error) {
        if (error instanceof ExecutorIncompatibleError) throw error
        throw new ExecutorStartError(error instanceof Error ? error.message : 'chatgpt auth failed')
      }

      const existing = sessions.get(pathKey(ctx.runDir))
      if (existing && !existing.finished) {
        return { run_id: existing.run_id, pid: process.pid }
      }

      const runId = await readRunId(ctx.runDir)
      const prompt = await readFile(join(ctx.runDir, 'prompt.md'), 'utf8')
      const model = String(settings.model ?? 'gpt-5.6-sol')
      const abort = new AbortController()
      const session: CodexSession = {
        run_id: runId,
        task,
        ctx,
        settings,
        response_id: null,
        api_status: 'queued',
        seen_tool_ids: new Set(),
        last_emitted_status: null,
        finished: false,
        cancelled: false,
        timeout_terminal: settings.simulate_timeout_on_cancel === true,
        last_response: null,
        report: null,
        activity: buildActivityJson({
          response_id: null,
          model,
          status: 'queued',
          tool_calls: [],
          annotations: [],
        }),
        abort,
        outputItems: new Map(),
        drainPromise: null,
      }
      sessions.set(pathKey(ctx.runDir), session)

      await appendJsonl(join(ctx.runDir, 'events.jsonl'), {
        schema: 'rolekit/run-event@1',
        ts: new Date().toISOString(),
        run_id: runId,
        type: 'started',
        payload: {
          task_id: task.id,
          adapter: 'chatgpt-codex',
          worktree: ctx.worktreePath,
        },
      })
      await emitStatusTransition(session, 'queued')

      // 非阻塞：后台 drain SSE；start 立即返回
      session.drainPromise = drainSse(session, fetchFn, creds, prompt, model, {
        env,
        home,
        now,
      }).catch(async (error) => {
        if (!session.finished) {
          session.api_status = 'failed'
          await finalizeNonCompleted(session, 'lost')
        }
        void error
      })

      return { run_id: runId, pid: process.pid }
    },

    async status(runId: string): Promise<RunStatus> {
      const session = findByRunId(runId)
      if (!session) {
        return { state: 'finished', last_event_ts: new Date().toISOString() }
      }
      return {
        state: session.finished ? 'finished' : 'running',
        last_event_ts: new Date().toISOString(),
      }
    },

    async steer(_runId: string, _message: string, _control: { requestId: string }): Promise<void> {
      throw new ExecutorUnsupportedOperationError('chatgpt-codex does not declare steer')
    },

    async cancel(runId: string): Promise<void> {
      const session = findByRunId(runId)
      if (!session || session.finished) return
      session.cancelled = true
      session.abort.abort()
      await finalizeNonCompleted(session, session.timeout_terminal ? 'timeout' : 'cancelled')
    },

    async collect(runId: string): Promise<ExecutorReport> {
      const session = findByRunId(runId)
      if (!session) {
        throw new ExecutorLostError(`chatgpt-codex session missing: ${runId}`)
      }
      if (!session.finished && session.drainPromise) {
        await Promise.race([session.drainPromise, waitUntil(() => session.finished, 120_000)])
      }
      if (!session.finished) {
        await waitUntil(() => session.finished, 120_000)
      }
      if (!session.report) {
        throw new ExecutorLostError(`chatgpt-codex report missing: ${runId}`)
      }
      return session.report
    },
  }
}

async function drainSse(
  session: CodexSession,
  fetchFn: typeof fetch,
  creds: { accessToken: string; accountId: string },
  prompt: string,
  model: string,
  authCtx: {
    env: NodeJS.ProcessEnv
    home?: () => string
    now: () => number
  },
  retried401 = false,
  connectAttempt = 0,
): Promise<void> {
  const body = buildCodexBody(prompt, model, session.settings)
  const maxConnectAttempts = 4
  let res: Response
  try {
    res = await fetchFn(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'ChatGPT-Account-ID': creds.accountId,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'rolekit',
      },
      body: JSON.stringify(body),
      signal: session.abort.signal,
    })
  } catch (error) {
    if (session.cancelled || session.abort.signal.aborted) {
      if (!session.finished) {
        await finalizeNonCompleted(session, session.timeout_terminal ? 'timeout' : 'cancelled')
      }
      return
    }
    const cause =
      error && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: { code?: string } }).cause
        : undefined
    const code = typeof cause?.code === 'string' ? cause.code : 'connect_failed'
    // chatgpt.com 间歇 ConnectTimeout：有限次退避重试
    if (
      connectAttempt + 1 < maxConnectAttempts &&
      (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_CONNECT' || code === 'ECONNRESET')
    ) {
      await sleep(1500 * (connectAttempt + 1))
      if (session.cancelled || session.abort.signal.aborted) {
        if (!session.finished) {
          await finalizeNonCompleted(session, session.timeout_terminal ? 'timeout' : 'cancelled')
        }
        return
      }
      return drainSse(
        session,
        fetchFn,
        creds,
        prompt,
        model,
        authCtx,
        retried401,
        connectAttempt + 1,
      )
    }
    session.api_status = 'failed'
    session.activity = buildActivityJson({
      ...session.activity,
      status: 'failed',
      usage: { error_code: code },
    })
    if (!session.finished) await finalizeNonCompleted(session, 'failed')
    throw new ExecutorLostError(error instanceof Error ? error.message : 'codex SSE connect failed')
  }

  if (!res.ok) {
    // D2b: 401 时尝试一次 refresh 后重试 POST
    if (res.status === 401 && !retried401) {
      try {
        const path = resolveChatgptAuthPath(authCtx.env, authCtx.home)
        const refreshed = await ensureAccessToken(path, {
          fetch: fetchFn,
          env: authCtx.env,
          homedir: authCtx.home,
          now: authCtx.now,
        })
        creds.accessToken = refreshed.accessToken
        creds.accountId = refreshed.accountId
        return await drainSse(session, fetchFn, creds, prompt, model, authCtx, true)
      } catch {
        // fall through to failed
      }
    }
    const msg = `chatgpt-codex POST -> ${res.status}`
    session.api_status = 'failed'
    session.activity = buildActivityJson({
      ...session.activity,
      status: 'failed',
      usage: { error_code: `http_${res.status}` },
    })
    if (!session.finished) await finalizeNonCompleted(session, 'failed')
    throw new ExecutorStartError(msg)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
    const snapshot = (await res.json()) as unknown
    await applySnapshot(session, snapshot)
    return
  }

  if (!res.body) {
    throw new ExecutorLostError('chatgpt-codex SSE missing body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let latestSnapshot: unknown = null

  try {
    while (!session.finished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let event: unknown
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        const normalized = normalizeSseEvent(event)
        if (normalized.item) {
          upsertOutputItem(session, normalized.item, normalized.outputIndex)
        }
        if (normalized.snapshot) {
          latestSnapshot = mergeSnapshotOutput(normalized.snapshot, session)
          await applyPartial(session, latestSnapshot)
        }
        if (normalized.terminalSnapshot) {
          latestSnapshot = mergeSnapshotOutput(normalized.terminalSnapshot, session)
          await applySnapshot(session, latestSnapshot)
          return
        }
      }
    }
  } catch (error) {
    if (session.cancelled || session.abort.signal.aborted) {
      if (!session.finished) {
        await finalizeNonCompleted(session, session.timeout_terminal ? 'timeout' : 'cancelled')
      }
      return
    }
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  if (!session.finished) {
    if (latestSnapshot) {
      await applySnapshot(session, latestSnapshot)
    } else {
      await finalizeNonCompleted(session, session.cancelled ? 'cancelled' : 'lost')
    }
  }
}

/**
 * Normalizes Codex SSE events into Platform-shaped snapshots for extractFromResponse.
 * 仅 `response.completed|failed|cancelled|incomplete` 为终态——勿用 endsWith，
 * 否则 `response.web_search_call.completed` 会误终态。
 */
export function normalizeSseEvent(event: unknown): {
  snapshot?: unknown
  terminalSnapshot?: unknown
  item?: Record<string, unknown>
  outputIndex?: number
} {
  const rec = asRecord(event)
  const type = typeof rec.type === 'string' ? rec.type : ''
  const response = rec.response

  if (type === 'response.completed') {
    return { terminalSnapshot: coerceSnapshot(response ?? rec, 'completed') }
  }
  if (type === 'response.failed' || type === 'response.incomplete') {
    return { terminalSnapshot: coerceSnapshot(response ?? rec, 'failed') }
  }
  if (type === 'response.cancelled') {
    return { terminalSnapshot: coerceSnapshot(response ?? rec, 'cancelled') }
  }

  if (type === 'response.output_item.done' || type === 'response.output_item.added') {
    const item = asRecord(rec.item)
    return {
      item: Object.keys(item).length > 0 ? item : undefined,
      outputIndex: typeof rec.output_index === 'number' ? rec.output_index : undefined,
      snapshot: { status: 'in_progress', output: [] },
    }
  }

  if (type === 'response.created' || type === 'response.in_progress') {
    const snap = asRecord(response ?? rec)
    return {
      snapshot: coerceSnapshot(snap, typeof snap.status === 'string' ? snap.status : 'in_progress'),
    }
  }

  // web_search_call.* / output_text.* 等进度事件：不终态、不覆盖 snapshot
  return {}
}

function coerceSnapshot(value: unknown, status: string): Record<string, unknown> {
  const root = asRecord(value)
  return {
    id: typeof root.id === 'string' ? root.id : null,
    model: typeof root.model === 'string' ? root.model : null,
    status: typeof root.status === 'string' ? root.status : status,
    output: Array.isArray(root.output) ? root.output : [],
    ...(typeof root.output_text === 'string' ? { output_text: root.output_text } : {}),
    ...(root.usage !== undefined ? { usage: root.usage } : {}),
  }
}

function upsertOutputItem(
  session: CodexSession,
  item: Record<string, unknown>,
  outputIndex?: number,
): void {
  const id =
    typeof item.id === 'string'
      ? item.id
      : typeof outputIndex === 'number'
        ? `output_${outputIndex}`
        : `output_${session.outputItems.size}`
  session.outputItems.set(id, item)
}

/**
 * Codex 订阅 SSE：response.completed.output 常为空，合并已聚合的 output_item。
 * 若 snapshot 自带非空 output（Platform 形 / mock），优先使用。
 */
function mergeSnapshotOutput(snapshot: unknown, session: CodexSession): Record<string, unknown> {
  const root = coerceSnapshot(
    snapshot,
    typeof asRecord(snapshot).status === 'string'
      ? String(asRecord(snapshot).status)
      : (session.api_status ?? 'in_progress'),
  )
  if (Array.isArray(root.output) && root.output.length > 0) {
    return root
  }
  if (session.outputItems.size === 0) {
    return root
  }
  return {
    ...root,
    id: root.id ?? session.response_id,
    model: root.model ?? session.activity.model,
    output: [...session.outputItems.values()],
  }
}

/**
 * Builds Codex Responses SSE body.
 * ChatGPT 订阅端点拒绝 max_tool_calls（HTTP 400）；控费改靠 timeout / prompt 约束。
 */
function buildCodexBody(
  prompt: string,
  model: string,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const searchContext = String(settings.search_context_size ?? 'high')
  const tool: Record<string, unknown> = {
    type: 'web_search',
    search_context_size: searchContext,
  }
  return {
    model,
    instructions:
      'You are RoleKit researcher. Always use web_search for factual claims. Produce cited findings with url citations.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ],
    tools: [tool],
    store: false,
    stream: true,
    reasoning: {
      effort: String(settings.reasoning_effort ?? 'xhigh'),
    },
  }
}

async function applyPartial(session: CodexSession, snapshot: unknown): Promise<void> {
  if (session.finished) return
  const extracted = extractFromResponse(snapshot)
  session.last_response = snapshot
  if (extracted.response_id) session.response_id = extracted.response_id
  if (extracted.status) session.api_status = extracted.status
  session.activity = buildActivityJson({
    response_id: extracted.response_id ?? session.response_id,
    model: extracted.model ?? session.activity.model,
    status: extracted.status ?? session.api_status,
    tool_calls: mergeToolCalls(session.activity.tool_calls, extracted.tool_calls),
    annotations: extracted.annotations.length
      ? extracted.annotations
      : session.activity.annotations,
    usage: extracted.usage ?? session.activity.usage,
  })
  await emitStatusTransition(session, session.api_status)
  await emitNewToolCalls(session, extracted.tool_calls)
}

async function applySnapshot(session: CodexSession, snapshot: unknown): Promise<void> {
  if (session.finished) return
  await applyPartial(session, snapshot)
  const extracted = extractFromResponse(snapshot)
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
    if (!session.ctx.supervisorOwnsTerminal) await emitFinished(session, 'completed', null)
    session.finished = true
    return
  }
  if (status === 'cancelled' || session.cancelled) {
    await finalizeNonCompleted(session, 'cancelled')
    return
  }
  await finalizeNonCompleted(session, 'failed')
}

async function finalizeNonCompleted(
  session: CodexSession,
  reason: 'cancelled' | 'timeout' | 'failed' | 'lost',
): Promise<void> {
  if (session.finished) return
  await mkdir(join(session.ctx.runDir, 'artifacts'), { recursive: true })
  const statusForActivity =
    reason === 'cancelled'
      ? 'cancelled'
      : reason === 'timeout' || reason === 'failed' || reason === 'lost'
        ? 'failed'
        : (session.api_status ?? reason)
  session.api_status = statusForActivity
  const activity = buildActivityJson({
    response_id: session.response_id,
    model: session.activity.model,
    status: statusForActivity,
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
  if (!session.ctx.supervisorOwnsTerminal) {
    await emitFinished(session, envelopeStatus, finishedReason)
  }
  session.finished = true
}

async function emitStatusTransition(
  session: CodexSession,
  status: string | null | undefined,
): Promise<void> {
  if (!status || status === session.last_emitted_status) return
  session.last_emitted_status = status
  await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
    schema: 'rolekit/run-event@1',
    ts: new Date().toISOString(),
    run_id: session.run_id,
    type: 'message',
    payload: { role: 'system', text: `chatgpt-codex status: ${status}` },
  })
}

async function emitNewToolCalls(
  session: CodexSession,
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
  session: CodexSession,
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

function mergeToolCalls(
  prev: ActivityJson['tool_calls'],
  next: ActivityJson['tool_calls'],
): ActivityJson['tool_calls'] {
  const map = new Map<string, ActivityJson['tool_calls'][number]>()
  for (const t of prev) map.set(t.id, t)
  for (const t of next) map.set(t.id, t)
  return [...map.values()]
}

async function readRunId(runDirectory: string): Promise<string> {
  const state = await readJsonIfExists<{ run_id: string }>(join(runDirectory, 'run-state.json'))
  if (!state) {
    throw new Error('run-state missing for chatgpt-codex start')
  }
  return state.run_id
}

function pathKey(runDirectory: string): string {
  return runDirectory.replace(/\\/g, '/').toLowerCase()
}

function findByRunId(runId: string): CodexSession | undefined {
  for (const session of sessions.values()) {
    if (session.run_id === runId) return session
  }
  return undefined
}

async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((r) => setTimeout(r, 20))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Test helper: clear in-memory sessions. */
export function clearChatgptCodexSessions(): void {
  sessions.clear()
}

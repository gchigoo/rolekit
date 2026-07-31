import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExecutorReport, TaskContract } from '@rolekit/core'
import type { ExecutorAdapter } from '../adapter.ts'
import { ExecutorLostError, ExecutorSteerRejectedError } from '../errors.ts'
import { appendJsonl, readJsonIfExists, writeJsonAtomic } from '../fs-util.ts'
import type {
  AdapterCreateOptions,
  ProbeResult,
  RunContext,
  RunHandle,
  RunStatus,
} from '../types.ts'

interface MockSession {
  run_id: string
  pid: number
  task: TaskContract
  ctx: RunContext
  cancelled: boolean
  finished: boolean
  report: ExecutorReport | null
  started_at: string
  settings: Record<string, unknown>
  steered: boolean
}

const sessions = new Map<string, MockSession>()

/**
 * Creates MockExecutor adapter (test/dogfood).
 */
export function createMockExecutor(options: AdapterCreateOptions): ExecutorAdapter {
  const settings = options.settings ?? {}

  return {
    async probe(): Promise<ProbeResult> {
      if (settings.probe_incompatible === true) {
        const { ExecutorIncompatibleError } = await import('../errors.ts')
        throw new ExecutorIncompatibleError('mock probe forced incompatible')
      }
      return {
        adapter: 'mock',
        protocol_version: '1',
        capabilities: ['start', 'status', 'steer', 'cancel', 'collect'],
      }
    },

    async start(task: TaskContract, ctx: RunContext): Promise<RunHandle> {
      const existing = sessions.get(pathKey(ctx.runDir))
      if (existing && !existing.finished) {
        return { run_id: existing.run_id, pid: existing.pid }
      }
      const runId = await readRunId(ctx.runDir)
      const session: MockSession = {
        run_id: runId,
        pid: process.pid,
        task,
        ctx,
        cancelled: false,
        finished: false,
        report: null,
        started_at: new Date().toISOString(),
        settings,
        steered: false,
      }
      sessions.set(pathKey(ctx.runDir), session)
      await appendJsonl(join(ctx.runDir, 'events.jsonl'), {
        schema: 'rolekit/run-event@1',
        ts: new Date().toISOString(),
        run_id: runId,
        type: 'started',
        payload: {
          task_id: task.id,
          adapter: 'mock',
          worktree: ctx.worktreePath,
        },
      })
      // 异步推进 mock worker，避免阻塞 start 返回
      void runMockWork(session)
      return { run_id: runId, pid: session.pid }
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

    async steer(runId: string, message: string, control: { requestId: string }): Promise<void> {
      const session = findByRunId(runId)
      if (!session || session.finished) {
        throw new ExecutorLostError(`mock session missing: ${runId}`)
      }
      const delay = Number(session.settings.steer_delay_ms ?? 0)
      if (delay > 0) await sleep(delay)
      if (session.settings.steer_hang === true) {
        await new Promise<void>(() => undefined)
      }
      if (session.settings.steer_lost === true) {
        session.finished = true
        throw new ExecutorLostError('mock steer forced executor loss')
      }
      if (session.settings.steer_reject === true) {
        throw new ExecutorSteerRejectedError('mock steer rejected')
      }
      session.steered = true
      const receiptPath = join(session.ctx.runDir, 'artifacts', 'mock-steer.json')
      const receipt = (await readJsonIfExists<{
        requests: Array<{ request_id: string; message: string }>
      }>(receiptPath)) ?? { requests: [] }
      receipt.requests.push({ request_id: control.requestId, message })
      await writeJsonAtomic(receiptPath, receipt)
    },

    async cancel(runId: string): Promise<void> {
      const session = findByRunId(runId)
      if (!session || session.finished) {
        return
      }
      session.cancelled = true
      session.finished = true
      session.report = emptyReport(session.task.id, 'cancelled', 'cancelled by user')
      await writeReport(session)
    },

    async collect(runId: string): Promise<ExecutorReport> {
      const session = findByRunId(runId)
      if (!session) {
        throw new Error(`mock session not found: ${runId}`)
      }
      if (!session.finished || !session.report) {
        // 等待短暂完成窗口
        await waitUntil(() => session.finished && session.report !== null, 10_000)
      }
      if (!session.report) {
        throw new Error(`mock report missing: ${runId}`)
      }
      return session.report
    },
  }
}

async function runMockWork(session: MockSession): Promise<void> {
  const delay = Number(session.settings.delay_ms ?? 50)
  await sleep(delay)
  if (session.settings.wait_for_steer === true) {
    await waitUntil(() => session.steered || session.cancelled, 30 * 60_000)
  }
  if (session.cancelled) {
    return
  }
  if (session.settings.lose_process === true) {
    const { ExecutorLostError } = await import('../errors.ts')
    session.finished = true
    sessions.delete(pathKey(session.ctx.runDir))
    throw new ExecutorLostError('mock lost process')
  }
  if (session.settings.fail_status === 'blocked') {
    session.report = emptyReport(session.task.id, 'blocked', 'mock blocked')
    session.finished = true
    await writeReport(session)
    return
  }
  if (session.settings.fail_status === 'question') {
    session.report = emptyReport(session.task.id, 'question', 'mock question')
    session.finished = true
    await writeReport(session)
    return
  }
  if (session.settings.fail_status === 'failed') {
    session.report = emptyReport(session.task.id, 'failed', 'mock failed')
    session.finished = true
    await writeReport(session)
    return
  }

  const writeRel = String(session.settings.write_file ?? 'src/implemented.txt')
  const writeAbs = join(session.ctx.worktreePath, writeRel)
  await mkdir(join(writeAbs, '..'), { recursive: true })
  await writeFile(writeAbs, String(session.settings.write_content ?? 'ok\n'), 'utf8')

  if (session.settings.write_forbidden === true) {
    const forbidden = join(session.ctx.worktreePath, 'forbidden-out.txt')
    await writeFile(forbidden, 'leak\n', 'utf8')
  }

  await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
    schema: 'rolekit/run-event@1',
    ts: new Date().toISOString(),
    run_id: session.run_id,
    type: 'message',
    payload: { role: 'worker', text: 'mock completed work' },
  })

  if (session.cancelled) {
    return
  }

  const unresolved = Array.isArray(session.settings.unresolved)
    ? (session.settings.unresolved as string[])
    : []
  session.report = {
    schema: 'rolekit/executor-report@1',
    task_id: session.task.id,
    status: 'completed',
    summary: 'mock completed',
    changed_files: [writeRel.replace(/\\/g, '/')],
    decisions: [],
    assumptions: [],
    evidence: ['events.jsonl'],
    risks: [],
    unresolved,
    recommended_next_action: 'verify and integrate',
  }
  session.finished = true
  await writeReport(session)
}

async function writeReport(session: MockSession): Promise<void> {
  if (!session.report) {
    return
  }
  await writeJsonAtomic(join(session.ctx.runDir, 'artifacts', 'mock-report.json'), session.report)
}

function emptyReport(
  taskId: string,
  status: ExecutorReport['status'],
  summary: string,
): ExecutorReport {
  return {
    schema: 'rolekit/executor-report@1',
    task_id: taskId,
    status,
    summary,
    changed_files: [],
    decisions: [],
    assumptions: [],
    evidence: [],
    risks: [],
    unresolved: [summary],
    recommended_next_action: 'inspect',
  }
}

async function readRunId(runDirectory: string): Promise<string> {
  const state = await readJsonIfExists<{ run_id: string }>(join(runDirectory, 'run-state.json'))
  if (!state) {
    throw new Error('run-state missing for mock start')
  }
  return state.run_id
}

function pathKey(runDirectory: string): string {
  return runDirectory.replace(/\\/g, '/').toLowerCase()
}

function findByRunId(runId: string): MockSession | undefined {
  for (const session of sessions.values()) {
    if (session.run_id === runId) {
      return session
    }
  }
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      return
    }
    await sleep(20)
  }
}

/** Test helper: clear in-memory sessions. */
export function clearMockSessions(): void {
  sessions.clear()
}

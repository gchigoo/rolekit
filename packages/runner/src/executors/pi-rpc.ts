import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExecutorReport, TaskContract } from '@rolekit/core'
import type { ExecutorAdapter } from '../adapter.ts'
import {
  ExecutorIncompatibleError,
  ExecutorLostError,
  ExecutorStartError,
  ExecutorSteerRejectedError,
} from '../errors.ts'
import { appendJsonl, readJsonIfExists, writeJsonAtomic } from '../fs-util.ts'
import { createStrictJsonlReader, serializeJsonLine } from '../jsonl-framing.ts'
import { loadPiCompatRange } from '../loaders.ts'
import { captureProcessIdentity, killProcessIdentityTree } from '../process-identity.ts'
import { satisfiesRange } from '../semver-range.ts'
import type {
  AdapterCreateOptions,
  ProbeResult,
  RunContext,
  RunHandle,
  RunStatus,
} from '../types.ts'

interface PiSession {
  run_id: string
  proc: ChildProcessWithoutNullStreams
  ctx: RunContext
  task: TaskContract
  finished: boolean
  cancelled: boolean
  settled: boolean
  lastAssistantText: string
  toolCalls: Array<{ name: string; args_digest: string }>
  report: ExecutorReport | null
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  reqSeq: number
  processIdentity: import('../types.ts').ProcessIdentity
}

const sessions = new Map<string, PiSession>()

/**
 * Creates PiRpcExecutor — stdio JSONL, no readline framing.
 */
/**
 * Resolves the pi CLI binary for the current platform (Windows needs .cmd for spawn).
 */
function resolvePiBin(settings: Record<string, unknown>): string {
  if (typeof settings.pi_bin === 'string' && settings.pi_bin.length > 0) {
    return settings.pi_bin
  }
  if (process.env.ROLEKIT_PI_BIN) {
    return process.env.ROLEKIT_PI_BIN
  }
  return process.platform === 'win32' ? 'pi.cmd' : 'pi'
}

/**
 * Spawns pi. On Windows use `cmd.exe /c` so npm's pi.cmd wrapper launches (direct .cmd spawn → EINVAL).
 */
function spawnPi(
  piBin: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe'] | ['ignore', 'pipe', 'pipe']
  },
): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    const command = piBin === 'pi' ? 'pi' : piBin
    return spawn('cmd.exe', ['/d', '/s', '/c', command, ...args], {
      ...options,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  }
  return spawn(piBin, args, {
    ...options,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams
}

export function createPiRpcExecutor(options: AdapterCreateOptions): ExecutorAdapter {
  const settings = options.settings ?? {}
  const piBin = resolvePiBin(settings)

  return {
    async probe(): Promise<ProbeResult> {
      const version = await probePiVersion(piBin)
      const range = options.compatRange ?? (await loadPiCompatRange(options.projectRoot))
      if (!satisfiesRange(version, range)) {
        throw new ExecutorIncompatibleError(`pi version ${version} outside compat_range ${range}`)
      }
      return {
        adapter: 'pi-rpc',
        protocol_version: '1',
        capabilities: ['start', 'status', 'steer', 'cancel', 'collect'],
      }
    },

    async start(task: TaskContract, ctx: RunContext): Promise<RunHandle> {
      const key = pathKey(ctx.runDir)
      const existing = sessions.get(key)
      if (existing && !existing.finished) {
        return {
          run_id: existing.run_id,
          pid: existing.proc.pid,
          process_identity: existing.processIdentity,
        }
      }

      const runId = await readRunId(ctx.runDir)
      const prompt = await readFile(join(ctx.runDir, 'prompt.md'), 'utf8')
      const args = ['--mode', 'rpc', '--no-session', '--no-extensions']
      if (settings.model) {
        args.push('--model', String(settings.model))
      }
      if (settings.provider) {
        args.push('--provider', String(settings.provider))
      }
      if (settings.offline === true || process.env.ROLEKIT_PI_OFFLINE === '1') {
        args.push('--offline')
      }

      let proc: ChildProcessWithoutNullStreams
      try {
        proc = spawnPi(piBin, args, {
          cwd: ctx.worktreePath,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PI_OFFLINE: settings.offline === true ? '1' : process.env.PI_OFFLINE,
          },
        })
      } catch (error) {
        throw new ExecutorStartError(error instanceof Error ? error.message : 'failed to spawn pi')
      }

      if (!proc.pid) {
        throw new ExecutorStartError('pi spawn produced no pid')
      }

      const processIdentity = await captureProcessIdentity(proc.pid, piCommandArgv(piBin, args))
      const session: PiSession = {
        run_id: runId,
        proc,
        ctx,
        task,
        finished: false,
        cancelled: false,
        settled: false,
        lastAssistantText: '',
        toolCalls: [],
        report: null,
        pending: new Map(),
        reqSeq: 0,
        processIdentity,
      }
      sessions.set(key, session)
      attachReader(session)

      proc.on('exit', () => {
        if (!session.finished) {
          session.finished = true
          for (const [, p] of session.pending) {
            p.reject(new ExecutorLostError('pi process exited'))
          }
          session.pending.clear()
        }
      })

      try {
        await rpcRequest(session, { type: 'set_steering_mode', mode: 'one-at-a-time' }, 10_000)
      } catch (error) {
        session.finished = true
        killTree(proc)
        throw new ExecutorIncompatibleError(
          error instanceof Error ? error.message : 'pi steering mode negotiation failed',
        )
      }

      await appendJsonl(join(ctx.runDir, 'events.jsonl'), {
        schema: 'rolekit/run-event@1',
        ts: new Date().toISOString(),
        run_id: runId,
        type: 'started',
        payload: {
          task_id: task.id,
          adapter: 'pi-rpc',
          worktree: ctx.worktreePath,
        },
      })

      try {
        await rpcRequest(session, { type: 'prompt', message: prompt })
      } catch (error) {
        session.finished = true
        killTree(proc)
        throw new ExecutorStartError(error instanceof Error ? error.message : 'pi prompt failed')
      }

      void waitForSettle(session)
      return { run_id: runId, pid: proc.pid, process_identity: processIdentity }
    },

    async status(runId: string): Promise<RunStatus> {
      const session = findByRunId(runId)
      if (!session) {
        return { state: 'finished', last_event_ts: new Date().toISOString() }
      }
      if (session.proc.exitCode !== null && !session.settled) {
        throw new ExecutorLostError('pi process lost')
      }
      return {
        state: session.finished ? 'finished' : 'running',
        last_event_ts: new Date().toISOString(),
      }
    },

    async steer(runId: string, message: string, control: { requestId: string }): Promise<void> {
      const session = findByRunId(runId)
      if (!session || session.finished || session.proc.exitCode !== null) {
        throw new ExecutorLostError(`pi session missing: ${runId}`)
      }
      try {
        await rpcRequest(session, { type: 'steer', message }, 30_000, control.requestId)
      } catch (error) {
        if (error instanceof RpcRejectedError) {
          throw new ExecutorSteerRejectedError(error.message)
        }
        throw new ExecutorLostError(
          error instanceof Error ? error.message : 'pi steer transport failed',
        )
      }
    },

    async cancel(runId: string): Promise<void> {
      const session = findByRunId(runId)
      if (!session || session.finished) {
        return
      }
      session.cancelled = true
      // Exit CAS must not enqueue a second RPC behind an inflight steer. Stop the owned tree out-of-band.
      await killProcessIdentityTree(session.processIdentity)
      session.finished = true
      session.report = {
        schema: 'rolekit/executor-report@1',
        task_id: session.task.id,
        status: 'cancelled',
        summary: 'cancelled',
        changed_files: [],
        decisions: [],
        assumptions: [],
        evidence: ['events.jsonl'],
        risks: [],
        unresolved: ['cancelled'],
        recommended_next_action: 'inspect',
      }
      await writeJsonAtomic(join(session.ctx.runDir, 'artifacts', 'executor-session.json'), {
        cancelled: true,
      })
    },

    async collect(runId: string): Promise<ExecutorReport> {
      const session = findByRunId(runId)
      if (!session) {
        throw new ExecutorLostError(`pi session missing: ${runId}`)
      }
      if (!session.finished) {
        await waitForSettle(session)
      }
      if (session.report) {
        return session.report
      }
      const changed = await listChangedFiles(session.ctx.worktreePath)
      session.report = {
        schema: 'rolekit/executor-report@1',
        task_id: session.task.id,
        status: session.cancelled ? 'cancelled' : 'completed',
        summary: session.lastAssistantText.slice(0, 500) || 'pi finished',
        changed_files: changed,
        decisions: [],
        assumptions: [],
        evidence: ['events.jsonl'],
        risks: [],
        unresolved: session.cancelled ? ['cancelled'] : [],
        recommended_next_action: session.cancelled ? 'inspect' : 'verify and integrate',
      }
      session.finished = true
      return session.report
    },
  }
}

function attachReader(session: PiSession): void {
  createStrictJsonlReader(session.proc.stdout, (line) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    void handleEvent(session, msg)
  })
}

async function handleEvent(session: PiSession, msg: Record<string, unknown>): Promise<void> {
  if (msg.type === 'response') {
    const id = typeof msg.id === 'string' ? msg.id : undefined
    if (id && session.pending.has(id)) {
      const pending = session.pending.get(id)!
      session.pending.delete(id)
      if (msg.success === true) {
        pending.resolve(msg.data)
      } else {
        pending.reject(new RpcRejectedError(String(msg.error ?? 'rpc error')))
      }
    }
    return
  }

  if (msg.type === 'agent_settled' || msg.type === 'agent_end') {
    session.settled = true
  }

  if (msg.type === 'message_update') {
    const ame = msg.assistantMessageEvent as
      | { type?: string; delta?: string; content?: string }
      | undefined
    if (ame?.type === 'text_delta' && typeof ame.delta === 'string') {
      session.lastAssistantText += ame.delta
    }
    if (ame?.type === 'text_end' && typeof ame.content === 'string') {
      session.lastAssistantText = ame.content
    }
  }

  if (msg.type === 'message_end') {
    const message = msg.message as { role?: string; content?: unknown } | undefined
    if (message?.role === 'assistant') {
      const text = extractText(message.content)
      if (text) {
        session.lastAssistantText = text
        await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
          schema: 'rolekit/run-event@1',
          ts: new Date().toISOString(),
          run_id: session.run_id,
          type: 'message',
          payload: { role: 'worker', text },
        })
      }
    }
  }

  if (msg.type === 'tool_execution_start') {
    const name = String(msg.toolName ?? msg.name ?? 'tool')
    const argsDigest = String(msg.toolCallId ?? 'na')
    session.toolCalls.push({ name, args_digest: argsDigest })
    await appendJsonl(join(session.ctx.runDir, 'events.jsonl'), {
      schema: 'rolekit/run-event@1',
      ts: new Date().toISOString(),
      run_id: session.run_id,
      type: 'tool_call',
      payload: { name, args_digest: argsDigest },
    })
  }
}

async function waitForSettle(session: PiSession): Promise<void> {
  const start = Date.now()
  while (!session.settled && !session.cancelled && session.proc.exitCode === null) {
    if (Date.now() - start > 30 * 60_000) {
      break
    }
    await sleep(100)
  }
  session.finished = true
}

function rpcRequest(
  session: PiSession,
  body: Record<string, unknown>,
  timeoutMs = 60_000,
  requestId?: string,
): Promise<unknown> {
  session.reqSeq += 1
  const id = requestId ?? `req-${session.reqSeq}`
  const payload = { ...body, id }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(id)
      reject(new Error(`rpc timeout waiting for ${String(body.type)}`))
    }, timeoutMs)
    session.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    try {
      session.proc.stdin.write(serializeJsonLine(payload))
    } catch (error) {
      clearTimeout(timer)
      session.pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

async function probePiVersion(piBin: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const proc = spawnPi(piBin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    createStrictJsonlReader(
      // version is plain text, still use buffer reader without readline
      proc.stdout,
      () => undefined,
    )
    proc.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8')
    })
    proc.on('error', (error) => reject(error))
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new ExecutorIncompatibleError(`pi --version exited ${code}`))
        return
      }
      const m = out.trim().match(/(\d+\.\d+\.\d+)/)
      if (!m) {
        reject(new ExecutorIncompatibleError(`unable to parse pi version from: ${out}`))
        return
      }
      resolve(m[1]!)
    })
  })
}

async function listChangedFiles(worktreePath: string): Promise<string[]> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1'], {
      cwd: worktreePath,
      encoding: 'utf8',
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text: unknown }).text)
      }
      return ''
    })
    .join('')
}

function piCommandArgv(piBin: string, args: string[]): string[] {
  return process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', piBin === 'pi' ? 'pi' : piBin, ...args]
    : [piBin, ...args]
}

function killTree(proc: ChildProcessWithoutNullStreams): void {
  if (proc.exitCode !== null) {
    return
  }
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      proc.kill('SIGTERM')
    }
  } catch {
    // ignore
  }
}

async function readRunId(runDirectory: string): Promise<string> {
  const state = await readJsonIfExists<{ run_id: string }>(join(runDirectory, 'run-state.json'))
  if (!state) {
    throw new Error('run-state missing for pi start')
  }
  return state.run_id
}

function pathKey(runDirectory: string): string {
  return runDirectory.replace(/\\/g, '/').toLowerCase()
}

function findByRunId(runId: string): PiSession | undefined {
  for (const session of sessions.values()) {
    if (session.run_id === runId) {
      return session
    }
  }
  return undefined
}

class RpcRejectedError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

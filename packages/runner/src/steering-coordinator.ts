import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExecutorAdapter } from './adapter.ts'
import { canonicalize, sha256Text } from './canonical-json.ts'
import { ExecutorSteerRejectedError, RunManagerError } from './errors.ts'
import { appendEvent } from './events.ts'
import { readTextIfExists, writeTextAtomic } from './fs-util.ts'
import { withLock } from './lock.ts'
import { isProcessIdentityLive } from './process-identity.ts'
import { readRunState } from './run-state-store.ts'
import type { ProcessIdentity } from './types.ts'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const MAX_MESSAGE_BYTES = 16 * 1024
const RESPONSE_TIMEOUT_MS = 30_000

export type SteeringControl =
  | {
      version: 1
      request_id: string
      message: string
      message_sha256: string
      state: 'pending'
      dispatch: 'queued' | 'inflight'
      requested_at: string
    }
  | {
      version: 1
      request_id: string
      message: string
      message_sha256: string
      state: 'accepted'
      requested_at: string
      resolved_at: string
    }
  | {
      version: 1
      request_id: string
      message: string
      message_sha256: string
      state: 'failed'
      requested_at: string
      resolved_at: string
      error_code:
        | 'run_not_steerable'
        | 'executor_lost'
        | 'steer_rejected'
        | 'steer_response_timeout'
    }

export interface SteerResult {
  requestId: string
  noOp: boolean
}

export interface DispatchResult {
  dispatched: boolean
  executorLost: boolean
}

/** Owns durable steering request validation, persistence, dispatch and receipt waiting. */
export class SteeringCoordinator {
  private readonly projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  async request(
    runId: string,
    text: string,
    options: { requestId?: string } = {},
  ): Promise<SteerResult> {
    const message = canonicalSteeringMessage(text)
    const requestId = options.requestId ?? deriveSteeringRequestId(runId, message)
    validateRequestId(requestId)
    const dir = runDirectory(this.projectRoot, runId)

    const queued = await withLock(join(dir, '.lock'), async () => {
      const state = await readRunState(this.projectRoot, runId)
      if (!state) {
        throw new RunManagerError('run_not_found', runId)
      }
      const existing = await readControl(dir, requestId)
      if (existing) {
        if (existing.message !== message || existing.message_sha256 !== sha256Text(message)) {
          throw new RunManagerError('steer_request_conflict', requestId)
        }
        if (existing.state === 'accepted') {
          return { control: existing, noOp: true }
        }
        if (existing.state === 'failed') {
          throw new RunManagerError(existing.error_code, requestId)
        }
        return { control: existing, noOp: true }
      }
      if (
        state.phase !== 'active' ||
        state.transition_intent != null ||
        !supportsSteer(state.adapter) ||
        !(await supervisorIsLive(dir))
      ) {
        throw new RunManagerError('run_not_steerable', runId)
      }
      const control: SteeringControl = {
        version: 1,
        request_id: requestId,
        message,
        message_sha256: sha256Text(message),
        state: 'pending',
        dispatch: 'queued',
        requested_at: new Date().toISOString(),
      }
      await writeControl(dir, control)
      return { control, noOp: false }
    })

    const terminal = await waitForTerminalControl(
      dir,
      requestId,
      steeringWaitMs(await readRunState(this.projectRoot, runId)),
    )
    if (!terminal) {
      throw new RunManagerError('steer_wait_timeout', requestId)
    }
    if (terminal.state === 'failed') {
      throw new RunManagerError(terminal.error_code, requestId)
    }
    return { requestId, noOp: queued.noOp }
  }
}

/** RunSupervisor-only sender. Marks one queued request inflight before exactly one adapter call. */
export async function dispatchNextSteering(
  projectRoot: string,
  runId: string,
  adapter: ExecutorAdapter,
): Promise<DispatchResult> {
  const dir = runDirectory(projectRoot, runId)
  const control = await withLock(join(dir, '.lock'), async () => {
    const state = await readRunState(projectRoot, runId)
    if (state?.phase !== 'active' || state.transition_intent != null) {
      return null
    }
    const next = (await listControls(dir)).find(
      (item): item is Extract<SteeringControl, { state: 'pending' }> =>
        item.state === 'pending' && item.dispatch === 'queued',
    )
    if (!next) return null
    const inflight: SteeringControl = { ...next, dispatch: 'inflight' }
    await writeControl(dir, inflight)
    return inflight
  })
  if (!control) return { dispatched: false, executorLost: false }

  const state = await readRunState(projectRoot, runId)
  const timeoutMs = Math.max(
    1,
    Math.min(
      RESPONSE_TIMEOUT_MS,
      state?.deadline_at
        ? Math.max(0, Date.parse(state.deadline_at) - Date.now())
        : RESPONSE_TIMEOUT_MS,
    ),
  )
  let errorCode: Extract<SteeringControl, { state: 'failed' }>['error_code'] | null = null
  try {
    await withResponseTimeout(
      adapter.steer(runId, control.message, { requestId: control.request_id }),
      timeoutMs,
    )
  } catch (error) {
    errorCode =
      error instanceof ExecutorSteerRejectedError
        ? 'steer_rejected'
        : error instanceof SteeringResponseTimeoutError
          ? 'steer_response_timeout'
          : 'executor_lost'
  }

  await withLock(join(dir, '.lock'), async () => {
    const current = await readControl(dir, control.request_id)
    if (current?.state !== 'pending' || current.dispatch !== 'inflight') return
    const runState = await readRunState(projectRoot, runId)
    if (runState?.phase !== 'active') return
    const transition = runState.transition_intent
    if (
      transition &&
      (transition.state !== 'pending' || !transition.steer_request_ids.includes(control.request_id))
    ) {
      return
    }
    if (errorCode && transition?.to === 'cancelling') errorCode = 'run_not_steerable'
    const resolvedAt = new Date().toISOString()
    if (errorCode) {
      await writeControl(dir, {
        version: 1,
        request_id: current.request_id,
        message: current.message,
        message_sha256: current.message_sha256,
        state: 'failed',
        requested_at: current.requested_at,
        resolved_at: resolvedAt,
        error_code: errorCode,
      })
      return
    }
    await appendEvent(dir, {
      ts: resolvedAt,
      run_id: runId,
      type: 'message',
      payload: {
        role: 'system',
        text: `[steer:accepted] request_id=${current.request_id} message_sha256=${current.message_sha256}`,
      },
    })
    await writeControl(dir, {
      version: 1,
      request_id: current.request_id,
      message: current.message,
      message_sha256: current.message_sha256,
      state: 'accepted',
      requested_at: current.requested_at,
      resolved_at: resolvedAt,
    })
  })
  return { dispatched: true, executorLost: errorCode === 'executor_lost' }
}

/** Closes all pending controls without fabricating accepted events. */
export async function failPendingSteering(
  projectRoot: string,
  runId: string,
  errorCode: Extract<SteeringControl, { state: 'failed' }>['error_code'],
): Promise<void> {
  const dir = runDirectory(projectRoot, runId)
  await withLock(join(dir, '.lock'), async () => {
    for (const control of await listControls(dir)) {
      if (control.state !== 'pending') continue
      const acceptedAt = await acceptedSteeringEventAt(dir, control)
      if (acceptedAt) {
        await writeControl(dir, {
          version: 1,
          request_id: control.request_id,
          message: control.message,
          message_sha256: control.message_sha256,
          state: 'accepted',
          requested_at: control.requested_at,
          resolved_at: acceptedAt,
        })
        continue
      }
      await writeControl(dir, {
        version: 1,
        request_id: control.request_id,
        message: control.message,
        message_sha256: control.message_sha256,
        state: 'failed',
        requested_at: control.requested_at,
        resolved_at: new Date().toISOString(),
        error_code: errorCode,
      })
    }
  })
}

export function canonicalSteeringMessage(text: string): string {
  const message = text.trim()
  if (
    !message ||
    message.includes('\0') ||
    Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES
  ) {
    throw new RunManagerError('steer_message_invalid', 'message')
  }
  return message
}

export function deriveSteeringRequestId(runId: string, canonicalMessage: string): string {
  return `steer-${sha256Text(`${runId}\0${canonicalMessage}`).slice(0, 24)}`
}

export function validateRequestId(requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new RunManagerError('steer_request_conflict', requestId)
  }
}

export async function readSteeringControl(
  projectRoot: string,
  runId: string,
  requestId: string,
): Promise<SteeringControl | null> {
  validateRequestId(requestId)
  return readControl(runDirectory(projectRoot, runId), requestId)
}

/** Internal barrier seam; caller must hold the per-run lock when mutating returned controls. */
export async function listSteeringControlsAt(dir: string): Promise<SteeringControl[]> {
  return listControls(dir)
}

/** Internal barrier seam; caller must hold the per-run lock. */
export async function writeSteeringControlAt(dir: string, control: SteeringControl): Promise<void> {
  await writeControl(dir, control)
}

/** Finds the unique durable accepted event that can repair event→control crash residue. */
export async function acceptedSteeringEventAt(
  dir: string,
  control: Extract<SteeringControl, { state: 'pending' }>,
): Promise<string | null> {
  const text = await readTextIfExists(join(dir, 'events.jsonl'))
  if (!text) return null
  const marker = `[steer:accepted] request_id=${control.request_id} message_sha256=${control.message_sha256}`
  const matches: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as {
        ts?: unknown
        type?: unknown
        payload?: { role?: unknown; text?: unknown }
      }
      if (
        event.type === 'message' &&
        event.payload?.role === 'system' &&
        event.payload.text === marker &&
        typeof event.ts === 'string'
      ) {
        matches.push(event.ts)
      }
    } catch {
      // malformed events are handled by run integrity/finalization
    }
  }
  if (matches.length > 1) {
    throw new RunManagerError(
      'run_state_inconsistent',
      `duplicate accepted event ${control.request_id}`,
    )
  }
  return matches[0] ?? null
}

async function listControls(dir: string): Promise<SteeringControl[]> {
  const controlDir = join(dir, 'control', 'steer')
  let names: string[]
  try {
    names = await readdir(controlDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const controls: SteeringControl[] = []
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const requestId = name.slice(0, -5)
    validateRequestId(requestId)
    const control = await readControl(dir, requestId)
    if (control) controls.push(control)
  }
  return controls
}

async function readControl(dir: string, requestId: string): Promise<SteeringControl | null> {
  const text = await readTextIfExists(controlPath(dir, requestId))
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new RunManagerError('run_state_inconsistent', `invalid steering control ${requestId}`)
  }
  if (!isSteeringControl(value) || canonicalize(value) !== text) {
    throw new RunManagerError('run_state_inconsistent', `invalid steering control ${requestId}`)
  }
  return value
}

async function writeControl(dir: string, control: SteeringControl): Promise<void> {
  await writeTextAtomic(controlPath(dir, control.request_id), canonicalize(control))
}

function controlPath(dir: string, requestId: string): string {
  validateRequestId(requestId)
  return join(dir, 'control', 'steer', `${requestId}.json`)
}

function isSteeringControl(value: unknown): value is SteeringControl {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const common = ['message', 'message_sha256', 'request_id', 'requested_at', 'state', 'version']
  if (
    item.version !== 1 ||
    typeof item.request_id !== 'string' ||
    !REQUEST_ID_PATTERN.test(item.request_id) ||
    typeof item.message !== 'string' ||
    item.message !== item.message.trim() ||
    typeof item.message_sha256 !== 'string' ||
    item.message_sha256 !== sha256Text(item.message) ||
    typeof item.requested_at !== 'string' ||
    !validTimestamp(item.requested_at)
  )
    return false
  if (item.state === 'pending') {
    return (
      exactKeys(item, [...common, 'dispatch']) &&
      (item.dispatch === 'queued' || item.dispatch === 'inflight')
    )
  }
  if (item.state === 'accepted') {
    return exactKeys(item, [...common, 'resolved_at']) && validTimestamp(item.resolved_at)
  }
  if (item.state === 'failed') {
    return (
      exactKeys(item, [...common, 'error_code', 'resolved_at']) &&
      validTimestamp(item.resolved_at) &&
      ['run_not_steerable', 'executor_lost', 'steer_rejected', 'steer_response_timeout'].includes(
        String(item.error_code),
      )
    )
  }
  return false
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, i) => key === expected.sort()[i])
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function runDirectory(projectRoot: string, runId: string): string {
  return join(projectRoot, '.rolekit', 'runs', runId)
}

function supportsSteer(adapter: string): boolean {
  return adapter === 'pi-rpc' || adapter === 'mock'
}

async function supervisorIsLive(dir: string): Promise<boolean> {
  const text = await readTextIfExists(join(dir, 'artifacts', 'supervisor.json'))
  if (!text) return false
  try {
    const identity = JSON.parse(text) as Partial<ProcessIdentity>
    if (typeof identity.pid !== 'number') return false
    if (identity.start_time_utc && identity.command_sha256) {
      return isProcessIdentityLive(identity as ProcessIdentity)
    }
    process.kill(identity.pid, 0)
    return true
  } catch {
    return false
  }
}

function steeringWaitMs(state: Awaited<ReturnType<typeof readRunState>>): number {
  if (!state?.deadline_at) return RESPONSE_TIMEOUT_MS
  return Math.max(0, Math.min(RESPONSE_TIMEOUT_MS, Date.parse(state.deadline_at) - Date.now()))
}

async function waitForTerminalControl(
  dir: string,
  requestId: string,
  timeoutMs: number,
): Promise<Exclude<SteeringControl, { state: 'pending' }> | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const control = await readControl(dir, requestId)
    if (control?.state === 'accepted' || control?.state === 'failed') return control
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return null
}

class SteeringResponseTimeoutError extends Error {}

async function withResponseTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SteeringResponseTimeoutError('steer response timeout')), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

import { join } from 'node:path'
import { RunManagerError } from './errors.ts'
import { readJsonIfExists, readTextIfExists, runDir, writeJsonAtomic } from './fs-util.ts'
import { withLock } from './lock.ts'
import type { ExitTransitionIntent, ManagedRunStatus, RunPhase, RunState } from './types.ts'

/**
 * Maps RunPhase to public RunStatus.state.
 */
export function phaseToState(phase: RunPhase): ManagedRunStatus['state'] {
  if (phase === 'gate-pending') {
    return 'awaiting-gate'
  }
  if (phase === 'terminal') {
    return 'finished'
  }
  return 'running'
}

/**
 * Validates run-state invariants before write.
 */
export function assertRunStateValid(state: RunState): void {
  assertTransitionIntent(state)
  if (state.phase === 'active' && state.termination_intent) {
    throw new RunManagerError('run_state_inconsistent', 'active cannot project termination_intent')
  }
  if (state.phase === 'cancelling' && !state.termination_intent) {
    throw new RunManagerError('run_state_inconsistent', 'cancelling requires termination_intent')
  }
  if (state.phase === 'terminal' && !state.terminal_status) {
    throw new RunManagerError('run_state_inconsistent', 'terminal requires terminal_status')
  }
  if (state.phase !== 'terminal' && state.terminal_status) {
    throw new RunManagerError('run_state_inconsistent', 'terminal_status only allowed in terminal')
  }
  const needsDeadline: RunPhase[] = [
    'starting',
    'active',
    'finalizing',
    'cancelling',
    'gate-pending',
    'resuming',
    'terminal',
  ]
  if (needsDeadline.includes(state.phase) && (!state.started_at || !state.deadline_at)) {
    throw new RunManagerError(
      'run_state_inconsistent',
      'started_at/deadline_at required from starting',
    )
  }
  state.state = phaseToState(state.phase)
}

function assertTransitionIntent(state: RunState): void {
  const intent = state.transition_intent
  if (!intent) return
  const fail = (message: string): never => {
    throw new RunManagerError('run_state_inconsistent', message)
  }
  if (
    !exactKeys(intent as unknown as Record<string, unknown>, [
      'barrier_id',
      'cancel_intent',
      'committed_at',
      'from',
      'requested_at',
      'resolutions_sha256',
      'state',
      'steer_request_ids',
      'target_commit_sha256',
      'to',
    ]) ||
    !/^exit-[0-9a-f]{24}$/.test(intent.barrier_id) ||
    intent.from !== 'active' ||
    (intent.to !== 'finalizing' && intent.to !== 'cancelling') ||
    !['pending', 'ready', 'committed'].includes(intent.state)
  ) {
    fail('invalid exit barrier identity')
  }
  if (!validTimestamp(intent.requested_at)) fail('invalid exit barrier requested_at')
  if (!Array.isArray(intent.steer_request_ids)) fail('invalid exit barrier steering ids')
  const sortedIds = [...intent.steer_request_ids].sort()
  if (
    new Set(intent.steer_request_ids).size !== intent.steer_request_ids.length ||
    intent.steer_request_ids.some((id) => !/^[A-Za-z0-9._-]{1,64}$/.test(id)) ||
    sortedIds.some((id, index) => id !== intent.steer_request_ids[index])
  ) {
    fail('exit barrier steering ids must be unique and sorted')
  }
  if (intent.to === 'finalizing' && intent.cancel_intent !== null) {
    fail('finalizing barrier cannot carry cancel intent')
  }
  if (intent.to === 'cancelling' && !validCancelIntent(intent.cancel_intent)) {
    fail('cancelling barrier requires a valid cancel intent')
  }
  if (intent.state === 'pending') {
    if (
      state.phase !== 'active' ||
      intent.resolutions_sha256 !== null ||
      intent.target_commit_sha256 !== null ||
      intent.committed_at !== null
    ) {
      fail('invalid pending exit barrier')
    }
    return
  }
  if (!isSha(intent.resolutions_sha256)) fail('invalid exit barrier resolution digest')
  if (intent.to === 'finalizing') {
    if (!isSha(intent.target_commit_sha256)) fail('finalizing barrier requires report digest')
  } else if (intent.target_commit_sha256 !== null) {
    fail('cancelling barrier cannot carry report digest')
  }
  if (intent.state === 'ready') {
    if (state.phase !== 'active' || intent.committed_at !== null) {
      fail('invalid ready exit barrier')
    }
    return
  }
  if (
    intent.state !== 'committed' ||
    state.phase !== intent.to ||
    !validTimestamp(intent.committed_at)
  ) {
    fail('invalid committed exit barrier')
  }
  if (intent.to === 'cancelling') {
    const projected = state.termination_intent
    const cancel = intent.cancel_intent
    if (
      !projected ||
      !cancel ||
      projected.status !== cancel.status ||
      projected.reason !== cancel.reason
    ) {
      fail('termination projection does not match exit barrier')
    }
  }
}

function validCancelIntent(value: ExitTransitionIntent['cancel_intent']): boolean {
  return Boolean(
    value &&
      exactKeys(value as unknown as Record<string, unknown>, [
        'reason',
        'requested_at',
        'status',
      ]) &&
      validTimestamp(value.requested_at) &&
      ((value.status === 'cancelled' && value.reason === 'user-cancel') ||
        (value.status === 'failed' && value.reason === 'timeout')),
  )
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index])
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

/**
 * Reads run-state.json.
 */
export async function readRunState(projectRoot: string, runId: string): Promise<RunState | null> {
  return readJsonIfExists<RunState>(join(runDir(projectRoot, runId), 'run-state.json'))
}

/**
 * Writes run-state into an absolute run directory (caller holds lock).
 */
export async function writeRunStateUnlockedAt(
  runDirectory: string,
  state: RunState,
): Promise<void> {
  assertRunStateValid(state)
  state.updated_at = new Date().toISOString()
  state.state = phaseToState(state.phase)
  await writeJsonAtomic(join(runDirectory, 'run-state.json'), state)
}

/**
 * Atomically replaces run-state under per-run lock.
 */
export async function writeRunState(projectRoot: string, state: RunState): Promise<void> {
  const dir = runDir(projectRoot, state.run_id)
  await withLock(join(dir, '.lock'), async () => {
    await writeRunStateUnlockedAt(dir, state)
  })
}

/**
 * CAS update helper under lock.
 */
export async function updateRunState(
  projectRoot: string,
  runId: string,
  mutator: (current: RunState) => RunState | Promise<RunState>,
): Promise<RunState> {
  const dir = runDir(projectRoot, runId)
  return withLock(join(dir, '.lock'), async () => {
    const current = await readJsonIfExists<RunState>(join(dir, 'run-state.json'))
    if (!current) {
      throw new RunManagerError('run_not_found', `run not found: ${runId}`)
    }
    const next = await mutator(current)
    assertRunStateValid(next)
    next.updated_at = new Date().toISOString()
    next.state = phaseToState(next.phase)
    await writeJsonAtomic(join(dir, 'run-state.json'), next)
    return next
  })
}

/**
 * Derives last_event_ts from events.jsonl (null if empty).
 */
export async function lastEventTs(projectRoot: string, runId: string): Promise<string | null> {
  const text = await readTextIfExists(join(runDir(projectRoot, runId), 'events.jsonl'))
  if (!text || text.trim().length === 0) {
    return null
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const last = lines[lines.length - 1]
  if (!last) {
    return null
  }
  try {
    const evt = JSON.parse(last) as { ts?: string }
    return evt.ts ?? null
  } catch {
    return null
  }
}

/**
 * Projects ManagedRunStatus.
 */
export async function projectStatus(projectRoot: string, runId: string): Promise<ManagedRunStatus> {
  const state = await readRunState(projectRoot, runId)
  if (!state) {
    throw new RunManagerError('run_not_found', `run not found: ${runId}`)
  }
  return {
    id: runId,
    state: phaseToState(state.phase),
    phase: state.phase,
    last_event_ts: await lastEventTs(projectRoot, runId),
    terminal_status: state.terminal_status,
    reason: state.reason ?? undefined,
  }
}

import type { ResultEnvelope } from '../schemas/result-envelope.ts'
import type { GateAction } from '../schemas/shared.ts'
import type { WorkItem } from '../schemas/work-item.ts'
import { InvalidTransition } from './errors.ts'

export type WorkItemStatus = WorkItem['status']
export type GateOrigin = NonNullable<WorkItem['gate']>['origin']

/** Context for pure status transitions. */
export interface TransitionContext {
  deps?: Array<{ id: string; status: WorkItemStatus }>
  gate?: { trigger: string; origin: GateOrigin }
  now?: string
}

/** Result of adopting a finished run envelope. */
export interface AdoptResult {
  item: WorkItem
  no_op: boolean
  code?: 'run_failed' | 'run_cancelled' | 'run_question' | 'run_blocked' | 'run_completed'
}

export type ResumeTarget = 'planned' | 'designing' | 'executing'

/** Minimal run info for D4 auto-bridge checks. */
export interface RunBridgeInfo {
  run_id: string
  state: 'running' | 'awaiting-gate' | 'finished'
  status?: ResultEnvelope['status']
}

const STATUSES: WorkItemStatus[] = [
  'planned',
  'designing',
  'awaiting-gate',
  'executing',
  'verifying',
  'done',
  'dropped',
  'blocked',
]

/** Legal edges from roadmap 4.9 (excluding awaiting-gate restore specials). */
const LEGAL: Record<WorkItemStatus, ReadonlySet<WorkItemStatus>> = {
  planned: new Set(['designing', 'executing', 'dropped']),
  designing: new Set(['awaiting-gate', 'executing', 'blocked', 'dropped']),
  executing: new Set(['awaiting-gate', 'verifying', 'blocked']),
  verifying: new Set(['awaiting-gate', 'done', 'executing', 'blocked']),
  'awaiting-gate': new Set(['designing', 'executing', 'verifying', 'done', 'blocked', 'dropped']),
  blocked: new Set(['planned', 'designing', 'executing', 'dropped']),
  done: new Set(),
  dropped: new Set(),
}

/**
 * Pure status transition per 4.9 table + goal invariant + gate field rules.
 */
export function transition(
  item: WorkItem,
  to: WorkItemStatus,
  ctx: TransitionContext = {},
): WorkItem {
  const from = item.status
  if (from === to) {
    throw new InvalidTransition(`self-loop forbidden: ${from}`)
  }
  if (from === 'awaiting-gate') {
    if (!isAwaitingRestore(item, to)) {
      throw new InvalidTransition(`${from} -> ${to}`)
    }
  } else if (!LEGAL[from].has(to)) {
    throw new InvalidTransition(`${from} -> ${to}`)
  }

  const now = ctx.now ?? new Date().toISOString()
  let next: WorkItem = { ...item, status: to, updated: now }

  if (to === 'awaiting-gate') {
    if (!ctx.gate) {
      throw new InvalidTransition('awaiting-gate requires gate context')
    }
    if (ctx.gate.origin !== from) {
      throw new InvalidTransition(
        `gate origin ${ctx.gate.origin} must match current status ${from}`,
      )
    }
    next = { ...next, gate: { trigger: ctx.gate.trigger, origin: ctx.gate.origin } }
  } else if (from === 'awaiting-gate') {
    // restore / reject / drop clears gate
    next = { ...next, gate: null }
  } else {
    next = { ...next, gate: null }
  }

  if (to === 'done') {
    assertGoalDoneInvariant(next, ctx.deps ?? [])
  }

  assertGateInvariant(next)
  return next
}

/**
 * First start: planned/designing → executing + append run.
 * Retry: stay executing, append run; never invent executing→executing via transition().
 */
export function attachRun(
  item: WorkItem,
  runId: string,
  mode: 'first' | 'retry',
  now = new Date().toISOString(),
): WorkItem {
  if (item.runs.includes(runId)) {
    return { ...item }
  }
  if (mode === 'first') {
    if (item.status === 'executing' && item.runs.length === 0) {
      return { ...item, runs: [runId], updated: now, gate: null }
    }
    if (item.status !== 'planned' && item.status !== 'designing') {
      throw new InvalidTransition(`attachRun first from ${item.status}`)
    }
    const base = transition(item, 'executing', { now })
    return { ...base, runs: [...base.runs, runId], updated: now, gate: null }
  }
  // retry: must already be executing; no self-loop transition
  if (item.status !== 'executing') {
    throw new InvalidTransition(`attachRun retry from ${item.status}`)
  }
  return { ...item, runs: [...item.runs, runId], updated: now, gate: null }
}

/**
 * Adopt finished ResultEnvelope for the latest linked run (D13).
 * Idempotent for successor states of the same run.
 */
export function adoptRunResult(
  item: WorkItem,
  runId: string,
  envelope: ResultEnvelope,
  now = new Date().toISOString(),
): AdoptResult {
  const latest = item.runs[item.runs.length - 1]
  if (latest !== runId) {
    throw new InvalidTransition(`adopt run ${runId} is not latest (${latest ?? 'none'})`)
  }

  if (envelope.status === 'completed') {
    if (item.status === 'verifying' || item.status === 'awaiting-gate' || item.status === 'done') {
      return { item, no_op: true, code: 'run_completed' }
    }
    if (item.status === 'blocked') {
      return { item, no_op: true, code: 'run_completed' }
    }
    if (item.status !== 'executing') {
      throw new InvalidTransition(`adopt completed from ${item.status}`)
    }
    return {
      item: transition(item, 'verifying', { now }),
      no_op: false,
      code: 'run_completed',
    }
  }

  if (envelope.status === 'blocked') {
    if (item.status === 'blocked') {
      return { item, no_op: true, code: 'run_blocked' }
    }
    if (item.status !== 'executing') {
      throw new InvalidTransition(`adopt blocked from ${item.status}`)
    }
    return {
      item: transition(item, 'blocked', { now }),
      no_op: false,
      code: 'run_blocked',
    }
  }

  // failed | cancelled | question → remain executing
  if (item.status === 'executing') {
    const code =
      envelope.status === 'cancelled'
        ? 'run_cancelled'
        : envelope.status === 'question'
          ? 'run_question'
          : 'run_failed'
    return { item: { ...item, updated: now }, no_op: false, code }
  }
  if (item.status === 'verifying' || item.status === 'awaiting-gate' || item.status === 'done') {
    // successor after completed; do not roll back
    return { item, no_op: true }
  }
  throw new InvalidTransition(`adopt ${envelope.status} from ${item.status}`)
}

/**
 * Atomically dispatch an adopted question through the ambiguous-requirement policy action.
 */
export function applyQuestionGateAction(
  item: WorkItem,
  runId: string,
  action: GateAction,
  now = new Date().toISOString(),
): AdoptResult {
  const latest = item.runs[item.runs.length - 1]
  if (latest !== runId) {
    throw new InvalidTransition(`adopt run ${runId} is not latest (${latest ?? 'none'})`)
  }
  const prior = [...item.gate_log]
    .reverse()
    .find((entry) => entry.trigger === 'ambiguous-requirement')
  const priorIsCurrent = prior?.ts === item.updated
  if (
    (item.status === 'awaiting-gate' && item.gate?.trigger === 'ambiguous-requirement') ||
    (item.status === 'blocked' &&
      priorIsCurrent &&
      (prior?.action === 'block' || prior?.action === 'confirm')) ||
    (item.status === 'executing' && priorIsCurrent && prior?.action === 'confirm')
  ) {
    return { item, no_op: true, code: 'run_question' }
  }
  if (item.status !== 'executing') {
    throw new InvalidTransition(`adopt question from ${item.status}`)
  }
  if (action === 'ignore') {
    return { item, no_op: true, code: 'run_question' }
  }
  if (action === 'observe') {
    if (priorIsCurrent && prior?.action === 'observe' && prior.decision === 'auto-pass') {
      return { item, no_op: true, code: 'run_question' }
    }
    return {
      item: appendLog(item, 'ambiguous-requirement', 'observe', 'auto-pass', now),
      no_op: false,
      code: 'run_question',
    }
  }
  if (action === 'confirm') {
    return {
      item: transition(item, 'awaiting-gate', {
        now,
        gate: { trigger: 'ambiguous-requirement', origin: 'executing' },
      }),
      no_op: false,
      code: 'run_question',
    }
  }
  return {
    item: appendLog(
      transition(item, 'blocked', { now }),
      'ambiguous-requirement',
      'block',
      'blocked',
      now,
    ),
    no_op: false,
    code: 'run_question',
  }
}

/** Drop a live WorkItem; rejecting a pending gate is recorded with its original trigger. */
export function dropWorkItem(item: WorkItem, now = new Date().toISOString()): WorkItem {
  const trigger = item.gate?.trigger
  const dropped = transition(item, 'dropped', { now })
  return trigger ? appendLog(dropped, trigger, 'confirm', 'rejected', now) : dropped
}

/** Resume a blocked/verifying WorkItem and append the recovery-cycle audit marker. */
export function resumeWorkItem(
  item: WorkItem,
  to: ResumeTarget,
  now = new Date().toISOString(),
): WorkItem {
  if (item.status === 'verifying' && to !== 'executing') {
    throw new InvalidTransition(`verifying -> ${to}`)
  }
  if (item.status !== 'blocked' && item.status !== 'verifying') {
    throw new InvalidTransition(`resume from ${item.status}`)
  }
  const resumed = transition(item, to, { now })
  return appendLog(resumed, 'recovery-cycle', 'observe', 'auto-pass', now, item.runs.length)
}

/** Latest recovery marker count, or undefined when no recovery has been requested. */
export function latestRecoveryRunsCount(item: WorkItem): number | undefined {
  for (let index = item.gate_log.length - 1; index >= 0; index -= 1) {
    const entry = item.gate_log[index]
    if (entry?.trigger === 'recovery-cycle') return entry.recovery_runs_count
  }
  return undefined
}

/**
 * Apply design-artifact / final-acceptance PolicyEngine overall action.
 */
export function applyProcessGateAction(
  item: WorkItem,
  trigger: 'design-artifact' | 'final-acceptance',
  action: GateAction,
  now = new Date().toISOString(),
  deps: TransitionContext['deps'] = [],
): WorkItem {
  if (trigger === 'design-artifact') {
    if (item.status !== 'designing') {
      throw new InvalidTransition(`design-artifact from ${item.status}`)
    }
    if (hasResolvedDesignArtifact(item)) {
      return item
    }
    if (action === 'ignore') {
      return { ...item, gate: null, updated: now }
    }
    if (action === 'observe') {
      return appendLog({ ...item, gate: null, updated: now }, trigger, 'observe', 'auto-pass', now)
    }
    if (action === 'confirm') {
      return transition(item, 'awaiting-gate', {
        now,
        gate: { trigger, origin: 'designing' },
      })
    }
    return appendLog(transition(item, 'blocked', { now }), trigger, 'block', 'blocked', now)
  }

  // final-acceptance from verifying
  if (item.status !== 'verifying') {
    throw new InvalidTransition(`final-acceptance from ${item.status}`)
  }
  if (action === 'ignore') {
    return transition(item, 'done', { now, deps })
  }
  if (action === 'observe') {
    return appendLog(transition(item, 'done', { now, deps }), trigger, 'observe', 'auto-pass', now)
  }
  if (action === 'confirm') {
    return transition(item, 'awaiting-gate', {
      now,
      gate: { trigger, origin: 'verifying' },
    })
  }
  return appendLog(transition(item, 'blocked', { now }), trigger, 'block', 'blocked', now)
}

/**
 * Approve pending WorkItem gate (restore origin; final-acceptance → done).
 */
export function approveWorkItemGate(
  item: WorkItem,
  now = new Date().toISOString(),
  deps: TransitionContext['deps'] = [],
): WorkItem {
  if (item.status !== 'awaiting-gate' || !item.gate) {
    throw new InvalidTransition('approve requires awaiting-gate')
  }
  const { trigger, origin } = item.gate
  const target: WorkItemStatus =
    trigger === 'final-acceptance' && origin === 'verifying' ? 'done' : origin
  const restored = transition(item, target, { now, deps })
  return appendLog(restored, trigger, 'confirm', 'approved', now)
}

/**
 * Reject pending WorkItem gate → blocked.
 */
export function rejectWorkItemGate(item: WorkItem, now = new Date().toISOString()): WorkItem {
  if (item.status !== 'awaiting-gate' || !item.gate) {
    throw new InvalidTransition('reject requires awaiting-gate')
  }
  const { trigger } = item.gate
  const blocked = transition(item, 'blocked', { now })
  return appendLog(blocked, trigger, 'confirm', 'rejected', now)
}

/**
 * D4 auto-bridge: executing → verifying when run evidence allows.
 */
export function autoBridgeToVerifying(
  item: WorkItem,
  runs: RunBridgeInfo[],
  now = new Date().toISOString(),
): WorkItem {
  if (item.status !== 'executing') {
    throw new InvalidTransition(`auto-bridge from ${item.status}`)
  }
  const lane = item.lane
  if (lane === 'direct') {
    if (item.runs.length !== 0) {
      throw new InvalidTransition('runs_incomplete: direct requires empty runs')
    }
    return transition(item, 'verifying', { now })
  }
  if (lane !== 'delegated' && lane !== 'coordinated') {
    throw new InvalidTransition('runs_incomplete: missing lane')
  }
  if (item.runs.length === 0 || runs.length === 0) {
    throw new InvalidTransition('runs_incomplete: empty runs')
  }
  for (const r of runs) {
    if (r.state === 'running' || r.state === 'awaiting-gate') {
      throw new InvalidTransition(`runs_incomplete: ${r.run_id} ${r.state}`)
    }
  }
  const latestId = item.runs[item.runs.length - 1]
  if (!latestId) {
    throw new InvalidTransition('runs_incomplete: empty runs')
  }
  const latest = runs.find((r) => r.run_id === latestId)
  if (latest?.status !== 'completed') {
    throw new InvalidTransition(`runs_incomplete: latest ${latestId} not completed`)
  }
  return transition(item, 'verifying', { now })
}

/**
 * True when design-artifact already approved or auto-passed (D5 one-shot).
 */
export function hasResolvedDesignArtifact(item: WorkItem): boolean {
  return item.gate_log.some(
    (e) =>
      e.trigger === 'design-artifact' && (e.decision === 'approved' || e.decision === 'auto-pass'),
  )
}

/**
 * Exhaustive legal-edge helper for tests.
 */
export function isLegalTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  if (from === to) return false
  return LEGAL[from].has(to)
}

/**
 * All WorkItem statuses (closed set).
 */
export function allStatuses(): WorkItemStatus[] {
  return [...STATUSES]
}

function isAwaitingRestore(item: WorkItem, to: WorkItemStatus): boolean {
  if (!item.gate) return false
  if (to === 'blocked' || to === 'dropped') return true
  if (
    item.gate.trigger === 'final-acceptance' &&
    item.gate.origin === 'verifying' &&
    to === 'done'
  ) {
    return true
  }
  return to === item.gate.origin
}

function assertGoalDoneInvariant(
  item: WorkItem,
  deps: Array<{ id: string; status: WorkItemStatus }>,
): void {
  if (item.kind !== 'goal') return
  const byId = new Map(deps.map((d) => [d.id, d.status]))
  for (const depId of item.depends_on) {
    const status = byId.get(depId)
    if (!status) {
      throw new InvalidTransition(`goal dependency missing: ${depId}`)
    }
    if (status !== 'done' && status !== 'dropped') {
      throw new InvalidTransition(`goal dependency not done: ${depId}`)
    }
  }
}

function assertGateInvariant(item: WorkItem): void {
  const awaiting = item.status === 'awaiting-gate'
  const hasGate = item.gate !== null
  if (awaiting !== hasGate) {
    throw new InvalidTransition('gate invariant violated')
  }
}

function appendLog(
  item: WorkItem,
  trigger: string,
  action: GateAction,
  decision: 'auto-pass' | 'approved' | 'rejected' | 'blocked',
  now: string,
  recoveryRunsCount?: number,
): WorkItem {
  return {
    ...item,
    gate_log: [
      ...item.gate_log,
      {
        trigger,
        action,
        decision,
        ts: now,
        ...(recoveryRunsCount !== undefined ? { recovery_runs_count: recoveryRunsCount } : {}),
      },
    ],
    updated: now,
  }
}

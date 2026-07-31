import type {
  ExecutorProfile,
  ExecutorReport,
  GatePolicy,
  ResultEnvelope,
  RoleProfile,
  RunEvent,
  TaskContract,
} from '@rolekit/core'

/** Adapter factory create options. */
export interface AdapterCreateOptions {
  projectRoot: string
  compatRange?: string
  settings?: Record<string, unknown>
}

/** Probe result from ExecutorAdapter.probe. */
export interface ProbeResult {
  adapter: string
  protocol_version: string
  capabilities: Array<'start' | 'status' | 'steer' | 'cancel' | 'collect'>
}

export interface ProcessIdentity {
  pid: number
  start_time_utc: string
  command_sha256: string
}

export interface RunHandle {
  run_id: string
  pid?: number
  process_identity?: ProcessIdentity
}

export interface RunStatus {
  state: 'running' | 'awaiting-gate' | 'finished'
  last_event_ts: string
}

export interface RunContext {
  worktreePath: string
  runDir: string
  attempt: number
  profile: RoleProfile
  policy: GatePolicy
  supervisorOwnsTerminal?: boolean
}

export type RunPhase =
  | 'preparing'
  | 'prepared'
  | 'starting'
  | 'active'
  | 'finalizing'
  | 'cancelling'
  | 'gate-pending'
  | 'resuming'
  | 'terminal'

export interface ManagedRunStatus {
  id: string
  state: 'running' | 'awaiting-gate' | 'finished'
  phase: RunPhase
  last_event_ts: string | null
  terminal_status?: ResultEnvelope['status']
  reason?: string | null
}

export interface BarrierResolution {
  request_id: string
  state: 'accepted' | 'failed'
  error_code: string | null
  message_sha256: string
}

export interface ExitTransitionIntent {
  barrier_id: string
  from: 'active'
  to: 'finalizing' | 'cancelling'
  state: 'pending' | 'ready' | 'committed'
  requested_at: string
  steer_request_ids: string[]
  resolutions_sha256: string | null
  target_commit_sha256: string | null
  cancel_intent: null | {
    status: 'cancelled' | 'failed'
    reason: 'user-cancel' | 'timeout'
    requested_at: string
  }
  committed_at: string | null
}

export interface RunState {
  run_id: string
  task_id: string
  attempt: number
  adapter: string
  verifier_mode: 'minimal' | 'enhanced'
  worktree_path: string
  state: 'running' | 'awaiting-gate' | 'finished'
  phase: RunPhase
  started_at?: string
  deadline_at?: string
  transition_intent?: ExitTransitionIntent | null
  termination_intent?: {
    status: 'cancelled' | 'failed'
    reason: string
  }
  terminal_status?: ResultEnvelope['status']
  reason?: string | null
  updated_at: string
}

export interface ReservationRecord {
  task_id: string
  attempt: number
  run_id: string
  input_digest: string
  created_by: 'initial' | 'retry'
  predecessor_run_id?: string
  abort_requested: boolean
}

export interface ResolvedFragment {
  path: string
  content_sha256: string
  content: string
}

export interface ProfileBundle {
  profile: RoleProfile
  resolved_fragments: ResolvedFragment[]
}

export interface DetectSnapshot {
  dependency_files: string[]
  migration_paths: string[]
  api_paths: string[]
}

/** Immutable knowledge rules snapshot for prepare/digest/prompt. */
export interface KnowledgeSnapshot {
  version: 1
  rules: Array<{
    id: string
    title: string
    body: string
    content_sha256: string
  }>
  collected_at: string
}

export interface PrepareRunInput {
  task: TaskContract
  profile_bundle: ProfileBundle
  executor_profile: ExecutorProfile
  policy: GatePolicy
  detect_snapshot: DetectSnapshot | null
  verifier_mode: 'minimal' | 'enhanced'
  adapter: string
  projectRoot: string
  retry: boolean
  knowledgeSnapshot: KnowledgeSnapshot
}

export interface VerificationReport {
  passed: boolean
  results: Array<{ command: string; exit_code: number }>
  scope_violations: string[]
}

export interface BaselineEntry {
  code: string
  path: string
  digest?: string
  mode?: string
}

export interface BaselineSnapshot {
  head: string
  status: BaselineEntry[]
  captured_at: string
  warning?: string
}

export interface ExecutorControl {
  token: string
  intent: 'start'
  started?: {
    pid: number
    session?: string
    at: string
    start_time_utc?: string
    command_sha256?: string
  }
}

export type { ExecutorReport, GatePolicy, ResultEnvelope, RoleProfile, RunEvent, TaskContract }

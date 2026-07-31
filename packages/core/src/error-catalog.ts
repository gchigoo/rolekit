/** Stable CLI treatment for a RoleKit error code. */
export interface ErrorCatalogEntry {
  readonly exit: 1 | 2
  readonly retryable: boolean
  /** Whether a caller may expose the error message as public detail. */
  readonly publicDetail: 'none' | 'safe'
}

const business = (retryable = false, publicDetail: ErrorCatalogEntry['publicDetail'] = 'safe') =>
  ({ exit: 1, retryable, publicDetail }) as const
const usage = (publicDetail: ErrorCatalogEntry['publicDetail'] = 'safe') =>
  ({ exit: 2, retryable: false, publicDetail }) as const

/**
 * Single public error catalogue. Codes are never inferred from messages.
 * Provider/process failures deliberately suppress detail.
 */
export const ErrorCatalog = Object.freeze({
  validation_error: usage(),
  usage_error: usage(),
  invalid_usage: usage(),
  parse_error: usage(),
  task_invalid: usage(),
  policy_invalid: usage(),
  detect_policy_invalid: usage(),
  profile_not_found: usage(),
  executor_profile_not_found: usage(),
  project_not_found: usage(),
  invalid_lane_override: usage(),
  steer_message_invalid: usage(),

  internal_error: business(false, 'none'),
  executor_incompatible: business(false, 'none'),
  executor_start_failed: business(true, 'none'),
  executor_lost: business(true, 'none'),
  executor_timeout: business(true, 'none'),
  steer_rejected: business(false, 'none'),
  unsupported_operation: business(),
  unknown_adapter: business(),
  missing_api_key: business(),
  missing_chatgpt_auth: business(),
  run_not_found: business(),
  run_not_started: business(),
  run_not_settled: business(true),
  run_not_verifiable: business(),
  run_not_cancellable: business(),
  run_not_steerable: business(),
  run_awaiting_gate: business(),
  run_state_inconsistent: business(false, 'none'),
  invalid_transition: business(),
  prepared_abort_failed: business(true),
  supervisor_start_failed: business(true, 'none'),
  retry_not_allowed: business(),
  integration_failed: business(true, 'none'),
  gate_decision_conflict: business(),
  no_pending_gate: business(),
  lock_held: business(true),
  knowledge_invalid: business(),
  knowledge_io_failed: business(true, 'none'),
  knowledge_exists: business(),
  knowledge_not_found: business(),
  knowledge_id_mismatch: business(),
  knowledge_input_read_failed: business(true, 'none'),

  steer_request_conflict: business(),
  steer_wait_timeout: business(true, 'none'),
  steer_response_timeout: business(true, 'none'),
  workitem_not_found: business(),
  workitem_changed: business(true),
  invalid_workitem: business(),
  dependency_not_found: business(),
  invalid_gate_target: business(),
  no_ready_item: business(),
  workitem_awaiting_gate: business(),
  retry_task_required: business(),
  retry_task_mismatch: business(),
  question_unanswered: business(),
  recovery_task_required: business(),
  recovery_task_reused: business(),
  recovery_in_progress: business(),

  dogfood_plan_invalid: usage(),
  dogfood_source_invalid: business(),
  dogfood_dependency_pending: business(true),
  dogfood_audit_failed: business(),
  switch_hold: business(),
} satisfies Record<string, ErrorCatalogEntry>)

export type ErrorCode = keyof typeof ErrorCatalog

/** Returns the registered treatment without ever exposing an unknown error message. */
export function errorCatalogEntry(code: string): ErrorCatalogEntry {
  return ErrorCatalog[code as ErrorCode] ?? ErrorCatalog.internal_error
}

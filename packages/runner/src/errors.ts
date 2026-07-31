import { RolekitError } from '@rolekit/core'

/**
 * Thrown when probe finds an incompatible executor version/protocol.
 * Optional stable code (e.g. missing_api_key for openai-responses).
 */
export class ExecutorIncompatibleError extends RolekitError {
  constructor(message: string, code = 'executor_incompatible') {
    super(message, code)
    this.name = 'ExecutorIncompatibleError'
  }
}

/**
 * Thrown when adapter.start fails before an owned session exists.
 */
export class ExecutorStartError extends RolekitError {
  constructor(message: string) {
    super(message, 'executor_start_failed')
    this.name = 'ExecutorStartError'
  }
}

/**
 * Thrown when the executor process disappears or RPC disconnects.
 */
export class ExecutorLostError extends RolekitError {
  constructor(message: string) {
    super(message, 'executor_lost')
    this.name = 'ExecutorLostError'
  }
}

/**
 * Thrown when an executor explicitly rejects a steering request.
 */
export class ExecutorSteerRejectedError extends RolekitError {
  constructor(message: string) {
    super(message, 'steer_rejected')
    this.name = 'ExecutorSteerRejectedError'
  }
}

/**
 * Thrown when the run deadline is exceeded at the adapter boundary.
 */
export class ExecutorTimeoutError extends RolekitError {
  constructor(message: string) {
    super(message, 'executor_timeout')
    this.name = 'ExecutorTimeoutError'
  }
}

/**
 * Thrown when a capability is not declared (e.g. steer on Pi v1).
 */
export class ExecutorUnsupportedOperationError extends RolekitError {
  constructor(message: string) {
    super(message, 'unsupported_operation')
    this.name = 'ExecutorUnsupportedOperationError'
  }
}

/**
 * Thrown when the adapter registry has no factory for the requested name.
 */
export class UnknownAdapterError extends RolekitError {
  constructor(adapter: string) {
    super(`Unknown adapter: ${adapter}`, 'unknown_adapter')
    this.name = 'UnknownAdapterError'
  }
}

/**
 * Business / control-plane errors surfaced by RunManager.
 */
export class RunManagerError extends RolekitError {
  constructor(code: string, message: string) {
    super(message, code)
    this.name = 'RunManagerError'
  }
}

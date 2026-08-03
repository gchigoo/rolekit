export class CliTimeoutError extends Error {
  readonly code = 'timeout'
  readonly retryable = true

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliTimeoutError'
  }
}

export class CliAbortedError extends Error {
  readonly code = 'cancelled'
  readonly retryable = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliAbortedError'
  }
}

export class CliOutputLimitError extends Error {
  readonly code = 'output_limit_exceeded'
  readonly retryable = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliOutputLimitError'
  }
}

export interface CliSpawnErrorOptions extends ErrorOptions {
  readonly commandDisplay?: string
}

export class CliSpawnError extends Error {
  readonly code = 'spawn_failed'
  readonly retryable = true
  readonly commandDisplay?: string

  constructor(message: string, options: CliSpawnErrorOptions = {}) {
    super(message, options)
    this.name = 'CliSpawnError'
    if (options.commandDisplay !== undefined) {
      this.commandDisplay = options.commandDisplay
    }
  }
}

export interface CliExitErrorOptions extends ErrorOptions {
  readonly exitCode?: number
  readonly signal?: NodeJS.Signals
  readonly stdout?: string
  readonly stderr?: string
  readonly commandDisplay?: string
}

export class CliExitError extends Error {
  readonly code = 'nonzero_exit'
  readonly retryable = true
  readonly exitCode?: number
  readonly signal?: NodeJS.Signals
  readonly stdout?: string
  readonly stderr?: string
  readonly commandDisplay?: string

  constructor(message: string, options: CliExitErrorOptions = {}) {
    super(message, options)
    this.name = 'CliExitError'
    if (options.exitCode !== undefined) {
      this.exitCode = options.exitCode
    }
    if (options.signal !== undefined) {
      this.signal = options.signal
    }
    if (options.stdout !== undefined) {
      this.stdout = options.stdout
    }
    if (options.stderr !== undefined) {
      this.stderr = options.stderr
    }
    if (options.commandDisplay !== undefined) {
      this.commandDisplay = options.commandDisplay
    }
  }
}

export class CliConfigurationError extends Error {
  readonly code = 'configuration_error'
  readonly retryable = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliConfigurationError'
  }
}

export class CliAuthenticationError extends Error {
  readonly code = 'authentication_failed'
  readonly retryable = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliAuthenticationError'
  }
}

export class CliProtocolError extends Error {
  readonly code = 'protocol_error'
  readonly retryable = false

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliProtocolError'
  }
}

export class CliIoError extends Error {
  readonly code = 'io_error'
  readonly retryable = true

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliIoError'
  }
}

export class CliAdapterError extends Error {
  readonly code = 'adapter_error'
  readonly retryable = true

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CliAdapterError'
  }
}

export type CliExecutionError =
  | CliAdapterError
  | CliTimeoutError
  | CliAbortedError
  | CliOutputLimitError
  | CliSpawnError
  | CliExitError
  | CliConfigurationError
  | CliAuthenticationError
  | CliProtocolError
  | CliIoError

export function isCliExecutionError(error: unknown): error is CliExecutionError {
  return (
    error instanceof CliAdapterError ||
    error instanceof CliTimeoutError ||
    error instanceof CliAbortedError ||
    error instanceof CliOutputLimitError ||
    error instanceof CliSpawnError ||
    error instanceof CliExitError ||
    error instanceof CliConfigurationError ||
    error instanceof CliAuthenticationError ||
    error instanceof CliProtocolError ||
    error instanceof CliIoError
  )
}

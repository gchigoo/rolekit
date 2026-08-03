import { RolekitError } from './errors.ts'
import { freezeJsonSnapshot } from './json.ts'
import { AdapterEventSchema, RunEventSchema } from './schemas.ts'
import type { AdapterEvent, JsonSchema, RolekitLogger, RunEvent, RunStatus } from './types.ts'
import { redactSensitiveText, validateStrictValue } from './validation.ts'

export interface RunEventEmitterOptions {
  readonly runId: string
  readonly timestamp: () => string
  readonly sensitiveValues: readonly string[]
  readonly onEvent?: (event: RunEvent) => void
  readonly logger?: RolekitLogger
}

function terminalPhase(status: RunStatus): Exclude<RunStatus, never> {
  return status
}

function safeErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error && error.message.length > 0) {
      return error.message
    }
    if (typeof error === 'string' && error.length > 0) {
      return error
    }
  } catch {
    // Hostile callback failures use the fixed diagnostic below.
  }
  return 'Run event callback failed.'
}

function assertEvent(schema: JsonSchema, event: unknown, label: string): void {
  const validation = validateStrictValue(schema, event)
  if (!validation.valid) {
    throw new RolekitError(
      'invalid_contract',
      `${label} is invalid: ${validation.errors.join('; ')}`,
      { errors: [...validation.errors] },
    )
  }
}

export class RunEventEmitter {
  readonly #options: RunEventEmitterOptions
  #sequence = 0
  #terminalEmitted = false
  #callbackFailureLogged = false

  constructor(options: RunEventEmitterOptions) {
    this.#options = options
  }

  emitStarted(): void {
    this.#emit({ type: 'lifecycle', phase: 'started' })
  }

  emitTerminal(status: RunStatus): void {
    if (this.#terminalEmitted) {
      return
    }
    this.#emit({ type: 'lifecycle', phase: terminalPhase(status) })
    this.#terminalEmitted = true
  }

  emitAdapter(event: AdapterEvent): void {
    const redacted =
      event.type === 'diagnostic'
        ? {
            ...event,
            message: redactSensitiveText(event.message, this.#options.sensitiveValues),
          }
        : event
    assertEvent(AdapterEventSchema as JsonSchema, redacted, 'Adapter event')
    this.#emit(redacted)
  }

  #emit(
    event: AdapterEvent | { readonly type: 'lifecycle'; readonly phase: RunStatus | 'started' },
  ): void {
    this.#sequence += 1
    const snapshot = freezeJsonSnapshot(
      {
        ...event,
        runId: this.#options.runId,
        sequence: this.#sequence,
        createdAt: this.#options.timestamp(),
      },
      `Run event "${this.#options.runId}"`,
    ) as RunEvent
    assertEvent(RunEventSchema as JsonSchema, snapshot, 'Run event')
    this.#forward(snapshot)
  }

  #forward(event: RunEvent): void {
    if (this.#options.onEvent === undefined) {
      return
    }
    try {
      this.#options.onEvent(event)
    } catch (error: unknown) {
      if (this.#callbackFailureLogged || this.#options.logger === undefined) {
        return
      }
      this.#callbackFailureLogged = true
      const diagnostic = freezeJsonSnapshot(
        {
          type: 'diagnostic',
          level: 'error',
          message: redactSensitiveText(
            `Run event callback failed: ${safeErrorMessage(error)}`,
            this.#options.sensitiveValues,
          ),
        },
        'Run event callback diagnostic',
      ) as Extract<AdapterEvent, { readonly type: 'diagnostic' }>
      try {
        this.#options.logger(diagnostic)
      } catch {
        // Logger failures cannot corrupt execution and are never retried.
      }
    }
  }
}

import { mergeCapabilities, missingCapabilities } from './capabilities.ts'
import { RolekitError } from './errors.ts'
import {
  ExecutorDescriptorSchema,
  ExecutorResponseSchema,
  RoleSpecSchema,
  TaskPacketSchema,
} from './schemas.ts'
import type {
  ArtifactRef,
  ExecutionError,
  ExecutorAdapter,
  ExecutorDescriptor,
  ExecutorIdentity,
  ExecutorResponse,
  JsonSchema,
  RolekitOptions,
  RoleSpec,
  RunOptions,
  RunResult,
  TaskPacket,
  TokenUsage,
} from './types.ts'
import { assertCompilableSchema, assertValid, validateValue } from './validation.ts'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function defaultRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function executionError(
  code: string,
  message: string,
  retryable: boolean,
  details?: ExecutionError['details'],
): ExecutionError {
  return {
    code,
    message,
    retryable,
    ...(details === undefined ? {} : { details }),
  }
}

function executorIdentity(
  descriptor: ExecutorDescriptor,
  response?: ExecutorResponse,
): ExecutorIdentity {
  const model = response?.model ?? descriptor.model
  const version = response?.version ?? descriptor.version
  return {
    id: descriptor.id,
    transport: descriptor.transport,
    ...(model === undefined ? {} : { model }),
    ...(version === undefined ? {} : { version }),
  }
}

function withDuration(usage: TokenUsage | undefined, durationMs: number): TokenUsage {
  return {
    ...usage,
    durationMs: usage?.durationMs ?? durationMs,
  }
}

function normalizeArtifacts(
  response: ExecutorResponse,
  runId: string,
  executorId: string,
): readonly ArtifactRef[] {
  return response.artifacts.map((artifact) => ({
    ...artifact,
    provenance: {
      runId,
      executorId,
    },
  }))
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }
  return [...duplicates]
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

export class Rolekit {
  readonly #roles = new Map<string, RoleSpec>()
  readonly #adapters = new Map<string, ExecutorAdapter>()
  readonly #createRunId: () => string
  readonly #now: () => Date

  constructor(options: RolekitOptions = {}) {
    this.#createRunId = options.createRunId ?? defaultRunId
    this.#now = options.now ?? (() => new Date())

    for (const role of options.roles ?? []) {
      this.registerRole(role)
    }
    for (const adapter of options.adapters ?? []) {
      this.registerAdapter(adapter)
    }
  }

  registerRole<TInput, TOutput>(role: RoleSpec<TInput, TOutput>): void {
    assertValid(RoleSpecSchema as JsonSchema, role, `Role "${role.id}"`)
    assertCompilableSchema(role.inputSchema, `Role "${role.id}" inputSchema`)
    assertCompilableSchema(role.outputSchema, `Role "${role.id}" outputSchema`)

    if (this.#roles.has(role.id)) {
      throw new RolekitError('duplicate_role', `Role "${role.id}" is already registered.`)
    }
    this.#roles.set(role.id, role as RoleSpec)
  }

  registerAdapter(adapter: ExecutorAdapter): void {
    if (!ID_PATTERN.test(adapter.id)) {
      throw new RolekitError(
        'invalid_contract',
        `Adapter id "${adapter.id}" is not a valid portable identifier.`,
      )
    }
    if (this.#adapters.has(adapter.id)) {
      throw new RolekitError('duplicate_adapter', `Adapter "${adapter.id}" is already registered.`)
    }
    this.#adapters.set(adapter.id, adapter)
  }

  getRole(id: string): RoleSpec | undefined {
    return this.#roles.get(id)
  }

  getAdapter(id: string): ExecutorAdapter | undefined {
    return this.#adapters.get(id)
  }

  listRoleIds(): readonly string[] {
    return [...this.#roles.keys()].sort()
  }

  listAdapterIds(): readonly string[] {
    return [...this.#adapters.keys()].sort()
  }

  async describeExecutor(executorId: string, adapterOptions: unknown): Promise<ExecutorDescriptor> {
    const adapter = this.#adapters.get(executorId)
    if (adapter === undefined) {
      throw new RolekitError(
        'unknown_adapter',
        `Executor adapter "${executorId}" is not registered.`,
      )
    }
    let descriptor: ExecutorDescriptor
    try {
      descriptor = await adapter.describe(adapterOptions)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RolekitError(
        'invalid_contract',
        `Executor adapter "${executorId}" could not be described: ${message}`,
      )
    }
    assertValid(
      ExecutorDescriptorSchema as JsonSchema,
      descriptor,
      `Executor descriptor "${executorId}"`,
    )
    if (descriptor.id !== adapter.id) {
      throw new RolekitError(
        'invalid_contract',
        `Executor descriptor id "${descriptor.id}" does not match adapter id "${adapter.id}".`,
      )
    }
    return descriptor
  }

  async cancel(executorId: string, runId: string): Promise<void> {
    const adapter = this.#adapters.get(executorId)
    if (adapter === undefined) {
      throw new RolekitError(
        'unknown_adapter',
        `Executor adapter "${executorId}" is not registered.`,
      )
    }
    await adapter.cancel?.(runId)
  }

  async run<TInput, TOutput>(
    task: TaskPacket<TInput>,
    options: RunOptions,
  ): Promise<RunResult<TOutput>> {
    assertValid(TaskPacketSchema as JsonSchema, task, `Task "${task.taskId}"`)
    const role = this.#roles.get(task.roleId) as RoleSpec<TInput, TOutput> | undefined
    if (role === undefined) {
      throw new RolekitError('unknown_role', `Role "${task.roleId}" is not registered.`)
    }

    const duplicateExpectedArtifacts = duplicateValues(
      task.expectedArtifacts.map((artifact) => artifact.name),
    )
    if (duplicateExpectedArtifacts.length > 0) {
      throw new RolekitError(
        'invalid_contract',
        `Task "${task.taskId}" repeats expected artifact names: ${duplicateExpectedArtifacts.join(', ')}.`,
      )
    }

    const inputValidation = validateValue(role.inputSchema, task.input)
    if (!inputValidation.valid) {
      throw new RolekitError(
        'invalid_contract',
        `Task "${task.taskId}" input does not match role "${role.id}": ${inputValidation.errors.join('; ')}`,
        { errors: [...inputValidation.errors] },
      )
    }

    const adapter = this.#adapters.get(options.executorId)
    if (adapter === undefined) {
      throw new RolekitError(
        'unknown_adapter',
        `Executor adapter "${options.executorId}" is not registered.`,
      )
    }

    const runId = options.runId ?? this.#createRunId()
    const startedAt = Date.now()
    const descriptor = await this.describeExecutor(options.executorId, options.adapterOptions)
    const requiredCapabilities = mergeCapabilities(
      role.requiredCapabilities,
      task.requiredCapabilities,
    )

    if (!descriptor.available) {
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        startedAt,
        status: 'blocked',
        summary: `Executor "${descriptor.id}" is unavailable.`,
        error: executionError(
          'executor_unavailable',
          descriptor.diagnostic ?? 'Executor unavailable.',
          true,
        ),
      })
    }

    const missing = missingCapabilities(requiredCapabilities, descriptor.capabilities)
    if (missing.length > 0) {
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        startedAt,
        status: 'blocked',
        summary: `Executor "${descriptor.id}" does not satisfy the task capabilities.`,
        error: executionError(
          'capability_mismatch',
          `Missing capabilities: ${missing.join(', ')}.`,
          false,
          {
            required: [...requiredCapabilities],
            available: [...descriptor.capabilities],
            missing: [...missing],
          },
        ),
      })
    }

    if (isAborted(options.signal)) {
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        startedAt,
        status: 'cancelled',
        summary: 'Execution was cancelled before the adapter started.',
        error: executionError('cancelled', 'The provided abort signal was already aborted.', false),
      })
    }

    let response: ExecutorResponse
    try {
      response = await adapter.execute(role, task, {
        runId,
        cwd: options.cwd,
        options: options.adapterOptions,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error: unknown) {
      const cancelled =
        isAborted(options.signal) || (error instanceof Error && error.name === 'AbortError')
      const message = error instanceof Error ? error.message : String(error)
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        startedAt,
        status: cancelled ? 'cancelled' : 'failed',
        summary: cancelled ? 'Execution was cancelled.' : `Executor "${descriptor.id}" failed.`,
        error: executionError(cancelled ? 'cancelled' : 'adapter_error', message, !cancelled),
      })
    }

    const responseValidation = validateValue(ExecutorResponseSchema as JsonSchema, response)
    const hasOutput = Object.hasOwn(response, 'output') && response.output !== undefined
    const semanticResponseValid =
      response.status === 'completed'
        ? hasOutput && response.error === undefined
        : response.error !== undefined && !hasOutput
    if (!responseValidation.valid || !semanticResponseValid) {
      const errors = [
        ...responseValidation.errors,
        ...(semanticResponseValid
          ? []
          : [
              'completed responses require output and no error; all other responses require error and no output',
            ]),
      ]
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        response,
        startedAt,
        status: 'failed',
        summary: `Executor "${descriptor.id}" returned an invalid response.`,
        error: executionError('invalid_executor_response', errors.join('; '), false, {
          errors,
        }),
      })
    }

    if (response.status !== 'completed') {
      return this.#resultFromResponse<TOutput>(runId, task, descriptor, response, startedAt)
    }

    const outputValidation = validateValue(role.outputSchema, response.output)
    if (!outputValidation.valid) {
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        response,
        startedAt,
        status: 'failed',
        summary: `Executor "${descriptor.id}" returned output that does not match role "${role.id}".`,
        error: executionError(
          'output_validation_failed',
          outputValidation.errors.join('; '),
          false,
          { errors: [...outputValidation.errors] },
        ),
      })
    }

    const duplicateArtifacts = duplicateValues(response.artifacts.map((artifact) => artifact.name))
    if (duplicateArtifacts.length > 0) {
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        response,
        startedAt,
        status: 'failed',
        summary: `Executor "${descriptor.id}" returned duplicate artifact names.`,
        error: executionError(
          'invalid_executor_response',
          `Duplicate artifacts: ${duplicateArtifacts.join(', ')}.`,
          false,
        ),
      })
    }

    const missingArtifacts = task.expectedArtifacts.filter(
      (expected) =>
        !response.artifacts.some(
          (actual) => actual.name === expected.name && actual.kind === expected.kind,
        ),
    )
    if (missingArtifacts.length > 0) {
      return this.#terminalResult<TOutput>({
        runId,
        task,
        descriptor,
        response,
        startedAt,
        status: 'failed',
        summary: `Executor "${descriptor.id}" did not return every expected artifact.`,
        error: executionError(
          'missing_artifact',
          `Missing artifacts: ${missingArtifacts.map((artifact) => `${artifact.name}:${artifact.kind}`).join(', ')}.`,
          false,
          {
            missing: missingArtifacts.map((artifact) => ({
              name: artifact.name,
              kind: artifact.kind,
            })),
          },
        ),
      })
    }

    return this.#resultFromResponse<TOutput>(runId, task, descriptor, response, startedAt)
  }

  #resultFromResponse<TOutput>(
    runId: string,
    task: TaskPacket,
    descriptor: ExecutorDescriptor,
    response: ExecutorResponse,
    startedAt: number,
  ): RunResult<TOutput> {
    return {
      schema: 'rolekit/run-result@1',
      runId,
      taskId: task.taskId,
      roleId: task.roleId,
      status: response.status,
      executor: executorIdentity(descriptor, response),
      summary: response.summary,
      ...(response.output === undefined ? {} : { output: response.output as TOutput }),
      artifacts: normalizeArtifacts(response, runId, descriptor.id),
      evidence: response.evidence,
      usage: withDuration(response.usage, Date.now() - startedAt),
      ...(response.error === undefined ? {} : { error: response.error }),
      createdAt: this.#now().toISOString(),
    }
  }

  #terminalResult<TOutput>(input: {
    readonly runId: string
    readonly task: TaskPacket
    readonly descriptor: ExecutorDescriptor
    readonly startedAt: number
    readonly status: Exclude<RunResult['status'], 'completed'>
    readonly summary: string
    readonly error: ExecutionError
    readonly response?: ExecutorResponse
  }): RunResult<TOutput> {
    const response = input.response
    return {
      schema: 'rolekit/run-result@1',
      runId: input.runId,
      taskId: input.task.taskId,
      roleId: input.task.roleId,
      status: input.status,
      executor: executorIdentity(input.descriptor, response),
      summary: input.summary,
      artifacts:
        response === undefined
          ? []
          : normalizeArtifacts(response, input.runId, input.descriptor.id),
      evidence: response?.evidence ?? [],
      usage: withDuration(response?.usage, Date.now() - input.startedAt),
      error: input.error,
      createdAt: this.#now().toISOString(),
    }
  }
}

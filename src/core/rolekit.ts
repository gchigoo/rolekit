import { RolekitError } from './errors.ts'
import { RunEventEmitter } from './events.ts'
import {
  createActualExecutorIdentity,
  createExecutionPlan,
  finalizeExecution,
} from './execution-plan.ts'
import { freezeJsonSnapshot, normalizeJsonSchema } from './json.ts'
import {
  ExecutionAdmissionSchema,
  ExecutorDescriptorV2Schema,
  ExecutorProbeSchema,
  ExecutorProfileProvenanceInputSchema,
  RoleSpecSchema,
  TaskPacketSchema,
} from './schemas.ts'
import type {
  CompileOptions,
  ExecutionAdmission,
  ExecutionCompilation,
  ExecutionError,
  ExecutionReceipt,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorProbe,
  ExecutorProfileProvenanceInput,
  JsonSchema,
  PreparedExecutorOptions,
  PublicOptionContext,
  ResolvedExecutionPlan,
  RolekitLogger,
  RolekitOptions,
  RoleSpec,
  RunEvent,
  RunOptions,
  RunResultV2,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TaskPacket,
} from './types.ts'
import {
  preparedSensitiveValues,
  redactSensitiveJsonValue,
  redactSensitiveText,
  validatePreparedExecutorOptions,
  validatePublicOptionSafety,
  validateStrictValue,
} from './validation.ts'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const REQUIRED_ADAPTER_METHODS = ['prepareOptions', 'inspect', 'probe', 'admit', 'execute'] as const

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

interface AdapterExecutionFailure {
  readonly cancelled: boolean
  readonly message: string
}

function normalizeAdapterExecutionFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  sensitiveValues: readonly string[],
): AdapterExecutionFailure {
  if (isAborted(signal)) {
    return {
      cancelled: true,
      message: 'The provided abort signal was aborted during adapter execution.',
    }
  }

  const fallback: AdapterExecutionFailure = {
    cancelled: false,
    message: 'Executor adapter execution failed.',
  }
  try {
    if (typeof error === 'string' && error.length > 0) {
      return {
        cancelled: false,
        message: redactSensitiveText(error, sensitiveValues),
      }
    }
    if (error instanceof Error) {
      const message = error.message
      if (typeof message !== 'string') {
        return fallback
      }
      return {
        cancelled: false,
        message:
          message.length > 0 ? redactSensitiveText(message, sensitiveValues) : fallback.message,
      }
    }
  } catch {
    return fallback
  }
  return fallback
}

function safeErrorMessage(error: unknown, fallback: string): string {
  try {
    if (error instanceof Error && error.message.length > 0) {
      return error.message
    }
    if (typeof error === 'string' && error.length > 0) {
      return error
    }
  } catch {
    // Hostile thrown values use the fixed fallback.
  }
  return fallback
}

function adapterSensitiveOptionPointers(adapter: ExecutorAdapter): unknown {
  try {
    return adapter.sensitiveOptionPointers
  } catch {
    return { invalid: true }
  }
}

function assertStrictContract(schema: JsonSchema, value: unknown, label: string): void {
  const result = validateStrictValue(schema, value)
  if (!result.valid) {
    throw new RolekitError('invalid_contract', `${label} is invalid: ${result.errors.join('; ')}`, {
      errors: [...result.errors],
    })
  }
}

function roleSnapshot<TInput, TOutput>(role: RoleSpec<TInput, TOutput>): RoleSpec<TInput, TOutput> {
  if (
    typeof role !== 'object' ||
    role === null ||
    (Object.getPrototypeOf(role) !== Object.prototype && Object.getPrototypeOf(role) !== null)
  ) {
    throw new RolekitError('invalid_contract', 'Role must be a plain JSON object.')
  }

  const candidate: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(role)) {
    if (typeof key === 'symbol') {
      throw new RolekitError('invalid_contract', 'Role contains symbol-keyed state.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(role, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      throw new RolekitError(
        'invalid_contract',
        `Role property "${key}" must be an enumerable data property.`,
      )
    }
    Object.defineProperty(candidate, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    })
  }

  const id = typeof candidate.id === 'string' ? candidate.id : '<unknown>'
  candidate.inputSchema = normalizeJsonSchema(
    candidate.inputSchema as JsonSchema,
    `Role "${id}" inputSchema`,
  )
  candidate.outputSchema = normalizeJsonSchema(
    candidate.outputSchema as JsonSchema,
    `Role "${id}" outputSchema`,
  )
  const snapshot = freezeJsonSnapshot(candidate, `Role "${id}"`)
  assertStrictContract(RoleSpecSchema as JsonSchema, snapshot, `Role "${id}"`)
  return snapshot as unknown as RoleSpec<TInput, TOutput>
}

interface ResolvedTask<TInput, TOutput> {
  readonly task: Readonly<TaskPacket<TInput>>
  readonly role: RoleSpec<TInput, TOutput>
}

interface InternalCompilation<TOptions = unknown> {
  readonly adapter: ExecutorAdapter<TOptions>
  readonly prepared: PreparedExecutorOptions<TOptions>
  readonly descriptor: ExecutorDescriptorV2
  readonly admission: ExecutionAdmission
}

interface CapturedRunOptions {
  readonly executorId: string
  readonly cwd: string
  readonly adapterOptions: unknown
  readonly profile?: ExecutorProfileProvenanceInput
  readonly publicOptionContext?: PublicOptionContext
  readonly runId: string
  readonly signal?: AbortSignal
  readonly onEvent?: (event: RunEvent) => void
}

function captureRunOptions(options: RunOptions, createRunId: () => string): CapturedRunOptions {
  let executorId: unknown
  let cwd: unknown
  let adapterOptions: unknown
  let profileCandidate: unknown
  let publicOptionContext: PublicOptionContext | undefined
  let requestedRunId: unknown
  let signal: AbortSignal | undefined
  let onEvent: unknown
  try {
    executorId = options.executorId
    cwd = options.cwd
    adapterOptions = options.adapterOptions
    profileCandidate = options.profile
    publicOptionContext = options.publicOptionContext
    requestedRunId = options.runId
    signal = options.signal
    onEvent = options.onEvent
  } catch {
    throw new RolekitError('invalid_contract', 'Run options could not be captured.')
  }

  if (typeof executorId !== 'string' || !ID_PATTERN.test(executorId)) {
    throw new RolekitError('invalid_contract', 'Run options executorId is invalid.')
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new RolekitError('invalid_contract', 'Run options cwd must be a non-empty string.')
  }

  let runId: unknown = requestedRunId
  if (runId === undefined) {
    try {
      runId = createRunId()
    } catch {
      throw new RolekitError('invalid_contract', 'Rolekit createRunId() failed.')
    }
  }
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new RolekitError('invalid_contract', 'Run options runId must be a non-empty string.')
  }

  let profile: ExecutorProfileProvenanceInput | undefined
  if (profileCandidate !== undefined) {
    try {
      profile = freezeJsonSnapshot(
        profileCandidate,
        'Executor profile provenance',
      ) as ExecutorProfileProvenanceInput
      assertStrictContract(
        ExecutorProfileProvenanceInputSchema as JsonSchema,
        profile,
        'Executor profile provenance',
      )
    } catch {
      throw new RolekitError('invalid_contract', 'Run options profile provenance is invalid.')
    }
  }

  if (signal !== undefined) {
    try {
      if (typeof signal.aborted !== 'boolean') {
        throw new Error('invalid signal')
      }
    } catch {
      throw new RolekitError('invalid_contract', 'Run options signal must be an AbortSignal.')
    }
  }
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new RolekitError('invalid_contract', 'Run options onEvent must be a function.')
  }

  return Object.freeze({
    executorId,
    cwd,
    adapterOptions,
    ...(profile === undefined ? {} : { profile }),
    ...(publicOptionContext === undefined ? {} : { publicOptionContext }),
    runId,
    ...(signal === undefined ? {} : { signal }),
    ...(onEvent === undefined ? {} : { onEvent: onEvent as (event: RunEvent) => void }),
  })
}

export class Rolekit {
  readonly #roles = new Map<string, RoleSpec>()
  readonly #adapters = new Map<string, ExecutorAdapter>()
  readonly #activeRunIds = new Set<string>()
  readonly #createRunId: () => string
  readonly #now: () => Date
  readonly #logger: RolekitLogger | undefined

  constructor(options: RolekitOptions = {}) {
    this.#createRunId = options.createRunId ?? defaultRunId
    this.#now = options.now ?? (() => new Date())
    this.#logger = options.logger
    if (this.#logger !== undefined && typeof this.#logger !== 'function') {
      throw new RolekitError('invalid_contract', 'Rolekit logger must be a function.')
    }

    for (const role of options.roles ?? []) {
      this.registerRole(role)
    }
    for (const adapter of options.adapters ?? []) {
      this.registerAdapter(adapter)
    }
  }

  registerRole<TInput, TOutput>(role: RoleSpec<TInput, TOutput>): void {
    const snapshot = roleSnapshot(role)

    if (this.#roles.has(snapshot.id)) {
      throw new RolekitError('duplicate_role', `Role "${snapshot.id}" is already registered.`)
    }
    this.#roles.set(snapshot.id, snapshot as RoleSpec)
  }

  registerAdapter(adapter: ExecutorAdapter): void {
    const candidate = adapter as unknown as Readonly<Record<string, unknown>>
    if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id)) {
      throw new RolekitError(
        'invalid_contract',
        `Adapter id "${String(candidate.id)}" is not a valid portable identifier.`,
      )
    }
    for (const method of REQUIRED_ADAPTER_METHODS) {
      if (typeof candidate[method] !== 'function') {
        throw new RolekitError(
          'invalid_contract',
          `Adapter "${candidate.id}" must implement ${method}() for rolekit/executor-adapter@1.`,
        )
      }
    }
    if (candidate.cancel !== undefined && typeof candidate.cancel !== 'function') {
      throw new RolekitError(
        'invalid_contract',
        `Adapter "${candidate.id}" cancel must be a function when provided.`,
      )
    }
    if (this.#adapters.has(candidate.id)) {
      throw new RolekitError(
        'duplicate_adapter',
        `Adapter "${candidate.id}" is already registered.`,
      )
    }
    this.#adapters.set(candidate.id, adapter)
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

  inspectExecutor(
    executorId: string,
    adapterOptions: unknown,
    publicContext?: PublicOptionContext,
  ): ExecutorDescriptorV2 {
    const adapter = this.#registeredAdapter(executorId)
    return this.#prepareAdapter(adapter, adapterOptions, publicContext).descriptor
  }

  compile<TInput, TOutput>(
    task: TaskPacket<TInput>,
    options: CompileOptions,
  ): ExecutionCompilation {
    const resolved = this.#resolveTask<TInput, TOutput>(task)
    const adapter = this.#registeredAdapter(options.executorId)
    const compilation = this.#prepareAdapterForTask(
      adapter,
      resolved.role,
      resolved.task,
      options.adapterOptions,
      options.publicOptionContext,
    )
    return freezeJsonSnapshot(
      {
        descriptor: compilation.descriptor,
        admission: compilation.admission,
        publicOptions: compilation.admission.effectivePublicOptions,
      },
      `Execution compilation for task "${resolved.task.taskId}"`,
    ) as ExecutionCompilation
  }

  async cancel(executorId: string, runId: string): Promise<void> {
    const adapter = this.#registeredAdapter(executorId)
    await adapter.cancel?.(runId)
  }

  async run<TInput, TOutput>(
    task: TaskPacket<TInput>,
    options: RunOptions,
  ): Promise<RunResultV2<TOutput>> {
    const capturedOptions = captureRunOptions(options, this.#createRunId)
    const resolved = this.#resolveTask<TInput, TOutput>(task)
    const adapter = this.#registeredAdapter(capturedOptions.executorId)
    const runId = capturedOptions.runId
    if (this.#activeRunIds.has(runId)) {
      throw new RolekitError('duplicate_run', `Run id "${runId}" is already active.`)
    }
    this.#activeRunIds.add(runId)

    let descriptor: ExecutorDescriptorV2 | undefined
    let probe: ExecutorProbe | undefined
    let eventEmitter: RunEventEmitter | undefined
    const complete = async (
      resultPromise: Promise<RunResultV2<TOutput>>,
    ): Promise<RunResultV2<TOutput>> => {
      const result = await resultPromise
      eventEmitter?.emitTerminal(result.status)
      return result
    }

    try {
      const preparedCompilation = this.#prepareAdapter(
        adapter,
        capturedOptions.adapterOptions,
        capturedOptions.publicOptionContext,
      )
      descriptor = preparedCompilation.descriptor
      const startedAt = this.#timestamp()
      eventEmitter = new RunEventEmitter({
        runId,
        timestamp: () => this.#timestamp(),
        sensitiveValues: preparedCompilation.prepared.sensitiveValues,
        ...(capturedOptions.onEvent === undefined ? {} : { onEvent: capturedOptions.onEvent }),
        ...(this.#logger === undefined ? {} : { logger: this.#logger }),
      })
      eventEmitter.emitStarted()
      const compilation: InternalCompilation = {
        ...preparedCompilation,
        admission: this.#admit(adapter, resolved.role, resolved.task, preparedCompilation.prepared),
      }

      if (!compilation.admission.allowed) {
        const plan = await this.#createAdapterPlan(
          resolved,
          compilation,
          compilation.admission,
          capturedOptions,
          runId,
          startedAt,
        )
        return await complete(
          this.#finalizeTerminal<TOutput>({
            plan,
            startedAt,
            descriptor,
            status: 'blocked',
            summary: `Executor "${descriptor.id}" blocked execution during static admission.`,
            error: compilation.admission.blockedError,
          }),
        )
      }

      if (isAborted(capturedOptions.signal)) {
        const plan = await this.#createAdapterPlan(
          resolved,
          compilation,
          compilation.admission,
          capturedOptions,
          runId,
          startedAt,
        )
        return await complete(
          this.#finalizeTerminal<TOutput>({
            plan,
            startedAt,
            descriptor,
            status: 'cancelled',
            summary: 'Execution was cancelled before the adapter probe started.',
            error: executionError(
              'cancelled',
              'The provided abort signal was already aborted.',
              false,
            ),
          }),
        )
      }

      let probeCandidate: unknown
      try {
        probeCandidate = await adapter.probe(compilation.prepared, {
          cwd: capturedOptions.cwd,
          ...(capturedOptions.signal === undefined ? {} : { signal: capturedOptions.signal }),
        })
      } catch (error: unknown) {
        probeCandidate = {
          available: false,
          featureChecks: {},
          diagnostic: redactSensitiveText(
            safeErrorMessage(error, 'Executor probe failed.'),
            compilation.prepared.sensitiveValues,
          ),
        }
      }
      try {
        probe = freezeJsonSnapshot(
          redactSensitiveJsonValue(probeCandidate, compilation.prepared.sensitiveValues),
          `Executor probe "${adapter.id}"`,
        ) as ExecutorProbe
        assertStrictContract(
          ExecutorProbeSchema as JsonSchema,
          probe,
          `Executor probe "${adapter.id}"`,
        )
      } catch (error: unknown) {
        throw new RolekitError(
          'invalid_contract',
          `Executor adapter "${adapter.id}" returned invalid probe data: ${redactSensitiveText(
            safeErrorMessage(error, 'Unknown probe validation error.'),
            compilation.prepared.sensitiveValues,
          )}`,
        )
      }

      const runtimeAdmission = this.#admit(
        adapter,
        resolved.role,
        resolved.task,
        compilation.prepared,
        probe,
      )
      if (probe.available === false && runtimeAdmission.allowed) {
        throw new RolekitError(
          'invalid_contract',
          `Executor adapter "${adapter.id}" admitted execution after an unavailable probe.`,
        )
      }
      const plan = await this.#createAdapterPlan(
        resolved,
        compilation,
        runtimeAdmission,
        capturedOptions,
        runId,
        startedAt,
      )

      if (isAborted(capturedOptions.signal)) {
        return await complete(
          this.#finalizeTerminal<TOutput>({
            plan,
            startedAt,
            descriptor,
            probe,
            status: 'cancelled',
            summary: 'Execution was cancelled during the adapter probe.',
            error: executionError('cancelled', 'The adapter probe was cancelled.', false),
          }),
        )
      }

      if (!runtimeAdmission.allowed) {
        return await complete(
          this.#finalizeTerminal<TOutput>({
            plan,
            startedAt,
            descriptor,
            probe,
            status: 'blocked',
            summary: `Executor "${descriptor.id}" blocked execution during runtime admission.`,
            error: runtimeAdmission.blockedError,
          }),
        )
      }

      let response: unknown
      let executionFailed = false
      let executionFailure: unknown
      let cancelPromise: Promise<void> | undefined
      const requestAdapterCancellation = (): void => {
        if (adapter.cancel === undefined || cancelPromise !== undefined) {
          return
        }
        cancelPromise = Promise.resolve()
          .then(() => adapter.cancel?.(runId))
          .then(() => undefined)
          .catch(() => undefined)
      }
      capturedOptions.signal?.addEventListener('abort', requestAdapterCancellation, { once: true })
      if (isAborted(capturedOptions.signal)) {
        requestAdapterCancellation()
      }
      try {
        response = await adapter.execute(resolved.role, resolved.task, {
          runId,
          cwd: capturedOptions.cwd,
          options: compilation.prepared.executionOptions,
          admission: runtimeAdmission,
          sensitiveValues: compilation.prepared.sensitiveValues,
          ...(capturedOptions.signal === undefined ? {} : { signal: capturedOptions.signal }),
          emitEvent: (event) => eventEmitter?.emitAdapter(event),
        })
      } catch (error: unknown) {
        executionFailed = true
        executionFailure = error
      } finally {
        capturedOptions.signal?.removeEventListener('abort', requestAdapterCancellation)
        await cancelPromise
      }
      if (executionFailed) {
        const failure = normalizeAdapterExecutionFailure(
          executionFailure,
          capturedOptions.signal,
          compilation.prepared.sensitiveValues,
        )
        return await complete(
          this.#finalizeTerminal<TOutput>({
            plan,
            startedAt,
            descriptor,
            probe,
            status: failure.cancelled ? 'cancelled' : 'failed',
            summary: failure.cancelled
              ? 'Execution was cancelled.'
              : `Executor "${descriptor.id}" failed.`,
            error: executionError(
              failure.cancelled ? 'cancelled' : 'adapter_error',
              failure.message,
              !failure.cancelled,
            ),
          }),
        )
      }

      if (isAborted(capturedOptions.signal)) {
        return await complete(
          this.#finalizeTerminal<TOutput>({
            plan,
            startedAt,
            descriptor,
            probe,
            status: 'cancelled',
            summary: 'Execution was cancelled during adapter execution.',
            error: executionError(
              'cancelled',
              'The provided abort signal was aborted during adapter execution.',
              false,
            ),
          }),
        )
      }

      response = redactSensitiveJsonValue(response, compilation.prepared.sensitiveValues)
      return await complete(
        finalizeExecution<TOutput>(
          plan,
          this.#receipt(plan, startedAt, descriptor, probe, response, this.#timestamp()),
        ),
      )
    } catch (error: unknown) {
      eventEmitter?.emitTerminal('failed')
      throw error
    } finally {
      this.#activeRunIds.delete(runId)
    }
  }

  #registeredAdapter(executorId: string): ExecutorAdapter {
    const adapter = this.#adapters.get(executorId)
    if (adapter === undefined) {
      throw new RolekitError(
        'unknown_adapter',
        `Executor adapter "${executorId}" is not registered.`,
      )
    }
    return adapter
  }

  #resolveTask<TInput, TOutput>(task: TaskPacket<TInput>): ResolvedTask<TInput, TOutput> {
    const taskSnapshot = freezeJsonSnapshot(task, 'Task') as Readonly<TaskPacket<TInput>>
    assertStrictContract(
      TaskPacketSchema as JsonSchema,
      taskSnapshot,
      `Task "${taskSnapshot.taskId}"`,
    )
    const role = this.#roles.get(taskSnapshot.roleId) as RoleSpec<TInput, TOutput> | undefined
    if (role === undefined) {
      throw new RolekitError('unknown_role', `Role "${taskSnapshot.roleId}" is not registered.`)
    }

    const duplicateExpectedArtifacts = duplicateValues(
      taskSnapshot.expectedArtifacts.map((artifact) => artifact.name),
    )
    if (duplicateExpectedArtifacts.length > 0) {
      throw new RolekitError(
        'invalid_contract',
        `Task "${taskSnapshot.taskId}" repeats expected artifact names: ${duplicateExpectedArtifacts.join(', ')}.`,
      )
    }

    const inputValidation = validateStrictValue(role.inputSchema, taskSnapshot.input)
    if (!inputValidation.valid) {
      throw new RolekitError(
        'invalid_contract',
        `Task "${taskSnapshot.taskId}" input does not match role "${role.id}": ${inputValidation.errors.join('; ')}`,
        { errors: [...inputValidation.errors] },
      )
    }
    return { task: taskSnapshot, role }
  }

  #prepareAdapter(
    adapter: ExecutorAdapter,
    adapterOptions: unknown,
    publicContext?: PublicOptionContext,
  ): InternalCompilation {
    let preparedCandidate: unknown
    try {
      preparedCandidate = adapter.prepareOptions(adapterOptions, publicContext)
    } catch (error: unknown) {
      throw new RolekitError(
        'invalid_contract',
        `Executor adapter "${adapter.id}" options could not be prepared: ${safeErrorMessage(error, 'Unknown option error.')}`,
      )
    }
    const candidateSensitiveValues = preparedSensitiveValues(preparedCandidate)
    const preparedValidation = validatePreparedExecutorOptions(
      preparedCandidate,
      adapterSensitiveOptionPointers(adapter),
    )
    if (!preparedValidation.valid || preparedValidation.prepared === undefined) {
      throw new RolekitError(
        'invalid_contract',
        redactSensitiveText(
          `Executor adapter "${adapter.id}" returned invalid prepared options: ${preparedValidation.errors.join('; ')}.`,
          candidateSensitiveValues,
        ),
        {
          errors: preparedValidation.errors.map((error) =>
            redactSensitiveText(error, candidateSensitiveValues),
          ),
        },
      )
    }
    const prepared = preparedValidation.prepared

    let descriptorCandidate: unknown
    try {
      descriptorCandidate = adapter.inspect(prepared)
    } catch (error: unknown) {
      throw new RolekitError(
        'invalid_contract',
        `Executor adapter "${adapter.id}" could not be inspected: ${redactSensitiveText(
          safeErrorMessage(error, 'Unknown inspection error.'),
          prepared.sensitiveValues,
        )}`,
      )
    }
    let descriptor: ExecutorDescriptorV2
    try {
      descriptor = freezeJsonSnapshot(
        descriptorCandidate,
        `Executor descriptor "${adapter.id}"`,
      ) as ExecutorDescriptorV2
      assertStrictContract(
        ExecutorDescriptorV2Schema as JsonSchema,
        descriptor,
        `Executor descriptor "${adapter.id}"`,
      )
      if (descriptor.id !== adapter.id) {
        throw new RolekitError(
          'invalid_contract',
          `Executor descriptor id "${descriptor.id}" does not match adapter id "${adapter.id}".`,
        )
      }
    } catch (error: unknown) {
      throw new RolekitError(
        'invalid_contract',
        `Executor adapter "${adapter.id}" returned an invalid descriptor: ${redactSensitiveText(
          safeErrorMessage(error, 'Unknown descriptor validation error.'),
          prepared.sensitiveValues,
        )}`,
      )
    }
    return {
      adapter,
      prepared,
      descriptor,
      admission: {
        allowed: true,
        effectiveCapabilities: descriptor.capabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: descriptor.features.contextIsolation,
      },
    }
  }

  #prepareAdapterForTask(
    adapter: ExecutorAdapter,
    role: RoleSpec,
    task: TaskPacket,
    adapterOptions: unknown,
    publicContext?: PublicOptionContext,
  ): InternalCompilation {
    const inspected = this.#prepareAdapter(adapter, adapterOptions, publicContext)
    return {
      ...inspected,
      admission: this.#admit(adapter, role, task, inspected.prepared),
    }
  }

  #admit(
    adapter: ExecutorAdapter,
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions,
    probe?: ExecutorProbe,
  ): ExecutionAdmission {
    let admissionCandidate: unknown
    try {
      admissionCandidate = adapter.admit(role, task, prepared, probe)
    } catch (error: unknown) {
      throw new RolekitError(
        'invalid_contract',
        `Executor adapter "${adapter.id}" admission failed: ${redactSensitiveText(
          safeErrorMessage(error, 'Unknown admission error.'),
          prepared.sensitiveValues,
        )}`,
      )
    }
    try {
      const admission = freezeJsonSnapshot(
        admissionCandidate,
        `Execution admission "${adapter.id}"`,
      ) as ExecutionAdmission
      assertStrictContract(
        ExecutionAdmissionSchema as JsonSchema,
        admission,
        `Execution admission "${adapter.id}"`,
      )
      const publicSafety = validatePublicOptionSafety(
        admission.effectivePublicOptions,
        prepared.sensitiveValues,
        adapterSensitiveOptionPointers(adapter),
        'Effective public options',
      )
      if (!publicSafety.valid) {
        throw new RolekitError(
          'invalid_contract',
          `Executor adapter "${adapter.id}" returned unsafe effective public options: ${publicSafety.errors.join('; ')}.`,
          { errors: [...publicSafety.errors] },
        )
      }
      return freezeJsonSnapshot(
        redactSensitiveJsonValue(admission, prepared.sensitiveValues),
        `Redacted execution admission "${adapter.id}"`,
      ) as ExecutionAdmission
    } catch (error: unknown) {
      throw new RolekitError(
        'invalid_contract',
        `Executor adapter "${adapter.id}" returned invalid admission data: ${redactSensitiveText(
          safeErrorMessage(error, 'Unknown admission validation error.'),
          prepared.sensitiveValues,
        )}`,
      )
    }
  }

  #timestamp(): string {
    const value = this.#now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new RolekitError('invalid_contract', 'Rolekit now() must return a valid Date.')
    }
    return value.toISOString()
  }

  #createAdapterPlan<TInput, TOutput>(
    resolved: ResolvedTask<TInput, TOutput>,
    compilation: InternalCompilation,
    admission: ExecutionAdmission,
    capturedOptions: CapturedRunOptions,
    runId: string,
    createdAt: string,
  ): Promise<ResolvedExecutionPlan> {
    return createExecutionPlan({
      role: resolved.role as unknown as SnapshotRoleSpec,
      task: resolved.task as unknown as SnapshotTaskPacket,
      target: {
        target: 'adapter',
        capabilitySource: 'adapter-verified',
        adapterProtocol: compilation.descriptor.adapterProtocol,
        adapterVersion: compilation.descriptor.adapterVersion,
        id: compilation.descriptor.id,
        transport: compilation.descriptor.transport,
        ...(capturedOptions.profile?.id === undefined
          ? {}
          : { profileId: capturedOptions.profile.id }),
        ...(capturedOptions.profile?.digest === undefined
          ? {}
          : { profileDigest: capturedOptions.profile.digest }),
        ...(compilation.prepared.requestedProvider === undefined
          ? {}
          : { requestedProvider: compilation.prepared.requestedProvider }),
        ...(compilation.prepared.requestedModel === undefined
          ? {}
          : { requestedModel: compilation.prepared.requestedModel }),
        requiredSecrets: capturedOptions.profile?.requiredSecrets ?? [],
        admission,
      },
      workspace: { root: capturedOptions.cwd },
      runId,
      createdAt,
    })
  }

  #receipt(
    plan: ResolvedExecutionPlan,
    startedAt: string,
    descriptor: ExecutorDescriptorV2,
    probe: ExecutorProbe | undefined,
    response: unknown,
    completedAt: string,
  ): ExecutionReceipt {
    return {
      schema: 'rolekit/execution-receipt@1',
      planDigest: plan.planDigest,
      runId: plan.plan.runId,
      taskId: plan.plan.content.task.snapshot.taskId,
      roleId: plan.plan.content.role.snapshot.id,
      startedAt,
      completedAt,
      actualExecutor: createActualExecutorIdentity(descriptor, probe, response),
      response,
    }
  }

  #finalizeTerminal<TOutput>(input: {
    readonly plan: ResolvedExecutionPlan
    readonly startedAt: string
    readonly descriptor: ExecutorDescriptorV2
    readonly probe?: ExecutorProbe
    readonly status: 'failed' | 'blocked' | 'cancelled'
    readonly summary: string
    readonly error: ExecutionError
  }): Promise<RunResultV2<TOutput>> {
    const response = {
      status: input.status,
      summary: input.summary,
      artifacts: [],
      evidence: [],
      error: input.error,
    } as const
    return finalizeExecution<TOutput>(
      input.plan,
      this.#receipt(
        input.plan,
        input.startedAt,
        input.descriptor,
        input.probe,
        response,
        this.#timestamp(),
      ),
    )
  }
}

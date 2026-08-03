import { mergeCapabilities, missingCapabilities } from '../core/capabilities.ts'
import { freezeJsonSnapshot } from '../core/json.ts'
import type {
  ExecutionAdmission,
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorProbe,
  ExecutorResponse,
  PreparedExecutorOptions,
  ProbeContext,
  PublicOptionContext,
  RoleSpec,
  TaskPacket,
} from '../core/types.ts'

export interface FakeAdapterInvocation {
  readonly role: RoleSpec
  readonly task: TaskPacket
  readonly context: ExecutionContext
}

export interface FakeAdmissionInput {
  readonly role: RoleSpec
  readonly task: TaskPacket
  readonly prepared: PreparedExecutorOptions
  readonly probe?: ExecutorProbe
}

export interface FakeAdapterOptions {
  readonly descriptor: ExecutorDescriptorV2
  readonly sensitiveOptionPointers?: readonly string[]
  readonly preparedOptions?:
    | PreparedExecutorOptions
    | ((options: unknown, publicContext?: PublicOptionContext) => PreparedExecutorOptions)
  readonly inspection?:
    | ExecutorDescriptorV2
    | ((prepared: PreparedExecutorOptions) => ExecutorDescriptorV2)
  readonly response:
    | ExecutorResponse
    | ((invocation: FakeAdapterInvocation) => ExecutorResponse | Promise<ExecutorResponse>)
  readonly probe?:
    | ExecutorProbe
    | ((
        prepared: PreparedExecutorOptions,
        context: ProbeContext,
      ) => ExecutorProbe | Promise<ExecutorProbe>)
  readonly admission?: (input: FakeAdmissionInput) => ExecutionAdmission
}

export class FakeExecutorAdapter implements ExecutorAdapter {
  readonly id: string
  readonly sensitiveOptionPointers: readonly string[]
  readonly invocations: FakeAdapterInvocation[] = []
  prepareCount = 0
  inspectCount = 0
  probeCount = 0
  admitCount = 0
  cancelCount = 0

  readonly #descriptor: ExecutorDescriptorV2
  readonly #preparedOptions: FakeAdapterOptions['preparedOptions']
  readonly #inspection: FakeAdapterOptions['inspection']
  readonly #response: FakeAdapterOptions['response']
  readonly #probe: FakeAdapterOptions['probe']
  readonly #admission: FakeAdapterOptions['admission']

  constructor(options: FakeAdapterOptions) {
    this.id = options.descriptor.id
    this.sensitiveOptionPointers = Object.freeze([...(options.sensitiveOptionPointers ?? [])])
    this.#descriptor = options.descriptor
    this.#preparedOptions = options.preparedOptions
    this.#inspection = options.inspection
    this.#response = options.response
    this.#probe = options.probe
    this.#admission = options.admission
  }

  prepareOptions(options: unknown, publicContext?: PublicOptionContext): PreparedExecutorOptions {
    this.prepareCount += 1
    if (typeof this.#preparedOptions === 'function') {
      return this.#preparedOptions(options, publicContext)
    }
    if (this.#preparedOptions !== undefined) {
      return this.#preparedOptions
    }
    return freezeJsonSnapshot(
      {
        executionOptions: options ?? {},
        publicOptions: options ?? {},
        sensitiveValues: [],
      },
      'Fake prepared options',
    ) as unknown as PreparedExecutorOptions
  }

  inspect(prepared: PreparedExecutorOptions): ExecutorDescriptorV2 {
    this.inspectCount += 1
    if (typeof this.#inspection === 'function') {
      return this.#inspection(prepared)
    }
    return this.#inspection ?? this.#descriptor
  }

  async probe(prepared: PreparedExecutorOptions, context: ProbeContext): Promise<ExecutorProbe> {
    this.probeCount += 1
    if (typeof this.#probe === 'function') {
      return this.#probe(prepared, context)
    }
    return (
      this.#probe ?? {
        available: true,
        executorVersion: 'fake-runtime-1.0.0',
        featureChecks: { runtime: true },
      }
    )
  }

  admit(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions,
    probe?: ExecutorProbe,
  ): ExecutionAdmission {
    this.admitCount += 1
    if (this.#admission !== undefined) {
      return this.#admission({
        role,
        task,
        prepared,
        ...(probe === undefined ? {} : { probe }),
      })
    }
    const effectiveCapabilities = this.#descriptor.capabilities
    const contextIsolation = this.#descriptor.features.contextIsolation
    if (probe?.available === false) {
      return {
        allowed: false,
        effectiveCapabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation,
        blockedError: {
          code: 'executor_unavailable',
          message: probe.diagnostic,
          retryable: true,
        },
      }
    }
    const required = mergeCapabilities(role.requiredCapabilities, task.requiredCapabilities)
    const missing = missingCapabilities(required, effectiveCapabilities)
    if (missing.length > 0) {
      return {
        allowed: false,
        effectiveCapabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation,
        blockedError: {
          code: 'capability_mismatch',
          message: `Missing capabilities: ${missing.join(', ')}.`,
          retryable: false,
          details: {
            required: [...required],
            available: [...effectiveCapabilities],
            missing: [...missing],
          },
        },
      }
    }
    return {
      allowed: true,
      effectiveCapabilities,
      effectivePublicOptions: prepared.publicOptions,
      pathEnforcement: 'advisory',
      contextIsolation,
    }
  }

  async execute(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext,
  ): Promise<ExecutorResponse> {
    const invocation = { role, task, context }
    this.invocations.push(invocation)
    return typeof this.#response === 'function' ? this.#response(invocation) : this.#response
  }

  async cancel(_runId: string): Promise<void> {
    this.cancelCount += 1
  }
}

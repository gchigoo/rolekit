import type {
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptor,
  ExecutorResponse,
  RoleSpec,
  TaskPacket,
} from '../core/types.ts'

export interface FakeAdapterInvocation {
  readonly role: RoleSpec
  readonly task: TaskPacket
  readonly context: ExecutionContext
}

export interface FakeAdapterOptions {
  readonly descriptor: ExecutorDescriptor
  readonly response:
    | ExecutorResponse
    | ((invocation: FakeAdapterInvocation) => ExecutorResponse | Promise<ExecutorResponse>)
}

export class FakeExecutorAdapter implements ExecutorAdapter {
  readonly id: string
  readonly invocations: FakeAdapterInvocation[] = []
  describeCount = 0
  cancelCount = 0

  readonly #descriptor: ExecutorDescriptor
  readonly #response: FakeAdapterOptions['response']

  constructor(options: FakeAdapterOptions) {
    this.id = options.descriptor.id
    this.#descriptor = options.descriptor
    this.#response = options.response
  }

  async describe(_options: unknown): Promise<ExecutorDescriptor> {
    this.describeCount += 1
    return this.#descriptor
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

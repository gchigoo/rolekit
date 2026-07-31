export const CAPABILITIES = [
  'repository.read',
  'repository.write',
  'shell',
  'web',
  'vision',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export const RUN_STATUSES = ['completed', 'failed', 'blocked', 'cancelled'] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

export const EXECUTOR_TRANSPORTS = ['cli', 'in-process', 'remote'] as const

export type ExecutorTransport = (typeof EXECUTOR_TRANSPORTS)[number]

export type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

/**
 * A serializable JSON Schema. The phantom property carries the schema's static
 * TypeScript type without adding a runtime field.
 */
export type JsonSchema<T = unknown> = Readonly<Record<string, unknown>> & {
  readonly __rolekitType?: T
}

export interface RoleSpec<TInput = unknown, TOutput = unknown> {
  readonly schema: 'rolekit/role-spec@1'
  readonly id: string
  readonly description: string
  readonly requiredCapabilities: readonly Capability[]
  readonly inputSchema: JsonSchema<TInput>
  readonly outputSchema: JsonSchema<TOutput>
  readonly instructions?: string
}

export type ContextReferenceType = 'text' | 'file' | 'url'

export interface ContextReference {
  readonly id: string
  readonly type: ContextReferenceType
  readonly value: string
  readonly description?: string
}

export interface ExpectedArtifact {
  readonly name: string
  readonly kind: string
  readonly description?: string
}

export interface TaskPacket<TInput = unknown> {
  readonly schema: 'rolekit/task-packet@1'
  readonly taskId: string
  readonly parentTaskId?: string
  readonly roleId: string
  readonly objective: string
  readonly input: TInput
  readonly context: readonly ContextReference[]
  readonly constraints: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly requiredCapabilities?: readonly Capability[]
  readonly allowedPaths?: readonly string[]
  readonly expectedArtifacts: readonly ExpectedArtifact[]
  readonly metadata?: JsonObject
}

export interface ExecutorArtifact {
  readonly name: string
  readonly kind: string
  readonly uri?: string
  readonly content?: JsonValue
  readonly mediaType?: string
  readonly metadata?: JsonObject
}

export interface ArtifactProvenance {
  readonly runId: string
  readonly executorId: string
}

export interface ArtifactRef extends ExecutorArtifact {
  readonly provenance: ArtifactProvenance
}

export type EvidenceKind = 'command' | 'file' | 'url' | 'note'

export interface EvidenceRef {
  readonly kind: EvidenceKind
  readonly value: string
  readonly description?: string
}

export interface TokenUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedInputTokens?: number
  readonly durationMs?: number
  readonly costUsd?: number
}

export interface ExecutionError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details?: JsonObject
}

export interface ExecutorDescriptor {
  readonly id: string
  readonly displayName: string
  readonly transport: ExecutorTransport
  readonly capabilities: readonly Capability[]
  readonly available: boolean
  readonly model?: string
  readonly version?: string
  readonly diagnostic?: string
}

export interface ExecutorIdentity {
  readonly id: string
  readonly transport: ExecutorTransport
  readonly model?: string
  readonly version?: string
}

export interface ExecutorResponse<TOutput = unknown> {
  readonly status: RunStatus
  readonly summary: string
  readonly output?: TOutput
  readonly artifacts: readonly ExecutorArtifact[]
  readonly evidence: readonly EvidenceRef[]
  readonly usage?: TokenUsage
  readonly error?: ExecutionError
  readonly model?: string
  readonly version?: string
}

export interface RunResult<TOutput = unknown> {
  readonly schema: 'rolekit/run-result@1'
  readonly runId: string
  readonly taskId: string
  readonly roleId: string
  readonly status: RunStatus
  readonly executor: ExecutorIdentity
  readonly summary: string
  readonly output?: TOutput
  readonly artifacts: readonly ArtifactRef[]
  readonly evidence: readonly EvidenceRef[]
  readonly usage: TokenUsage
  readonly error?: ExecutionError
  readonly createdAt: string
}

export interface ExecutionContext<TOptions = unknown> {
  readonly runId: string
  readonly cwd: string
  readonly options: TOptions
  readonly signal?: AbortSignal
}

export interface ExecutorAdapter<TOptions = unknown> {
  readonly id: string
  describe(options: TOptions): Promise<ExecutorDescriptor>
  execute(
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<TOptions>,
  ): Promise<ExecutorResponse>
  cancel?(runId: string): Promise<void>
}

export interface RunOptions<TOptions = unknown> {
  readonly executorId: string
  readonly cwd: string
  readonly adapterOptions: TOptions
  readonly runId?: string
  readonly signal?: AbortSignal
}

export interface RolekitOptions {
  readonly roles?: readonly RoleSpec[]
  readonly adapters?: readonly ExecutorAdapter[]
  readonly createRunId?: () => string
  readonly now?: () => Date
}

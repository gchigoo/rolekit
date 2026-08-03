import type { PortableJsonSchema } from './json.ts'

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

export type Sha256Digest = `sha256:${string}`

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

export type SnapshotRoleSpec = Readonly<
  Omit<RoleSpec, 'inputSchema' | 'outputSchema'> & {
    readonly inputSchema: PortableJsonSchema
    readonly outputSchema: PortableJsonSchema
  }
>

export type SnapshotTaskPacket = Readonly<TaskPacket<JsonValue>>

export interface ExecutionContract {
  readonly schema: 'rolekit/execution-contract@1'
  readonly role: {
    readonly id: string
    readonly description: string
    readonly instructions?: string
  }
  readonly requiredCapabilities: readonly Capability[]
  readonly task: {
    readonly taskId: string
    readonly parentTaskId?: string
    readonly objective: string
    readonly input: JsonValue
    readonly context: readonly ContextReference[]
    readonly constraints: readonly string[]
    readonly acceptanceCriteria: readonly string[]
    readonly allowedPaths?: readonly string[]
    readonly expectedArtifacts: readonly ExpectedArtifact[]
    readonly metadata?: JsonObject
  }
  readonly outputContract: {
    readonly roleOutputSchema: JsonObject
    readonly finalResponseRules: typeof import('./execution-contract.ts').EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES
  }
}

export interface ExecutorArtifactBase {
  readonly name: string
  readonly kind: string
  readonly mediaType?: string
  readonly metadata?: JsonObject
}

export type ExecutorArtifact = ExecutorArtifactBase &
  (
    | { readonly content: JsonValue; readonly uri?: string }
    | { readonly uri: string; readonly content?: JsonValue }
  )

export interface ArtifactProvenance {
  readonly runId: string
  readonly executorId: string
}

/** Immutable RunResult v1 compatibility artifact; payload remains optional. */
export interface ArtifactRef extends ExecutorArtifactBase {
  readonly uri?: string
  readonly content?: JsonValue
  readonly provenance: ArtifactProvenance
}

export interface ArtifactProvenanceV2 extends ArtifactProvenance {
  readonly planDigest: Sha256Digest
}

export type ArtifactRefV2 = ExecutorArtifact & {
  readonly provenance: ArtifactProvenanceV2
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

export type AgentEvent =
  | {
      readonly type: 'lifecycle'
      readonly phase: 'started' | 'completed' | 'failed' | 'blocked' | 'cancelled'
    }
  | { readonly type: 'assistant.delta'; readonly text: string }
  | { readonly type: 'tool.started'; readonly tool: string; readonly callId?: string }
  | {
      readonly type: 'tool.completed'
      readonly tool: string
      readonly callId?: string
      readonly success: boolean
    }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | {
      readonly type: 'diagnostic'
      readonly level: 'info' | 'warning' | 'error'
      readonly message: string
    }

export type AdapterEvent = Exclude<AgentEvent, { readonly type: 'lifecycle' }>

export interface RunEventMetadata {
  readonly runId: string
  readonly sequence: number
  readonly createdAt: string
}

export type RunEvent = AgentEvent & RunEventMetadata

export interface ExecutionError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details?: JsonObject
}

/** Stored-document compatibility for the pre-protocol descriptor shape. */
export interface ExecutorDescriptorV1 {
  readonly id: string
  readonly displayName: string
  readonly transport: ExecutorTransport
  readonly capabilities: readonly Capability[]
  readonly available: boolean
  readonly model?: string
  readonly version?: string
  readonly diagnostic?: string
}

export interface ContextIsolation {
  readonly userConfig: 'isolated' | 'inherited' | 'unknown'
  readonly projectInstructions: 'isolated' | 'inherited' | 'unknown'
  readonly projectResources: 'isolated' | 'inherited' | 'unknown'
  readonly environment: 'minimal' | 'inherited' | 'unknown'
  readonly credentials: 'explicit' | 'user-store' | 'inherited' | 'unknown'
}

export interface ExecutorSupportFeatures {
  readonly structuredOutput: 'native' | 'prompt' | 'none'
  readonly events: boolean
  readonly cancellation: 'process' | 'protocol' | 'none'
  readonly contextIsolation: ContextIsolation
  readonly supportedPathEnforcement: readonly ('advisory' | 'adapter' | 'host')[]
  readonly permissionCombinations: readonly string[]
}

export interface ExecutorDescriptorV2 {
  readonly schema: 'rolekit/executor-descriptor@2'
  readonly adapterProtocol: 'rolekit/executor-adapter@1'
  readonly adapterVersion: string
  readonly id: string
  readonly displayName: string
  readonly transport: ExecutorTransport
  readonly capabilities: readonly Capability[]
  readonly features: ExecutorSupportFeatures
}

/** The active adapter protocol descriptor. V1 remains a document-only contract. */
export type ExecutorDescriptor = ExecutorDescriptorV2

export type PublicSecretMarker =
  | { readonly source: 'env'; readonly name: string; readonly redacted: true }
  | { readonly source: 'literal'; readonly redacted: true }

export interface PublicOptionContext {
  readonly replacementsByJsonPointer: Readonly<Record<string, PublicSecretMarker>>
}

export interface PreparedExecutorOptions<TOptions = unknown> {
  readonly executionOptions: Readonly<TOptions>
  readonly publicOptions: JsonObject
  readonly sensitiveValues: readonly string[]
  readonly requestedProvider?: string
  readonly requestedModel?: string
}

export interface ProbeContext {
  readonly cwd: string
  readonly signal?: AbortSignal
}

export type ExecutorProbe =
  | {
      readonly available: true
      readonly executorVersion?: string
      readonly featureChecks: Readonly<Record<string, boolean>>
      readonly diagnostic?: string
    }
  | {
      readonly available: false
      readonly executorVersion?: string
      readonly featureChecks: Readonly<Record<string, boolean>>
      readonly diagnostic: string
    }

export type ExecutionAdmission =
  | {
      readonly allowed: true
      readonly effectiveCapabilities: readonly Capability[]
      readonly effectivePublicOptions: JsonObject
      readonly pathEnforcement: 'advisory' | 'adapter' | 'host'
      readonly contextIsolation: ContextIsolation
      readonly blockedError?: never
    }
  | {
      readonly allowed: false
      readonly effectiveCapabilities: readonly Capability[]
      readonly effectivePublicOptions: JsonObject
      readonly pathEnforcement: 'advisory' | 'adapter' | 'host'
      readonly contextIsolation: ContextIsolation
      readonly blockedError: ExecutionError
    }

interface ExecutionPlanExecutorBase {
  readonly id: string
  readonly transport: ExecutorTransport
  readonly profileId?: string
  readonly profileDigest?: Sha256Digest
  readonly requestedProvider?: string
  readonly requestedModel?: string
  readonly publicOptions: JsonObject
  readonly optionsDigest: Sha256Digest
  readonly requiredSecrets: readonly string[]
}

export type ExecutionPlanExecutor = ExecutionPlanExecutorBase &
  (
    | {
        readonly target: 'adapter'
        readonly capabilitySource: 'adapter-verified'
        readonly adapterProtocol: 'rolekit/executor-adapter@1'
        readonly adapterVersion: string
      }
    | {
        readonly target: 'host'
        readonly capabilitySource: 'host-attested'
        readonly adapterProtocol?: never
        readonly adapterVersion?: never
      }
  )

export interface ExecutionPlanContent {
  readonly schema: 'rolekit/execution-plan-content@1'
  readonly role: { readonly snapshot: SnapshotRoleSpec; readonly digest: Sha256Digest }
  readonly task: { readonly snapshot: SnapshotTaskPacket; readonly digest: Sha256Digest }
  readonly contract: ExecutionContract
  readonly contractDigest: Sha256Digest
  readonly executor: ExecutionPlanExecutor
  readonly workspace: {
    readonly root: string
    readonly revision?: string
  }
  readonly policy: {
    readonly admission:
      | { readonly allowed: true }
      | { readonly allowed: false; readonly error: ExecutionError }
    readonly requiredCapabilities: readonly Capability[]
    readonly allowedPaths: readonly string[]
    readonly pathEnforcement: 'advisory' | 'adapter' | 'host'
    readonly contextIsolation: ContextIsolation
  }
}

export interface ExecutionPlan {
  readonly schema: 'rolekit/execution-plan@1'
  readonly runId: string
  readonly createdAt: string
  readonly content: ExecutionPlanContent
  readonly contentDigest: Sha256Digest
}

export interface ResolvedExecutionPlan {
  readonly plan: ExecutionPlan
  readonly planDigest: Sha256Digest
}

export interface ActualExecutorIdentityV2 {
  readonly id: string
  readonly transport: ExecutorTransport
  readonly executorVersion?: string
  readonly actualProvider?: string
  readonly actualModel?: string
}

export interface ExecutionReceipt {
  readonly schema: 'rolekit/execution-receipt@1'
  readonly planDigest: Sha256Digest
  readonly runId: string
  readonly taskId: string
  readonly roleId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly actualExecutor: ActualExecutorIdentityV2
  readonly response: unknown
}

export interface ExecutionTargetInputBase {
  readonly id: string
  readonly transport: ExecutorTransport
  readonly profileId?: string
  readonly profileDigest?: Sha256Digest
  readonly requestedProvider?: string
  readonly requestedModel?: string
  readonly requiredSecrets: readonly string[]
  readonly admission: ExecutionAdmission
}

export type ExecutionTargetInput = ExecutionTargetInputBase &
  (
    | {
        readonly target: 'adapter'
        readonly capabilitySource: 'adapter-verified'
        readonly adapterProtocol: 'rolekit/executor-adapter@1'
        readonly adapterVersion: string
      }
    | {
        readonly target: 'host'
        readonly capabilitySource: 'host-attested'
        readonly adapterProtocol?: never
        readonly adapterVersion?: never
      }
  )

export interface CreateExecutionPlanInput {
  readonly role: SnapshotRoleSpec
  readonly task: SnapshotTaskPacket
  readonly target: ExecutionTargetInput
  readonly workspace: { readonly root: string; readonly revision?: string }
  readonly runId: string
  readonly createdAt: string
}

export interface ExecutorProfileProvenanceInput {
  readonly id: string
  readonly digest: Sha256Digest
  readonly requiredSecrets: readonly string[]
}

export interface ExecutorIdentity {
  readonly id: string
  readonly transport: ExecutorTransport
  readonly model?: string
  readonly version?: string
}

export type ExecutorResponse<TOutput = unknown> =
  | {
      readonly status: 'completed'
      readonly summary: string
      readonly output: TOutput
      readonly artifacts: readonly ExecutorArtifact[]
      readonly evidence: readonly EvidenceRef[]
      readonly usage?: TokenUsage
      readonly error?: never
      readonly provider?: string
      readonly model?: string
      readonly version?: string
    }
  | {
      readonly status: 'failed' | 'blocked' | 'cancelled'
      readonly summary: string
      readonly output?: never
      readonly artifacts: readonly ExecutorArtifact[]
      readonly evidence: readonly EvidenceRef[]
      readonly usage?: TokenUsage
      readonly error: ExecutionError
      readonly provider?: string
      readonly model?: string
      readonly version?: string
    }

export interface RunResultV1<TOutput = unknown> {
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

export type RunResult<TOutput = unknown> = RunResultV2<TOutput>

interface RunResultExecutorV2Base {
  readonly id: string
  readonly transport: ExecutorTransport
  readonly executorVersion?: string
  readonly requestedProvider?: string
  readonly requestedModel?: string
  readonly actualProvider?: string
  readonly actualModel?: string
  readonly profileId?: string
  readonly profileDigest?: Sha256Digest
}

export type RunResultExecutorV2 = RunResultExecutorV2Base &
  (
    | {
        readonly capabilitySource: 'adapter-verified'
        readonly adapterProtocol: 'rolekit/executor-adapter@1'
        readonly adapterVersion: string
      }
    | {
        readonly capabilitySource: 'host-attested'
        readonly adapterProtocol?: never
        readonly adapterVersion?: never
      }
  )

interface RunResultV2Base {
  readonly schema: 'rolekit/run-result@2'
  readonly runId: string
  readonly taskId: string
  readonly roleId: string
  readonly execution: {
    readonly planDigest: Sha256Digest
    readonly contentDigest: Sha256Digest
    readonly roleDigest: Sha256Digest
    readonly taskDigest: Sha256Digest
    readonly contractDigest: Sha256Digest
    readonly optionsDigest: Sha256Digest
  }
  readonly policy: ExecutionPlanContent['policy']
  readonly executor: RunResultExecutorV2
  readonly summary: string
  readonly artifacts: readonly ArtifactRefV2[]
  readonly evidence: readonly EvidenceRef[]
  readonly usage: TokenUsage
  readonly startedAt: string
  readonly completedAt: string
}

export type RunResultV2<TOutput = unknown> = RunResultV2Base &
  (
    | {
        readonly status: 'completed'
        readonly output: TOutput
        readonly error?: never
      }
    | {
        readonly status: 'failed' | 'blocked' | 'cancelled'
        readonly output?: never
        readonly error: ExecutionError
      }
  )

export type LatestRunResult<TOutput = unknown> = RunResultV2<TOutput>

export type AnyRunResult<TOutput = unknown> = RunResultV2<TOutput>

export interface ExecutionContext<TOptions = unknown> {
  readonly runId: string
  readonly cwd: string
  readonly options: TOptions
  readonly admission: ExecutionAdmission
  readonly sensitiveValues: readonly string[]
  readonly signal?: AbortSignal
  readonly emitEvent?: (event: AdapterEvent) => void
}

export interface ExecutorAdapter<TOptions = unknown> {
  readonly id: string
  /** JSON Pointer roots under which public redaction markers may appear. */
  readonly sensitiveOptionPointers?: readonly string[]
  prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<TOptions>
  inspect(prepared: PreparedExecutorOptions<TOptions>): ExecutorDescriptorV2
  /**
   * Produces a typed, credential-free snapshot for config-driven static probes.
   * Secret-bearing profiles without this hook are not passed to probe().
   */
  prepareProbeOptions?(
    prepared: PreparedExecutorOptions<TOptions>,
  ): PreparedExecutorOptions<TOptions>
  probe(prepared: PreparedExecutorOptions<TOptions>, context: ProbeContext): Promise<ExecutorProbe>
  admit(
    role: RoleSpec,
    task: TaskPacket,
    prepared: PreparedExecutorOptions<TOptions>,
    probe?: ExecutorProbe,
  ): ExecutionAdmission
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
  readonly profile?: ExecutorProfileProvenanceInput
  readonly publicOptionContext?: PublicOptionContext
  readonly runId?: string
  readonly signal?: AbortSignal
  readonly onEvent?: (event: RunEvent) => void
}

export interface CompileOptions<TOptions = unknown> {
  readonly executorId: string
  readonly adapterOptions: TOptions
  readonly publicOptionContext?: PublicOptionContext
}

export interface ExecutionCompilation {
  readonly descriptor: ExecutorDescriptorV2
  readonly admission: ExecutionAdmission
  readonly publicOptions: JsonObject
}

export type RolekitLogger = (event: Extract<AdapterEvent, { readonly type: 'diagnostic' }>) => void

export interface RolekitOptions {
  readonly roles?: readonly RoleSpec[]
  readonly adapters?: readonly ExecutorAdapter[]
  readonly createRunId?: () => string
  readonly now?: () => Date
  readonly logger?: RolekitLogger
}

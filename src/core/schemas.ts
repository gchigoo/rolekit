import { type TSchema, Type } from '@sinclair/typebox'
import type { JsonSchema } from './types.ts'
import { CAPABILITIES, EXECUTOR_TRANSPORTS, RUN_STATUSES } from './types.ts'

const IdentifierSchema = Type.String({
  minLength: 1,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$',
})

const NonEmptyStringSchema = Type.String({ minLength: 1 })

export const CapabilitySchema = Type.Union(
  CAPABILITIES.map((capability) => Type.Literal(capability)),
)

export const RunStatusSchema = Type.Union(RUN_STATUSES.map((status) => Type.Literal(status)))

export const ExecutorTransportSchema = Type.Union(
  EXECUTOR_TRANSPORTS.map((transport) => Type.Literal(transport)),
)

const JsonSchemaSchema = Type.Record(Type.String(), Type.Unknown())

export const ContextReferenceSchema = Type.Object(
  {
    id: IdentifierSchema,
    type: Type.Union([Type.Literal('text'), Type.Literal('file'), Type.Literal('url')]),
    value: NonEmptyStringSchema,
    description: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
)

export const ExpectedArtifactSchema = Type.Object(
  {
    name: IdentifierSchema,
    kind: NonEmptyStringSchema,
    description: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
)

export const ExecutorArtifactSchema = Type.Object(
  {
    name: IdentifierSchema,
    kind: NonEmptyStringSchema,
    uri: Type.Optional(NonEmptyStringSchema),
    content: Type.Optional(Type.Unknown()),
    mediaType: Type.Optional(NonEmptyStringSchema),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)

export const ArtifactRefSchema = Type.Object(
  {
    name: IdentifierSchema,
    kind: NonEmptyStringSchema,
    uri: Type.Optional(NonEmptyStringSchema),
    content: Type.Optional(Type.Unknown()),
    mediaType: Type.Optional(NonEmptyStringSchema),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    provenance: Type.Object(
      {
        runId: NonEmptyStringSchema,
        executorId: IdentifierSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const EvidenceRefSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('command'),
      Type.Literal('file'),
      Type.Literal('url'),
      Type.Literal('note'),
    ]),
    value: NonEmptyStringSchema,
    description: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
)

export const TokenUsageSchema = Type.Object(
  {
    inputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    outputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    totalTokens: Type.Optional(Type.Number({ minimum: 0 })),
    cachedInputTokens: Type.Optional(Type.Number({ minimum: 0 })),
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    costUsd: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
)

export const ExecutionErrorSchema = Type.Object(
  {
    code: IdentifierSchema,
    message: NonEmptyStringSchema,
    retryable: Type.Boolean(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)

export const RoleSpecSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/role-spec@1'),
    id: IdentifierSchema,
    description: NonEmptyStringSchema,
    requiredCapabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
    inputSchema: JsonSchemaSchema,
    outputSchema: JsonSchemaSchema,
    instructions: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false, $id: 'https://rolekit.dev/schemas/role-spec.v1.json' },
)

export const TaskPacketSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/task-packet@1'),
    taskId: IdentifierSchema,
    parentTaskId: Type.Optional(IdentifierSchema),
    roleId: IdentifierSchema,
    objective: NonEmptyStringSchema,
    input: Type.Unknown(),
    context: Type.Array(ContextReferenceSchema),
    constraints: Type.Array(NonEmptyStringSchema),
    acceptanceCriteria: Type.Array(NonEmptyStringSchema),
    requiredCapabilities: Type.Optional(Type.Array(CapabilitySchema, { uniqueItems: true })),
    allowedPaths: Type.Optional(Type.Array(NonEmptyStringSchema, { uniqueItems: true })),
    expectedArtifacts: Type.Array(ExpectedArtifactSchema),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false, $id: 'https://rolekit.dev/schemas/task-packet.v1.json' },
)

export const ExecutorDescriptorSchema = Type.Object(
  {
    id: IdentifierSchema,
    displayName: NonEmptyStringSchema,
    transport: ExecutorTransportSchema,
    capabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
    available: Type.Boolean(),
    model: Type.Optional(NonEmptyStringSchema),
    version: Type.Optional(NonEmptyStringSchema),
    diagnostic: Type.Optional(NonEmptyStringSchema),
  },
  {
    additionalProperties: false,
    $id: 'https://rolekit.dev/schemas/executor-descriptor.v1.json',
  },
)

export const ExecutorResponseSchema = Type.Object(
  {
    status: RunStatusSchema,
    summary: NonEmptyStringSchema,
    output: Type.Optional(Type.Unknown()),
    artifacts: Type.Array(ExecutorArtifactSchema),
    evidence: Type.Array(EvidenceRefSchema),
    usage: Type.Optional(TokenUsageSchema),
    error: Type.Optional(ExecutionErrorSchema),
    model: Type.Optional(NonEmptyStringSchema),
    version: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
)

export const RunResultSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/run-result@1'),
    runId: NonEmptyStringSchema,
    taskId: IdentifierSchema,
    roleId: IdentifierSchema,
    status: RunStatusSchema,
    executor: Type.Object(
      {
        id: IdentifierSchema,
        transport: ExecutorTransportSchema,
        model: Type.Optional(NonEmptyStringSchema),
        version: Type.Optional(NonEmptyStringSchema),
      },
      { additionalProperties: false },
    ),
    summary: NonEmptyStringSchema,
    output: Type.Optional(Type.Unknown()),
    artifacts: Type.Array(ArtifactRefSchema),
    evidence: Type.Array(EvidenceRefSchema),
    usage: TokenUsageSchema,
    error: Type.Optional(ExecutionErrorSchema),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false, $id: 'https://rolekit.dev/schemas/run-result.v1.json' },
)

export function createExecutorPayloadSchema(outputSchema: JsonSchema): JsonSchema {
  const completed = Type.Object(
    {
      status: Type.Literal('completed'),
      summary: NonEmptyStringSchema,
      output: outputSchema as TSchema,
      artifacts: Type.Array(ExecutorArtifactSchema),
      evidence: Type.Array(EvidenceRefSchema),
      usage: Type.Optional(TokenUsageSchema),
    },
    { additionalProperties: false },
  )

  const notCompleted = Type.Object(
    {
      status: Type.Union([
        Type.Literal('failed'),
        Type.Literal('blocked'),
        Type.Literal('cancelled'),
      ]),
      summary: NonEmptyStringSchema,
      artifacts: Type.Array(ExecutorArtifactSchema),
      evidence: Type.Array(EvidenceRefSchema),
      usage: Type.Optional(TokenUsageSchema),
      error: ExecutionErrorSchema,
    },
    { additionalProperties: false },
  )

  return Type.Union([completed, notCompleted]) as JsonSchema
}

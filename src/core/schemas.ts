import { Type } from '@sinclair/typebox'
import uriResolverImport from 'ajv/dist/runtime/uri.js'

import { EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES } from './execution-contract.ts'
import { canonicalJson, normalizeJsonSchema, type PortableJsonSchema } from './json.ts'
import type { JsonSchema, JsonValue } from './types.ts'
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

const JsonValueReference = { $ref: '#/$defs/jsonValue' } as const

const JsonValueDefinition = {
  anyOf: [
    { type: 'null' },
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string' },
    { type: 'array', items: JsonValueReference },
    { type: 'object', additionalProperties: JsonValueReference },
  ],
} as const

const JsonValueDefinitions = { jsonValue: JsonValueDefinition } as const

const ExecutorPayloadSchemaId = 'https://rolekit.dev/internal/executor-payload'

interface UriResolver {
  normalize(uri: string): string
  resolve(base: string, reference: string): string
}

const uriResolverCandidate = uriResolverImport as unknown as UriResolver & {
  readonly default?: UriResolver
}
const uriResolver = uriResolverCandidate.default ?? uriResolverCandidate

const schemaMapKeywords = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])

const schemaArrayKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

const schemaValueKeywords = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value)
}

function stripEmptyFragment(uri: string): string {
  return uri.endsWith('#') ? uri.slice(0, -1) : uri
}

function canonicalSchemaUri(reference: string, activeBase: string): string {
  return stripEmptyFragment(uriResolver.normalize(uriResolver.resolve(activeBase, reference)))
}

function schemaFingerprint(schema: PortableJsonSchema): string {
  const canonical = canonicalJson(schema, 'Executor output schema')
  let hash = 0x6c62272e07bb014262b821756295c58dn
  const prime = 0x0000000001000000000000000000013bn
  for (let index = 0; index < canonical.length; index += 1) {
    const codeUnit = canonical.charCodeAt(index)
    hash ^= BigInt(codeUnit & 0xff)
    hash = BigInt.asUintN(128, hash * prime)
    hash ^= BigInt(codeUnit >>> 8)
    hash = BigInt.asUintN(128, hash * prime)
  }
  return hash.toString(16).padStart(32, '0')
}

function visitSchemaChildren(
  schema: Readonly<Record<string, JsonValue>>,
  visitor: (child: JsonValue) => void,
): void {
  for (const [key, value] of Object.entries(schema)) {
    if (schemaMapKeywords.has(key) && value !== null && typeof value === 'object') {
      if (!isJsonArray(value)) {
        for (const child of Object.values(value)) {
          visitor(child)
        }
      }
      continue
    }
    if (schemaArrayKeywords.has(key) && isJsonArray(value)) {
      for (const child of value) {
        visitor(child)
      }
      continue
    }
    if (schemaValueKeywords.has(key)) {
      if (isJsonArray(value)) {
        for (const child of value) {
          visitor(child)
        }
      } else {
        visitor(value)
      }
      continue
    }
    if (
      key === 'dependencies' &&
      value !== null &&
      typeof value === 'object' &&
      !isJsonArray(value)
    ) {
      for (const child of Object.values(value)) {
        if (!isJsonArray(child)) {
          visitor(child)
        }
      }
    }
  }
}

function collectSchemaIds(value: JsonValue, activeBase: string, ids: Set<string>): void {
  if (value === null || typeof value !== 'object' || isJsonArray(value)) {
    return
  }

  let resourceBase = activeBase
  if (typeof value.$id === 'string') {
    const resolvedId = canonicalSchemaUri(value.$id, activeBase)
    if (resolvedId !== activeBase) {
      ids.add(resolvedId)
      resourceBase = resolvedId
    }
  }

  visitSchemaChildren(value, (child) => collectSchemaIds(child, resourceBase, ids))
}

function uniqueSchemaId(base: string, existingIds: Set<string>): string {
  let id = base
  let suffix = 1
  while (existingIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  existingIds.add(id)
  return id
}

function payloadResourceIdentity(schema: PortableJsonSchema): {
  readonly existingIds: Set<string>
  readonly payloadId: string
} {
  const base = `${ExecutorPayloadSchemaId}/${schemaFingerprint(schema)}`
  let payloadId = base
  let suffix = 1
  while (true) {
    const existingIds = new Set<string>()
    collectSchemaIds(schema, payloadId, existingIds)
    if (!existingIds.has(payloadId)) {
      return { existingIds, payloadId }
    }
    payloadId = `${base}-${suffix}`
    suffix += 1
  }
}

function rebaseRootReference(
  reference: string,
  activeBase: string,
  outputLocation: string,
  dynamicReference: boolean,
): string {
  if (reference === '' || reference === '#') {
    return dynamicReference ? '#' : outputLocation
  }
  if (reference.startsWith('#/')) {
    return dynamicReference ? reference : `${outputLocation}${reference.slice(1)}`
  }
  if (reference.startsWith('#')) {
    return reference
  }
  return canonicalSchemaUri(reference, activeBase)
}

function rebaseSchemaResource(
  schema: JsonValue,
  activeBase: string,
  outputLocation: string,
  outputId: string,
  resourceRoot: boolean,
  rebaseReferences: boolean,
): JsonValue {
  if (schema === null || typeof schema !== 'object') {
    return schema
  }
  if (isJsonArray(schema)) {
    return schema.map((item) =>
      rebaseSchemaResource(item, activeBase, outputLocation, outputId, false, rebaseReferences),
    )
  }

  const rawId = typeof schema.$id === 'string' ? schema.$id : undefined
  const resolvedId = rawId === undefined ? activeBase : canonicalSchemaUri(rawId, activeBase)
  const independentResource = rawId !== undefined && resolvedId !== activeBase
  const resourceBase = independentResource ? resolvedId : activeBase
  const currentRebaseReferences = rebaseReferences && (resourceRoot || !independentResource)
  const childRebaseReferences = currentRebaseReferences
  const rebased: Record<string, JsonValue> = {}

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$id') {
      if (resourceRoot) {
        rebased[key] = outputId
      } else if (independentResource) {
        rebased[key] = resolvedId
      }
      continue
    }
    if ((key === '$ref' || key === '$dynamicRef') && typeof value === 'string') {
      rebased[key] = currentRebaseReferences
        ? rebaseRootReference(value, resourceBase, outputLocation, key === '$dynamicRef')
        : value === ''
          ? '#'
          : value
      continue
    }
    if (schemaMapKeywords.has(key) && value !== null && typeof value === 'object') {
      if (isJsonArray(value)) {
        rebased[key] = value
      } else {
        rebased[key] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [
            name,
            rebaseSchemaResource(
              child,
              resourceBase,
              outputLocation,
              outputId,
              false,
              childRebaseReferences,
            ),
          ]),
        )
      }
      continue
    }
    if (schemaArrayKeywords.has(key) && isJsonArray(value)) {
      rebased[key] = value.map((child) =>
        rebaseSchemaResource(
          child,
          resourceBase,
          outputLocation,
          outputId,
          false,
          childRebaseReferences,
        ),
      )
      continue
    }
    if (schemaValueKeywords.has(key)) {
      rebased[key] = isJsonArray(value)
        ? value.map((child) =>
            rebaseSchemaResource(
              child,
              resourceBase,
              outputLocation,
              outputId,
              false,
              childRebaseReferences,
            ),
          )
        : rebaseSchemaResource(
            value,
            resourceBase,
            outputLocation,
            outputId,
            false,
            childRebaseReferences,
          )
      continue
    }
    if (
      key === 'dependencies' &&
      value !== null &&
      typeof value === 'object' &&
      !isJsonArray(value)
    ) {
      rebased[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          isJsonArray(child)
            ? child
            : rebaseSchemaResource(
                child,
                resourceBase,
                outputLocation,
                outputId,
                false,
                childRebaseReferences,
              ),
        ]),
      )
      continue
    }
    rebased[key] = value
  }

  if (resourceRoot && rawId === undefined) {
    rebased.$id = outputId
  }
  return rebased
}

interface EmbeddedOutputSchema {
  readonly payloadId: string
  readonly outputId: string
  readonly schema: PortableJsonSchema
}

function embedOutputSchemaResource(schema: PortableJsonSchema): EmbeddedOutputSchema {
  const { existingIds, payloadId } = payloadResourceIdentity(schema)
  const outputLocation = `${payloadId}#/$defs/roleOutput`
  const resolvedRootId =
    typeof schema.$id === 'string' ? canonicalSchemaUri(schema.$id, payloadId) : payloadId
  const outputId =
    resolvedRootId === payloadId
      ? uniqueSchemaId(`${payloadId}/role-output`, existingIds)
      : resolvedRootId
  const rebased = rebaseSchemaResource(schema, payloadId, outputLocation, outputId, true, true)
  if (rebased === null || typeof rebased !== 'object' || isJsonArray(rebased)) {
    throw new Error('Embedded role output schema is not a JSON object.')
  }
  return {
    payloadId,
    outputId,
    schema: rebased,
  }
}

function createStrictExecutorArtifactSchema(includeDefinitions: boolean): JsonSchema {
  return {
    ...(includeDefinitions ? { $defs: JsonValueDefinitions } : {}),
    additionalProperties: false,
    anyOf: [{ required: ['content'] }, { required: ['uri'] }],
    type: 'object',
    required: ['name', 'kind'],
    properties: {
      name: IdentifierSchema,
      kind: NonEmptyStringSchema,
      uri: NonEmptyStringSchema,
      content: JsonValueReference,
      mediaType: NonEmptyStringSchema,
      metadata: {
        type: 'object',
        additionalProperties: JsonValueReference,
      },
    },
  }
}

export const ExecutorArtifactSchema = createStrictExecutorArtifactSchema(true)

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

const StrictTokenUsageSchema = Type.Object(
  {
    inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    totalTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    cachedInputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    costUsd: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
)

const LifecycleEventProperties = {
  type: Type.Literal('lifecycle'),
  phase: Type.Union(
    ['started', 'completed', 'failed', 'blocked', 'cancelled'].map((phase) => Type.Literal(phase)),
  ),
} as const

const AssistantDeltaEventProperties = {
  type: Type.Literal('assistant.delta'),
  text: Type.String(),
} as const

const ToolStartedEventProperties = {
  type: Type.Literal('tool.started'),
  tool: Type.String(),
  callId: Type.Optional(Type.String()),
} as const

const ToolCompletedEventProperties = {
  type: Type.Literal('tool.completed'),
  tool: Type.String(),
  callId: Type.Optional(Type.String()),
  success: Type.Boolean(),
} as const

const UsageEventProperties = {
  type: Type.Literal('usage'),
  usage: StrictTokenUsageSchema,
} as const

const DiagnosticEventProperties = {
  type: Type.Literal('diagnostic'),
  level: Type.Union(['info', 'warning', 'error'].map((level) => Type.Literal(level))),
  message: Type.String(),
} as const

const AdapterEventSchemas = [
  Type.Object(AssistantDeltaEventProperties, { additionalProperties: false }),
  Type.Object(ToolStartedEventProperties, { additionalProperties: false }),
  Type.Object(ToolCompletedEventProperties, { additionalProperties: false }),
  Type.Object(UsageEventProperties, { additionalProperties: false }),
  Type.Object(DiagnosticEventProperties, { additionalProperties: false }),
]

export const AdapterEventSchema = Type.Union(AdapterEventSchemas)

export const AgentEventSchema = Type.Union([
  Type.Object(LifecycleEventProperties, { additionalProperties: false }),
  ...AdapterEventSchemas,
])

const RunEventMetadataProperties = {
  runId: NonEmptyStringSchema,
  sequence: Type.Integer({ minimum: 1 }),
  createdAt: Type.String({ format: 'date-time' }),
} as const

export const RunEventSchema = Type.Union([
  Type.Object(
    { ...LifecycleEventProperties, ...RunEventMetadataProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...AssistantDeltaEventProperties, ...RunEventMetadataProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...ToolStartedEventProperties, ...RunEventMetadataProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...ToolCompletedEventProperties, ...RunEventMetadataProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...UsageEventProperties, ...RunEventMetadataProperties },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...DiagnosticEventProperties, ...RunEventMetadataProperties },
    { additionalProperties: false },
  ),
])

function createStrictExecutionErrorSchema(): JsonSchema {
  return {
    additionalProperties: false,
    type: 'object',
    required: ['code', 'message', 'retryable'],
    properties: {
      code: IdentifierSchema,
      message: NonEmptyStringSchema,
      retryable: { type: 'boolean' },
      details: {
        type: 'object',
        additionalProperties: JsonValueReference,
      },
    },
  }
}

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

export const ExecutorDescriptorV1Schema = Type.Object(
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

export const ContextIsolationSchema = Type.Object(
  {
    userConfig: Type.Union([
      Type.Literal('isolated'),
      Type.Literal('inherited'),
      Type.Literal('unknown'),
    ]),
    projectInstructions: Type.Union([
      Type.Literal('isolated'),
      Type.Literal('inherited'),
      Type.Literal('unknown'),
    ]),
    projectResources: Type.Union([
      Type.Literal('isolated'),
      Type.Literal('inherited'),
      Type.Literal('unknown'),
    ]),
    environment: Type.Union([
      Type.Literal('minimal'),
      Type.Literal('inherited'),
      Type.Literal('unknown'),
    ]),
    credentials: Type.Union([
      Type.Literal('explicit'),
      Type.Literal('user-store'),
      Type.Literal('inherited'),
      Type.Literal('unknown'),
    ]),
  },
  { additionalProperties: false },
)

export const ExecutorSupportFeaturesSchema = Type.Object(
  {
    structuredOutput: Type.Union([
      Type.Literal('native'),
      Type.Literal('prompt'),
      Type.Literal('none'),
    ]),
    events: Type.Boolean(),
    cancellation: Type.Union([
      Type.Literal('process'),
      Type.Literal('protocol'),
      Type.Literal('none'),
    ]),
    contextIsolation: ContextIsolationSchema,
    supportedPathEnforcement: Type.Array(
      Type.Union([Type.Literal('advisory'), Type.Literal('adapter'), Type.Literal('host')]),
      { uniqueItems: true },
    ),
    permissionCombinations: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
)

export const ExecutorDescriptorV2Schema = Type.Object(
  {
    schema: Type.Literal('rolekit/executor-descriptor@2'),
    adapterProtocol: Type.Literal('rolekit/executor-adapter@1'),
    adapterVersion: NonEmptyStringSchema,
    id: IdentifierSchema,
    displayName: NonEmptyStringSchema,
    transport: ExecutorTransportSchema,
    capabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
    features: ExecutorSupportFeaturesSchema,
  },
  {
    additionalProperties: false,
    $id: 'https://rolekit.dev/schemas/executor-descriptor.v2.json',
  },
)

export const ExecutorDescriptorSchema = ExecutorDescriptorV2Schema

export const ExecutorProbeSchema = Type.Union([
  Type.Object(
    {
      available: Type.Literal(true),
      executorVersion: Type.Optional(NonEmptyStringSchema),
      featureChecks: Type.Record(Type.String(), Type.Boolean()),
      diagnostic: Type.Optional(NonEmptyStringSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      available: Type.Literal(false),
      executorVersion: Type.Optional(NonEmptyStringSchema),
      featureChecks: Type.Record(Type.String(), Type.Boolean()),
      diagnostic: NonEmptyStringSchema,
    },
    { additionalProperties: false },
  ),
])

const AdmissionProperties = {
  effectiveCapabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
  effectivePublicOptions: Type.Record(Type.String(), Type.Unknown()),
  pathEnforcement: Type.Union([
    Type.Literal('advisory'),
    Type.Literal('adapter'),
    Type.Literal('host'),
  ]),
  contextIsolation: ContextIsolationSchema,
} as const

export const ExecutionAdmissionSchema = Type.Union([
  Type.Object(
    {
      allowed: Type.Literal(true),
      ...AdmissionProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      allowed: Type.Literal(false),
      ...AdmissionProperties,
      blockedError: ExecutionErrorSchema,
    },
    { additionalProperties: false },
  ),
])

export const Sha256DigestSchema = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })

const ExecutionContractV1FinalResponseRulesSchema = Type.Unsafe<
  typeof EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES
>({
  type: 'array',
  prefixItems: EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES.map((rule) => ({
    const: rule,
    type: 'string',
  })),
  items: false,
  minItems: EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES.length,
  maxItems: EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES.length,
})

const ExecutionContractSchemaProperties = {
  schema: Type.Literal('rolekit/execution-contract@1'),
  role: Type.Object(
    {
      id: IdentifierSchema,
      description: NonEmptyStringSchema,
      instructions: Type.Optional(NonEmptyStringSchema),
    },
    { additionalProperties: false },
  ),
  requiredCapabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
  task: Type.Object(
    {
      taskId: IdentifierSchema,
      parentTaskId: Type.Optional(IdentifierSchema),
      objective: NonEmptyStringSchema,
      input: Type.Unknown(),
      context: Type.Array(ContextReferenceSchema),
      constraints: Type.Array(NonEmptyStringSchema),
      acceptanceCriteria: Type.Array(NonEmptyStringSchema),
      allowedPaths: Type.Optional(Type.Array(NonEmptyStringSchema, { uniqueItems: true })),
      expectedArtifacts: Type.Array(ExpectedArtifactSchema),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  ),
  outputContract: Type.Object(
    {
      roleOutputSchema: Type.Record(Type.String(), Type.Unknown()),
      finalResponseRules: ExecutionContractV1FinalResponseRulesSchema,
    },
    { additionalProperties: false },
  ),
} as const

export const ExecutionContractSchema = Type.Object(ExecutionContractSchemaProperties, {
  additionalProperties: false,
  $id: 'https://rolekit.dev/schemas/execution-contract.v1.json',
})

const PlanAdmissionSchema = Type.Union([
  Type.Object({ allowed: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    { allowed: Type.Literal(false), error: ExecutionErrorSchema },
    { additionalProperties: false },
  ),
])

export const ExecutionPolicySchema = Type.Object(
  {
    admission: PlanAdmissionSchema,
    requiredCapabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
    allowedPaths: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
    pathEnforcement: Type.Union([
      Type.Literal('advisory'),
      Type.Literal('adapter'),
      Type.Literal('host'),
    ]),
    contextIsolation: ContextIsolationSchema,
  },
  { additionalProperties: false },
)

const ExecutionPlanExecutorCommonProperties = {
  id: IdentifierSchema,
  transport: ExecutorTransportSchema,
  profileId: Type.Optional(IdentifierSchema),
  profileDigest: Type.Optional(Sha256DigestSchema),
  requestedProvider: Type.Optional(NonEmptyStringSchema),
  requestedModel: Type.Optional(NonEmptyStringSchema),
  publicOptions: Type.Record(Type.String(), Type.Unknown()),
  optionsDigest: Sha256DigestSchema,
  requiredSecrets: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
} as const

export const ExecutorProfileProvenanceInputSchema = Type.Object(
  {
    id: IdentifierSchema,
    digest: Sha256DigestSchema,
    requiredSecrets: Type.Array(NonEmptyStringSchema),
  },
  { additionalProperties: false },
)

const ExecutionTargetInputCommonProperties = {
  id: IdentifierSchema,
  transport: ExecutorTransportSchema,
  profileId: Type.Optional(IdentifierSchema),
  profileDigest: Type.Optional(Sha256DigestSchema),
  requestedProvider: Type.Optional(NonEmptyStringSchema),
  requestedModel: Type.Optional(NonEmptyStringSchema),
  requiredSecrets: Type.Array(NonEmptyStringSchema),
  admission: ExecutionAdmissionSchema,
} as const

export const ExecutionTargetInputSchema = Type.Union([
  Type.Object(
    {
      target: Type.Literal('adapter'),
      capabilitySource: Type.Literal('adapter-verified'),
      adapterProtocol: Type.Literal('rolekit/executor-adapter@1'),
      adapterVersion: NonEmptyStringSchema,
      ...ExecutionTargetInputCommonProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: Type.Literal('host'),
      capabilitySource: Type.Literal('host-attested'),
      ...ExecutionTargetInputCommonProperties,
    },
    { additionalProperties: false },
  ),
])

const AdapterExecutionPlanExecutorSchema = Type.Object(
  {
    target: Type.Literal('adapter'),
    capabilitySource: Type.Literal('adapter-verified'),
    adapterProtocol: Type.Literal('rolekit/executor-adapter@1'),
    adapterVersion: NonEmptyStringSchema,
    ...ExecutionPlanExecutorCommonProperties,
  },
  { additionalProperties: false },
)

const HostExecutionPlanExecutorSchema = Type.Object(
  {
    target: Type.Literal('host'),
    capabilitySource: Type.Literal('host-attested'),
    ...ExecutionPlanExecutorCommonProperties,
  },
  { additionalProperties: false },
)

export const ExecutionPlanContentSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/execution-plan-content@1'),
    role: Type.Object(
      { snapshot: RoleSpecSchema, digest: Sha256DigestSchema },
      { additionalProperties: false },
    ),
    task: Type.Object(
      { snapshot: TaskPacketSchema, digest: Sha256DigestSchema },
      { additionalProperties: false },
    ),
    contract: Type.Object(ExecutionContractSchemaProperties, { additionalProperties: false }),
    contractDigest: Sha256DigestSchema,
    executor: Type.Union([AdapterExecutionPlanExecutorSchema, HostExecutionPlanExecutorSchema]),
    workspace: Type.Object(
      { root: NonEmptyStringSchema, revision: Type.Optional(NonEmptyStringSchema) },
      { additionalProperties: false },
    ),
    policy: ExecutionPolicySchema,
  },
  {
    additionalProperties: false,
    $id: 'https://rolekit.dev/schemas/execution-plan-content.v1.json',
  },
)

export const ExecutionPlanSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/execution-plan@1'),
    runId: NonEmptyStringSchema,
    createdAt: Type.String({ format: 'date-time' }),
    content: ExecutionPlanContentSchema,
    contentDigest: Sha256DigestSchema,
  },
  { additionalProperties: false, $id: 'https://rolekit.dev/schemas/execution-plan.v1.json' },
)

export const ActualExecutorIdentityV2Schema = Type.Object(
  {
    id: IdentifierSchema,
    transport: ExecutorTransportSchema,
    executorVersion: Type.Optional(NonEmptyStringSchema),
    actualProvider: Type.Optional(NonEmptyStringSchema),
    actualModel: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
)

export const ExecutionReceiptSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/execution-receipt@1'),
    planDigest: Sha256DigestSchema,
    runId: NonEmptyStringSchema,
    taskId: IdentifierSchema,
    roleId: IdentifierSchema,
    startedAt: Type.String({ format: 'date-time' }),
    completedAt: Type.String({ format: 'date-time' }),
    actualExecutor: ActualExecutorIdentityV2Schema,
    response: Type.Unknown(),
  },
  { additionalProperties: false, $id: 'https://rolekit.dev/schemas/execution-receipt.v1.json' },
)

const ExecutorIdentityProperties = {
  provider: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
} as const

function completedExecutorResponseSchema(outputSchema: JsonSchema): JsonSchema {
  return {
    additionalProperties: false,
    type: 'object',
    required: ['status', 'summary', 'output', 'artifacts', 'evidence'],
    properties: {
      status: { const: 'completed', type: 'string' },
      summary: NonEmptyStringSchema,
      output: outputSchema,
      artifacts: {
        type: 'array',
        items: createStrictExecutorArtifactSchema(false),
      },
      evidence: Type.Array(EvidenceRefSchema),
      usage: StrictTokenUsageSchema,
      ...ExecutorIdentityProperties,
    },
  }
}

function nonCompletedExecutorResponseSchema(): JsonSchema {
  return {
    additionalProperties: false,
    type: 'object',
    required: ['status', 'summary', 'artifacts', 'evidence', 'error'],
    properties: {
      status: {
        anyOf: [
          { const: 'failed', type: 'string' },
          { const: 'blocked', type: 'string' },
          { const: 'cancelled', type: 'string' },
        ],
      },
      summary: NonEmptyStringSchema,
      artifacts: {
        type: 'array',
        items: createStrictExecutorArtifactSchema(false),
      },
      evidence: Type.Array(EvidenceRefSchema),
      usage: StrictTokenUsageSchema,
      error: createStrictExecutionErrorSchema(),
      ...ExecutorIdentityProperties,
    },
  }
}

export const ExecutorResponseSchema: JsonSchema = {
  $defs: JsonValueDefinitions,
  anyOf: [
    completedExecutorResponseSchema(JsonValueReference),
    nonCompletedExecutorResponseSchema(),
  ],
}

export const RunResultV1Schema = Type.Object(
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

const ArtifactRefV2TypeBoxSchema = {
  ...Type.Object(
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
          planDigest: Sha256DigestSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  anyOf: [{ required: ['content'] }, { required: ['uri'] }],
}

export const ArtifactRefV2Schema: JsonSchema = ArtifactRefV2TypeBoxSchema

const RunResultV2ExecutionSchema = Type.Object(
  {
    planDigest: Sha256DigestSchema,
    contentDigest: Sha256DigestSchema,
    roleDigest: Sha256DigestSchema,
    taskDigest: Sha256DigestSchema,
    contractDigest: Sha256DigestSchema,
    optionsDigest: Sha256DigestSchema,
  },
  { additionalProperties: false },
)

const RunResultV2ExecutorCommonProperties = {
  id: IdentifierSchema,
  transport: ExecutorTransportSchema,
  executorVersion: Type.Optional(NonEmptyStringSchema),
  requestedProvider: Type.Optional(NonEmptyStringSchema),
  requestedModel: Type.Optional(NonEmptyStringSchema),
  actualProvider: Type.Optional(NonEmptyStringSchema),
  actualModel: Type.Optional(NonEmptyStringSchema),
  profileId: Type.Optional(IdentifierSchema),
  profileDigest: Type.Optional(Sha256DigestSchema),
} as const

const RunResultV2ExecutorSchema = Type.Union([
  Type.Object(
    {
      capabilitySource: Type.Literal('adapter-verified'),
      adapterProtocol: Type.Literal('rolekit/executor-adapter@1'),
      adapterVersion: NonEmptyStringSchema,
      ...RunResultV2ExecutorCommonProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      capabilitySource: Type.Literal('host-attested'),
      ...RunResultV2ExecutorCommonProperties,
    },
    { additionalProperties: false },
  ),
])

const RunResultV2CommonProperties = {
  schema: Type.Literal('rolekit/run-result@2'),
  runId: NonEmptyStringSchema,
  taskId: IdentifierSchema,
  roleId: IdentifierSchema,
  execution: RunResultV2ExecutionSchema,
  policy: ExecutionPolicySchema,
  executor: RunResultV2ExecutorSchema,
  summary: NonEmptyStringSchema,
  artifacts: Type.Array(ArtifactRefV2TypeBoxSchema),
  evidence: Type.Array(EvidenceRefSchema),
  usage: StrictTokenUsageSchema,
  startedAt: Type.String({ format: 'date-time' }),
  completedAt: Type.String({ format: 'date-time' }),
} as const

const RunResultV2TypeBoxSchema = Type.Union(
  [
    Type.Object(
      {
        ...RunResultV2CommonProperties,
        status: Type.Literal('completed'),
        output: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunResultV2CommonProperties,
        status: Type.Union([
          Type.Literal('failed'),
          Type.Literal('blocked'),
          Type.Literal('cancelled'),
        ]),
        error: ExecutionErrorSchema,
      },
      { additionalProperties: false },
    ),
  ],
  { $id: 'https://rolekit.dev/schemas/run-result.v2.json' },
)

export const RunResultV2Schema: JsonSchema = RunResultV2TypeBoxSchema

export const RunResultSchema: JsonSchema = RunResultV2Schema

export const LatestRunResultSchema: JsonSchema = RunResultV2Schema

export const AnyRunResultSchema: JsonSchema = RunResultV2Schema

export function createExecutorPayloadSchema(outputSchema: JsonSchema): JsonSchema {
  const embeddedOutput = embedOutputSchemaResource(
    normalizeJsonSchema(outputSchema, 'Executor output schema'),
  )
  return normalizeJsonSchema(
    {
      $id: embeddedOutput.payloadId,
      $defs: {
        ...JsonValueDefinitions,
        roleOutput: embeddedOutput.schema,
      },
      anyOf: [
        completedExecutorResponseSchema({ $ref: embeddedOutput.outputId }),
        nonCompletedExecutorResponseSchema(),
      ],
    },
    'Executor payload schema',
  )
}

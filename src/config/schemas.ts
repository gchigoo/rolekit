import { Type } from '@sinclair/typebox'

import { ContextIsolationSchema } from '../core/schemas.ts'
import { CAPABILITIES, type JsonSchema } from '../core/types.ts'

export const SECRET_CONFIG_ANNOTATION = 'x-rolekit-secret'
export const PATH_CONFIG_ANNOTATION = 'x-rolekit-path'

const IdentifierSchema = Type.String({
  minLength: 1,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$',
})
const NonEmptyStringSchema = Type.String({ minLength: 1 })
const PortableEnvironmentNameSchema = Type.String({
  minLength: 1,
  pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
})

export const EnvironmentSecretRefSchema = Type.Object(
  { $env: PortableEnvironmentNameSchema },
  { additionalProperties: false },
)

export const SecretStringConfigSchema = Type.Union(
  [NonEmptyStringSchema, EnvironmentSecretRefSchema],
  { [SECRET_CONFIG_ANNOTATION]: true },
)

export const RelativePathConfigSchema = Type.String({
  minLength: 1,
  [PATH_CONFIG_ANNOTATION]: true,
})

const CapabilitySchema = Type.Union(CAPABILITIES.map((capability) => Type.Literal(capability)))

export const RoleConfigEntrySchema = Type.Object(
  {
    spec: NonEmptyStringSchema,
    promptFragments: Type.Optional(Type.Array(NonEmptyStringSchema)),
    executor: IdentifierSchema,
  },
  { additionalProperties: false },
)

export const AdapterExecutorProfileConfigSchema = Type.Object(
  {
    mode: Type.Literal('adapter'),
    adapter: IdentifierSchema,
    options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)

export const HostExecutorProfileConfigSchema = Type.Object(
  {
    mode: Type.Literal('host'),
    executorId: IdentifierSchema,
    transport: Type.Union([Type.Literal('in-process'), Type.Literal('remote')]),
    capabilities: Type.Array(CapabilitySchema, { uniqueItems: true }),
    requestedProvider: Type.Optional(NonEmptyStringSchema),
    requestedModel: Type.Optional(NonEmptyStringSchema),
    pathEnforcement: Type.Union([Type.Literal('advisory'), Type.Literal('host')]),
    contextIsolation: ContextIsolationSchema,
  },
  { additionalProperties: false },
)

export const ExecutorProfileConfigSchema = Type.Union([
  AdapterExecutorProfileConfigSchema,
  HostExecutorProfileConfigSchema,
])

export const RolekitConfigSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/config@1'),
    extends: Type.Optional(Type.Array(NonEmptyStringSchema)),
    roles: Type.Record(IdentifierSchema, RoleConfigEntrySchema, { additionalProperties: false }),
    executors: Type.Record(IdentifierSchema, ExecutorProfileConfigSchema, {
      additionalProperties: false,
    }),
  },
  {
    additionalProperties: false,
    $id: 'https://rolekit.dev/schemas/config.v1.json',
  },
)

const CommonCliConfigProperties = {
  command: Type.Optional(NonEmptyStringSchema),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  environment: Type.Optional(Type.Object({}, { additionalProperties: SecretStringConfigSchema })),
} as const

const PiToolSchema = Type.Union(
  ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'].map((tool) => Type.Literal(tool)),
)
const PiThinkingSchema = Type.Union(
  ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => Type.Literal(level)),
)
const RelativePathArraySchema = Type.Array(RelativePathConfigSchema, { uniqueItems: true })

export const PiAdapterConfigOptionsSchema = Type.Object(
  {
    ...CommonCliConfigProperties,
    provider: Type.Optional(NonEmptyStringSchema),
    model: Type.Optional(NonEmptyStringSchema),
    thinking: Type.Optional(PiThinkingSchema),
    tools: Type.Optional(Type.Array(PiToolSchema, { uniqueItems: true })),
    excludeTools: Type.Optional(Type.Array(PiToolSchema, { uniqueItems: true })),
    extensions: Type.Optional(RelativePathArraySchema),
    skills: Type.Optional(RelativePathArraySchema),
    promptTemplates: Type.Optional(RelativePathArraySchema),
    offline: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const PiRpcAdapterConfigOptionsSchema = Type.Object(
  {
    ...CommonCliConfigProperties,
    provider: Type.Optional(NonEmptyStringSchema),
    model: Type.Optional(NonEmptyStringSchema),
    thinking: Type.Optional(PiThinkingSchema),
    tools: Type.Optional(Type.Array(PiToolSchema, { uniqueItems: true })),
    extensions: Type.Optional(RelativePathArraySchema),
    skills: Type.Optional(RelativePathArraySchema),
    promptTemplates: Type.Optional(RelativePathArraySchema),
    offline: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const CursorAdapterConfigOptionsSchema = Type.Object(
  {
    ...CommonCliConfigProperties,
    model: Type.Optional(NonEmptyStringSchema),
    sandbox: Type.Optional(Type.Union([Type.Literal('enabled'), Type.Literal('disabled')])),
  },
  { additionalProperties: false },
)

export const CodexAdapterConfigOptionsSchema = Type.Object(
  {
    ...CommonCliConfigProperties,
    model: Type.Optional(NonEmptyStringSchema),
    reasoningEffort: Type.Optional(
      Type.Union(
        ['minimal', 'low', 'medium', 'high', 'xhigh'].map((effort) => Type.Literal(effort)),
      ),
    ),
    webSearch: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const BUILTIN_ADAPTER_CONFIG_SCHEMAS: Readonly<Record<string, JsonSchema>> = {
  pi: PiAdapterConfigOptionsSchema,
  'pi-rpc': PiRpcAdapterConfigOptionsSchema,
  cursor: CursorAdapterConfigOptionsSchema,
  codex: CodexAdapterConfigOptionsSchema,
}

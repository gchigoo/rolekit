import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'
import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js'

import * as core from '../../src/core/index.ts'
import type {
  AdapterEvent,
  ExecutorDescriptor,
  ExecutorDescriptorV1,
  ExecutorResponse,
  JsonSchema,
  JsonValue,
  RoleSpec,
  RunEvent,
  TaskPacket,
} from '../../src/core/types.ts'
import { FakeExecutorAdapter } from '../../src/testing/index.ts'

interface ContractApi {
  readonly assertJsonValue: (value: unknown, label: string) => asserts value is JsonValue
  readonly canonicalJson: (value: unknown, label?: string) => string
  readonly cloneJsonValue: <T>(value: T, label: string) => T
  readonly freezeJsonSnapshot: <T>(value: T, label: string) => Readonly<T>
  readonly normalizeJsonSchema: (schema: JsonSchema, label: string) => JsonSchema
  readonly validateExecutorResponse: <TOutput>(
    response: unknown,
    outputSchema: JsonSchema<TOutput>,
  ) => {
    readonly valid: boolean
    readonly response?: ExecutorResponse<TOutput>
    readonly errors: readonly string[]
  }
  readonly validateStrictValue: (schema: JsonSchema, value: unknown) => core.ValidationResult
}

const contractApi: ContractApi = core as unknown as ContractApi

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../fixtures/schemas/${name}`, import.meta.url), 'utf8'))
}

const [
  legacyRoleSpecV1SchemaFixture,
  legacyTaskPacketV1SchemaFixture,
  legacyRunResultV1SchemaFixture,
  legacyExecutorDescriptorV1SchemaFixture,
] = await Promise.all([
  readFixture('role-spec.v1.schema.json'),
  readFixture('task-packet.v1.schema.json'),
  readFixture('run-result.v1.schema.json'),
  readFixture('executor-descriptor.v1.schema.json'),
])

interface ExampleInput {
  readonly source: string
}

interface ExampleOutput {
  readonly message: string
}

const role: RoleSpec<ExampleInput, ExampleOutput> = {
  schema: 'rolekit/role-spec@1',
  id: 'implementer',
  description: 'Implements one bounded change.',
  requiredCapabilities: ['repository.read'],
  inputSchema: Type.Object({ source: Type.String() }, { additionalProperties: false }),
  outputSchema: Type.Object({ message: Type.String() }, { additionalProperties: false }),
}

const task: TaskPacket<ExampleInput> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'task-1',
  roleId: role.id,
  objective: 'Create the requested report.',
  input: { source: 'README.md' },
  context: [],
  constraints: [],
  acceptanceCriteria: [],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const descriptor: ExecutorDescriptor = {
  schema: 'rolekit/executor-descriptor@2',
  adapterProtocol: 'rolekit/executor-adapter@1',
  adapterVersion: '1.0.0',
  id: 'fake',
  displayName: 'Fake executor',
  transport: 'in-process',
  capabilities: ['repository.read'],
  features: {
    structuredOutput: 'native',
    events: false,
    cancellation: 'none',
    contextIsolation: {
      userConfig: 'isolated',
      projectInstructions: 'isolated',
      projectResources: 'isolated',
      environment: 'minimal',
      credentials: 'explicit',
    },
    supportedPathEnforcement: ['advisory'],
    permissionCombinations: ['repository.read'],
  },
}

const legacyDescriptor: ExecutorDescriptorV1 = {
  id: 'fake',
  displayName: 'Fake executor',
  transport: 'in-process',
  capabilities: ['repository.read'],
  available: true,
  model: 'configured-model',
  version: '1.0.0',
}

const completedResponse: ExecutorResponse<ExampleOutput> = {
  status: 'completed',
  summary: 'Report created.',
  output: { message: 'done' },
  artifacts: [{ name: 'report', kind: 'text', content: 'done' }],
  evidence: [],
}

const runOptions = {
  executorId: 'fake',
  cwd: '/project',
  adapterOptions: {},
}

function hostileReflectionProxy(): unknown {
  const nonCoercibleThrownValue = new Proxy(Object.create(null) as object, {
    get() {
      throw 'coercion trap'
    },
    getPrototypeOf() {
      throw 'instanceof trap'
    },
  })
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        throw nonCoercibleThrownValue
      },
    },
  )
}

describe('published and strict contracts', () => {
  it('keeps the published role, task, and RunResult v1 schema structures unchanged', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(core.RoleSpecSchema)), legacyRoleSpecV1SchemaFixture)
    assert.deepEqual(
      JSON.parse(JSON.stringify(core.TaskPacketSchema)),
      legacyTaskPacketV1SchemaFixture,
    )
    assert.deepEqual(
      JSON.parse(JSON.stringify(core.RunResultV1Schema)),
      legacyRunResultV1SchemaFixture,
    )
    assert.equal(core.RunResultSchema, core.RunResultV1Schema)
  })

  it('freezes descriptor V1 documents and exports discriminator-bearing V2 artifacts', () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(core.ExecutorDescriptorV1Schema)),
      legacyExecutorDescriptorV1SchemaFixture,
    )
    assert.equal(core.ExecutorDescriptorSchema, core.ExecutorDescriptorV2Schema)
    assert.equal(
      contractApi.validateStrictValue(core.ExecutorDescriptorV2Schema as JsonSchema, {
        schema: 'rolekit/executor-descriptor@2',
        adapterProtocol: 'rolekit/executor-adapter@1',
        adapterVersion: '1.0.0',
        id: 'fake',
        displayName: 'Fake executor',
        transport: 'in-process',
        capabilities: ['repository.read'],
        features: {
          structuredOutput: 'native',
          events: false,
          cancellation: 'none',
          contextIsolation: {
            userConfig: 'isolated',
            projectInstructions: 'isolated',
            projectResources: 'isolated',
            environment: 'minimal',
            credentials: 'explicit',
          },
          supportedPathEnforcement: ['advisory'],
          permissionCombinations: ['repository.read'],
        },
      }).valid,
      true,
    )
    assert.equal(
      contractApi.validateStrictValue(
        core.ExecutorDescriptorV2Schema as JsonSchema,
        legacyDescriptor,
      ).valid,
      false,
    )
  })

  it('keeps portable event string fields aligned with the public arbitrary-string types', () => {
    const adapterEvents: readonly AdapterEvent[] = [
      { type: 'assistant.delta', text: '' },
      { type: 'tool.started', tool: '', callId: '' },
      { type: 'tool.completed', tool: '', callId: '', success: false },
      { type: 'diagnostic', level: 'warning', message: '' },
    ]

    for (const event of adapterEvents) {
      assert.equal(
        contractApi.validateStrictValue(core.AdapterEventSchema as JsonSchema, event).valid,
        true,
        event.type,
      )
      const runEvent: RunEvent = {
        ...event,
        runId: 'event-contract-run',
        sequence: 1,
        createdAt: '2026-08-01T00:00:00.000Z',
      }
      assert.equal(
        contractApi.validateStrictValue(core.RunEventSchema as JsonSchema, runEvent).valid,
        true,
        event.type,
      )
    }

    assert.equal(
      contractApi.validateStrictValue(core.AdapterEventSchema as JsonSchema, {
        type: 'diagnostic',
        level: 'info',
        message: '',
        extra: true,
      }).valid,
      false,
    )
  })

  it('rejects a completed executor response without output and with an error', () => {
    const result = contractApi.validateExecutorResponse(
      {
        status: 'completed',
        summary: 'contradictory',
        artifacts: [],
        evidence: [],
        error: { code: 'failed', message: 'still failed', retryable: false },
      },
      Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }),
    )
    assert.equal(result.valid, false)
    assert.equal(result.response, undefined)
  })

  it('rejects non-JSON task input before invoking the adapter', async () => {
    const permissiveRole: RoleSpec<unknown, ExampleOutput> = {
      ...role,
      inputSchema: Type.Unknown(),
    }
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const rolekit = new core.Rolekit({ roles: [permissiveRole], adapters: [adapter] })
    const invalidTask = { ...task, input: 1n } as unknown as TaskPacket<unknown>

    await assert.rejects(
      rolekit.run(invalidTask, runOptions),
      (error: unknown) => error instanceof core.RolekitError && error.code === 'invalid_contract',
    )
    assert.equal(adapter.invocations.length, 0)
  })

  it('normalizes TypeBox annotations into a symbol-free portable schema', () => {
    const normalized = contractApi.normalizeJsonSchema(
      Type.Object({ value: Type.Optional(Type.String()) }, { additionalProperties: false }),
      'test schema',
    )
    assert.deepEqual(Object.getOwnPropertySymbols(normalized), [])
    const properties = normalized.properties as Readonly<Record<string, object>>
    assert.deepEqual(Object.getOwnPropertySymbols(properties.value ?? {}), [])
    assert.doesNotThrow(() => contractApi.canonicalJson(normalized))
  })

  it('normalizes schemas without rewriting data values or colliding with nested resources', () => {
    const normalizationResourceId = 'https://rolekit.dev/internal/schema-normalization'
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['annotation'],
      properties: {
        annotation: {
          const: { $ref: '', $dynamicRef: '' },
        },
      },
      $defs: {
        independentlyIdentified: {
          $id: normalizationResourceId,
          type: 'string',
        },
      },
    }

    const normalized = contractApi.normalizeJsonSchema(schema, 'collision schema')

    assert.deepEqual(normalized, schema)
    assert.equal(
      contractApi.validateStrictValue(normalized, {
        annotation: { $ref: '', $dynamicRef: '' },
      }).valid,
      true,
    )
    assert.equal(
      contractApi.validateStrictValue(normalized, {
        annotation: { $ref: '#', $dynamicRef: '#' },
      }).valid,
      false,
    )
  })

  it('normalizes a structurally invalid adapter response without throwing', async () => {
    const badAdapter = new FakeExecutorAdapter({
      descriptor,
      response: {
        status: 'completed',
        summary: 'bad',
        output: { message: 'x' },
        artifacts: null,
        evidence: [],
      } as never,
    })
    const result = await new core.Rolekit({ roles: [role], adapters: [badAdapter] }).run(
      task,
      runOptions,
    )
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'invalid_executor_response')
    assert.deepEqual(result.artifacts, [])
    assert.deepEqual(result.evidence, [])
  })

  it('contains arbitrary non-coercible values thrown by response Proxy reflection traps', () => {
    const result = contractApi.validateExecutorResponse(hostileReflectionProxy(), role.outputSchema)

    assert.equal(result.valid, false)
    assert.equal(result.response, undefined)
    assert.ok(result.errors.length > 0)
  })

  it('rejects an expected artifact with neither content nor uri', async () => {
    const emptyArtifact = { name: 'report', kind: 'text' }
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: { ...completedResponse, artifacts: [emptyArtifact] } as never,
    })
    const result = await new core.Rolekit({ roles: [role], adapters: [adapter] }).run(
      task,
      runOptions,
    )
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'invalid_executor_response')
    assert.deepEqual(result.artifacts, [])
  })

  it('keeps legacy format validation disabled while strict validation enforces formats', () => {
    const schema = Type.String({ format: 'date-time' })
    assert.equal(core.validateValue(schema, 'not-a-date').valid, true)
    assert.equal(contractApi.validateStrictValue(schema, 'not-a-date').valid, false)
  })

  it('accepts reported provider identity in a strict response', () => {
    const result = contractApi.validateExecutorResponse(
      { ...completedResponse, provider: 'example-provider' },
      role.outputSchema,
    )
    assert.equal(result.valid, true)
    assert.equal(result.response?.provider, 'example-provider')
  })

  it('preserves local definitions and recursive semantics in generated executor payload schemas', () => {
    const collidingLocalDefinitionSchema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { $ref: '#/$defs/jsonValue' },
      },
      $defs: {
        jsonValue: { type: 'string', pattern: '^local:' },
      },
    }
    const collidingPayload = core.createExecutorPayloadSchema(collidingLocalDefinitionSchema)
    const completed = (output: unknown) => ({
      status: 'completed',
      summary: 'generated payload',
      output,
      artifacts: [],
      evidence: [],
    })

    assert.equal(
      contractApi.validateStrictValue(collidingPayload, completed({ message: 'local:value' }))
        .valid,
      true,
    )
    assert.equal(
      contractApi.validateStrictValue(collidingPayload, completed({ message: 42 })).valid,
      false,
    )

    const recursiveOutputSchema: JsonSchema = {
      $ref: '#/$defs/node',
      $defs: {
        node: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'children'],
          properties: {
            value: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/node' } },
          },
        },
      },
    }
    const recursivePayload = core.createExecutorPayloadSchema(recursiveOutputSchema)
    assert.equal(
      contractApi.validateStrictValue(
        recursivePayload,
        completed({ value: 'root', children: [{ value: 'child', children: [] }] }),
      ).valid,
      true,
    )
    assert.equal(
      contractApi.validateStrictValue(
        recursivePayload,
        completed({ value: 'root', children: [{ children: [] }] }),
      ).valid,
      false,
    )
  })

  it('rebases empty root references without crossing independent resource boundaries', () => {
    const completed = (output: unknown) => ({
      status: 'completed',
      summary: 'generated payload',
      output,
      artifacts: [],
      evidence: [],
    })
    const validOutput = {
      value: 'root',
      children: [{ value: 'child', children: [] }],
    }
    const invalidOutput = {
      value: 'root',
      children: [{ value: 42, children: [] }],
    }

    for (const referenceKeyword of ['$ref', '$dynamicRef'] as const) {
      const recursiveNodeSchema = {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'children'],
        properties: {
          value: { type: 'string' },
          children: {
            type: 'array',
            items: { [referenceKeyword]: '' },
          },
        },
      }
      const rootRecursivePayload = core.createExecutorPayloadSchema(recursiveNodeSchema)
      assert.equal(
        contractApi.validateStrictValue(rootRecursivePayload, completed(validOutput)).valid,
        true,
        `${referenceKeyword} should recurse to the embedded output root`,
      )
      assert.equal(
        contractApi.validateStrictValue(rootRecursivePayload, completed(invalidOutput)).valid,
        false,
        `${referenceKeyword} should enforce the embedded output root recursively`,
      )

      const nestedResourceSchema: JsonSchema = {
        $ref: 'recursive-node',
        $defs: {
          recursiveNode: {
            $id: 'recursive-node',
            ...recursiveNodeSchema,
          },
        },
      }
      const nestedResourcePayload = core.createExecutorPayloadSchema(nestedResourceSchema)
      assert.equal(
        contractApi.validateStrictValue(nestedResourcePayload, completed(validOutput)).valid,
        true,
        `${referenceKeyword} should remain relative to its independent nested resource`,
      )
      assert.equal(
        contractApi.validateStrictValue(nestedResourcePayload, completed(invalidOutput)).valid,
        false,
        `${referenceKeyword} should retain nested resource validation semantics`,
      )
    }
  })

  it('validates empty references directly at root and nested resource scopes', () => {
    const validValue = {
      value: 'root',
      children: [{ value: 'child', children: [] }],
    }
    const invalidValue = {
      value: 'root',
      children: [{ value: 42, children: [] }],
    }

    for (const referenceKeyword of ['$ref', '$dynamicRef'] as const) {
      const recursiveNodeSchema: JsonSchema = {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'children'],
        properties: {
          value: { type: 'string' },
          children: {
            type: 'array',
            items: { [referenceKeyword]: '' },
          },
        },
      }
      assert.equal(
        contractApi.validateStrictValue(recursiveNodeSchema, validValue).valid,
        true,
        `${referenceKeyword} should validate against the root resource`,
      )
      assert.equal(
        contractApi.validateStrictValue(recursiveNodeSchema, invalidValue).valid,
        false,
        `${referenceKeyword} should reject invalid root recursion`,
      )

      const nestedResourceSchema: JsonSchema = {
        $ref: 'recursive-node',
        $defs: {
          recursiveNode: {
            $id: 'recursive-node',
            ...recursiveNodeSchema,
          },
        },
      }
      assert.equal(
        contractApi.validateStrictValue(nestedResourceSchema, validValue).valid,
        true,
        `${referenceKeyword} should validate against its nested resource root`,
      )
      assert.equal(
        contractApi.validateStrictValue(nestedResourceSchema, invalidValue).valid,
        false,
        `${referenceKeyword} should reject invalid nested-resource recursion`,
      )
    }
  })

  it('canonicalizes nested relative resource IDs and avoids payload ID collisions', () => {
    const outputSchema: JsonSchema = {
      $id: 'https://rolekit.dev/internal/',
      $ref: 'executor-payload',
      $defs: {
        nestedOutput: {
          $id: 'executor-payload',
          type: 'object',
          additionalProperties: false,
          required: ['message'],
          properties: {
            message: { type: 'string' },
          },
        },
      },
    }
    const payload = core.createExecutorPayloadSchema(outputSchema)
    const payloadDefinitions = payload.$defs as Readonly<Record<string, JsonSchema>>
    const embeddedOutput = payloadDefinitions.roleOutput as JsonSchema
    const embeddedDefinitions = embeddedOutput.$defs as Readonly<Record<string, JsonSchema>>

    assert.equal(
      embeddedDefinitions.nestedOutput?.$id,
      'https://rolekit.dev/internal/executor-payload',
    )
    assert.notEqual(payload.$id, embeddedDefinitions.nestedOutput?.$id)

    const ajv = new Ajv2020({ allErrors: true, strict: false })
    assert.doesNotThrow(() => ajv.addSchema(payload as AnySchema))
    const validate = ajv.getSchema(payload.$id as string)
    assert.ok(validate)
    assert.equal(
      validate({
        status: 'completed',
        summary: 'generated payload',
        output: { message: 'valid' },
        artifacts: [],
        evidence: [],
      }),
      true,
    )
    assert.equal(
      validate({
        status: 'completed',
        summary: 'generated payload',
        output: { message: 42 },
        artifacts: [],
        evidence: [],
      }),
      false,
    )
  })

  it('treats root empty and empty-fragment IDs as the embedded output resource', () => {
    for (const rootId of ['', '#']) {
      const outputSchema: JsonSchema = {
        $id: rootId,
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: { $ref: '#/$defs/leaf' },
        },
        $defs: {
          leaf: { type: 'string', pattern: '^root:' },
        },
      }
      const payload = core.createExecutorPayloadSchema(outputSchema)
      const payloadDefinitions = payload.$defs as Readonly<Record<string, JsonSchema>>
      const embeddedOutput = payloadDefinitions.roleOutput as JsonSchema
      const completed = (message: unknown) => ({
        status: 'completed',
        summary: 'generated payload',
        output: { message },
        artifacts: [],
        evidence: [],
      })

      assert.equal(typeof embeddedOutput.$id, 'string')
      assert.notEqual(embeddedOutput.$id, '')
      assert.notEqual(embeddedOutput.$id, '#')
      assert.notEqual(embeddedOutput.$id, payload.$id)
      assert.equal(contractApi.validateStrictValue(payload, completed('root:value')).valid, true)
      assert.equal(contractApi.validateStrictValue(payload, completed('other')).valid, false)
    }
  })

  it('generates deterministic distinct payload IDs that coexist in one AJV registry', () => {
    const stringOutputSchema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: { type: 'string' } },
    }
    const numberOutputSchema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['count'],
      properties: { count: { type: 'number' } },
    }
    const firstPayload = core.createExecutorPayloadSchema(stringOutputSchema)
    const repeatedFirstPayload = core.createExecutorPayloadSchema(stringOutputSchema)
    const secondPayload = core.createExecutorPayloadSchema(numberOutputSchema)

    assert.equal(firstPayload.$id, repeatedFirstPayload.$id)
    assert.notEqual(firstPayload.$id, secondPayload.$id)

    const ajv = new Ajv2020({ allErrors: true, strict: false })
    assert.doesNotThrow(() => {
      ajv.addSchema(firstPayload as AnySchema)
      ajv.addSchema(secondPayload as AnySchema)
    })
    assert.ok(ajv.getSchema(firstPayload.$id as string))
    assert.ok(ajv.getSchema(secondPayload.$id as string))
  })

  it('rejects duplicate artifacts on non-completed responses', () => {
    const result = contractApi.validateExecutorResponse(
      {
        status: 'failed',
        summary: 'failed',
        artifacts: [
          { name: 'log', kind: 'text', content: 'first' },
          { name: 'log', kind: 'text', content: 'second' },
        ],
        evidence: [],
        error: { code: 'failed', message: 'failed', retryable: false },
      },
      role.outputSchema,
    )
    assert.equal(result.valid, false)
  })

  it('rejects fractional token counts and non-JSON response content', () => {
    const fractional = contractApi.validateExecutorResponse(
      { ...completedResponse, usage: { inputTokens: 0.5 } },
      role.outputSchema,
    )
    assert.equal(fractional.valid, false)

    const nonJson = contractApi.validateExecutorResponse(
      {
        ...completedResponse,
        artifacts: [{ name: 'report', kind: 'text', content: 1n }],
      },
      role.outputSchema,
    )
    assert.equal(nonJson.valid, false)
    assert.equal(nonJson.response, undefined)
  })
})

describe('portable JSON utilities', () => {
  it('rejects every supported class of non-JSON state', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const sparse = new Array(1)
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'value',
    })
    const hidden = Object.defineProperty({}, 'hidden', { value: true })
    const symbolState = { [Symbol('state')]: true }
    const customPrototype = Object.create({ inherited: true })
    const values: readonly unknown[] = [
      1n,
      undefined,
      () => undefined,
      Symbol('value'),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      cyclic,
      sparse,
      new Date(),
      new Map(),
      new Set(),
      accessor,
      hidden,
      symbolState,
      customPrototype,
    ]

    for (const value of values) {
      assert.throws(
        () => contractApi.assertJsonValue(value, 'test value'),
        (error: unknown) => error instanceof core.RolekitError && error.code === 'invalid_contract',
      )
    }
  })

  it('clones, normalizes negative zero, recursively freezes, and preserves shared values', () => {
    const shared = { value: -0 }
    const source = { array: [shared], other: shared }
    const clone = contractApi.cloneJsonValue(source, 'source')
    assert.notEqual(clone, source)
    assert.notEqual(clone.array[0], shared)
    assert.equal(Object.is(clone.array[0]?.value, -0), false)
    assert.deepEqual(clone, { array: [{ value: 0 }], other: { value: 0 } })

    const frozen = contractApi.freezeJsonSnapshot(source, 'source')
    assert.equal(Object.isFrozen(frozen), true)
    assert.equal(Object.isFrozen(frozen.array), true)
    assert.equal(Object.isFrozen(frozen.array[0]), true)
  })

  it('canonicalizes object keys by UTF-16 order without sorting arrays or normalizing Unicode', () => {
    const decomposed = 'e\u0301'
    const composed = '\u00e9'
    assert.equal(
      contractApi.canonicalJson({ 2: 'two', 10: 'ten', z: -0, [composed]: 1, [decomposed]: 2 }),
      `{"10":"ten","2":"two","${decomposed}":2,"z":0,"${composed}":1}`,
    )
    assert.equal(contractApi.canonicalJson([3, 1, 2]), '[3,1,2]')
  })

  it('rejects unknown schema symbols and invalid JSON Schemas', () => {
    const symbolSchema = Type.String() as unknown as JsonSchema & Record<symbol, unknown>
    symbolSchema[Symbol('not-typebox')] = true
    assert.throws(
      () => contractApi.normalizeJsonSchema(symbolSchema, 'symbol schema'),
      (error: unknown) => error instanceof core.RolekitError && error.code === 'invalid_schema',
    )
    assert.throws(
      () => contractApi.normalizeJsonSchema({ type: 'not-a-json-schema-type' }, 'bad schema'),
      (error: unknown) => error instanceof core.RolekitError && error.code === 'invalid_schema',
    )
  })
})

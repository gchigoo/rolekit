import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { prepareExecutorOptions } from '../../src/adapters/cli/index.ts'
import type { PiRpcAdapterOptions } from '../../src/adapters/pi-rpc/index.ts'
import { createBuiltInAdapterRegistry } from '../../src/composition.ts'
import {
  type AdapterExecutorProfileConfig,
  compileRoleBinding,
  compileTaskExecutionTarget,
  createAdapterRegistry,
  defineAdapterRegistration,
  digestExecutorProfile,
  inspectExecutorProfile,
  loadRolekitConfig,
  probeExecutorProfile,
  resolveRunBinding,
  SecretStringConfigSchema,
} from '../../src/config/index.ts'
import { analyzeAdapterConfig } from '../../src/config/secrets.ts'
import { RolekitConfigError } from '../../src/config/types.ts'
import type {
  ExecutionAdmission,
  ExecutionContext,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorProbe,
  ExecutorResponse,
  JsonObject,
  JsonSchema,
  PreparedExecutorOptions,
  ProbeContext,
  PublicOptionContext,
  RoleSpec,
  TaskPacket,
} from '../../src/core/index.ts'
import { digestJson, freezeJsonSnapshot } from '../../src/core/index.ts'

interface TestAdapterOptions {
  readonly model?: string
  readonly environment?: Readonly<Record<string, string>>
}

interface TestAdapterConfig extends JsonObject {
  readonly model?: string
  readonly environment?: Readonly<Record<string, string | { readonly $env: string }>>
}

const TEST_CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', minLength: 1 },
    environment: {
      type: 'object',
      additionalProperties: SecretStringConfigSchema,
    },
  },
} as const as JsonSchema<TestAdapterConfig>

const UNSAFE_BUILTIN_CONFIG_CASES = [
  {
    adapter: 'pi',
    field: 'inheritAmbientEnvironment',
    options: { inheritAmbientEnvironment: true },
  },
  { adapter: 'pi', field: 'inheritContextFiles', options: { inheritContextFiles: true } },
  {
    adapter: 'pi',
    field: 'inheritUserAgentDirectory',
    options: { inheritUserAgentDirectory: true },
  },
  { adapter: 'pi', field: 'discoverProjectResources', options: { discoverProjectResources: true } },
  {
    adapter: 'pi-rpc',
    field: 'inheritAmbientEnvironment',
    options: { inheritAmbientEnvironment: true },
  },
  { adapter: 'pi-rpc', field: 'inheritContextFiles', options: { inheritContextFiles: true } },
  {
    adapter: 'pi-rpc',
    field: 'inheritUserAgentDirectory',
    options: { inheritUserAgentDirectory: true },
  },
  {
    adapter: 'pi-rpc',
    field: 'discoverProjectResources',
    options: { discoverProjectResources: true },
  },
  {
    adapter: 'cursor',
    field: 'inheritAmbientEnvironment',
    options: { inheritAmbientEnvironment: true },
  },
  {
    adapter: 'cursor',
    field: 'approveMcps',
    options: { approveMcps: true },
  },
  {
    adapter: 'codex',
    field: 'inheritAmbientEnvironment',
    options: { inheritAmbientEnvironment: true },
  },
  {
    adapter: 'codex',
    field: 'profile',
    options: { profile: 'ambient-profile', inheritUserConfig: true },
  },
  { adapter: 'codex', field: 'inheritUserConfig', options: { inheritUserConfig: true } },
  {
    adapter: 'codex',
    field: 'inheritProjectInstructions',
    options: { inheritProjectInstructions: true },
  },
  {
    adapter: 'codex',
    field: 'inheritExecPolicyRules',
    options: { inheritExecPolicyRules: true },
  },
] as const

const TEST_DESCRIPTOR: ExecutorDescriptorV2 = {
  schema: 'rolekit/executor-descriptor@2',
  adapterProtocol: 'rolekit/executor-adapter@1',
  adapterVersion: '1.0.0',
  id: 'test',
  displayName: 'Test adapter',
  transport: 'in-process',
  capabilities: ['repository.read', 'repository.write', 'shell'],
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
    permissionCombinations: [
      'repository.read',
      'repository.read+repository.write',
      'repository.read+repository.write+shell',
    ],
  },
}

class TrackingAdapter implements ExecutorAdapter<TestAdapterOptions> {
  readonly id = 'test'
  readonly sensitiveOptionPointers = ['/environment'] as const
  probeInvocationCount = 0
  executeInvocationCount = 0
  inspectInvocationCount = 0

  prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<TestAdapterOptions> {
    return prepareExecutorOptions(options as TestAdapterOptions, publicContext)
  }

  inspect(_prepared: PreparedExecutorOptions<TestAdapterOptions>): ExecutorDescriptorV2 {
    this.inspectInvocationCount += 1
    return freezeJsonSnapshot(TEST_DESCRIPTOR, 'Test descriptor')
  }

  async probe(
    _prepared: PreparedExecutorOptions<TestAdapterOptions>,
    _context: ProbeContext,
  ): Promise<ExecutorProbe> {
    this.probeInvocationCount += 1
    return { available: true, featureChecks: {} }
  }

  admit(
    _role: RoleSpec,
    _task: TaskPacket,
    prepared: PreparedExecutorOptions<TestAdapterOptions>,
  ): ExecutionAdmission {
    return freezeJsonSnapshot(
      {
        allowed: true,
        effectiveCapabilities: TEST_DESCRIPTOR.capabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: TEST_DESCRIPTOR.features.contextIsolation,
      },
      'Test admission',
    ) as ExecutionAdmission
  }

  async execute(
    _role: RoleSpec,
    _task: TaskPacket,
    _context: ExecutionContext<TestAdapterOptions>,
  ): Promise<ExecutorResponse> {
    this.executeInvocationCount += 1
    return {
      status: 'completed',
      summary: 'done',
      output: {},
      artifacts: [],
      evidence: [],
    }
  }
}

function decodePointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

function preparedWithPublicReplacements(
  options: unknown,
  publicContext: PublicOptionContext | undefined,
): PreparedExecutorOptions<JsonObject> {
  assert.equal(typeof options, 'object')
  assert.notEqual(options, null)
  assert.equal(Array.isArray(options), false)
  const executionOptions = structuredClone(options) as JsonObject
  const publicOptions = structuredClone(options) as JsonObject
  const sensitiveValues: string[] = []
  for (const [pointer, marker] of Object.entries(publicContext?.replacementsByJsonPointer ?? {})) {
    const tokens = pointer.slice(1).split('/').map(decodePointerToken)
    let executionParent: unknown = executionOptions
    let publicParent: unknown = publicOptions
    for (const token of tokens.slice(0, -1)) {
      executionParent = (executionParent as Record<string, unknown>)[token]
      publicParent = (publicParent as Record<string, unknown>)[token]
    }
    const leaf = tokens.at(-1)
    assert.notEqual(leaf, undefined)
    const raw = (executionParent as Record<string, unknown>)[leaf as string]
    assert.equal(typeof raw, 'string')
    sensitiveValues.push(raw as string)
    ;(publicParent as Record<string, unknown>)[leaf as string] = marker
  }
  return freezeJsonSnapshot(
    {
      executionOptions,
      publicOptions,
      sensitiveValues,
    },
    'Structure-checking prepared options',
  ) as unknown as PreparedExecutorOptions<JsonObject>
}

class StructureCheckingAdapter implements ExecutorAdapter<JsonObject> {
  readonly id = 'structured'
  readonly sensitiveOptionPointers = ['/credential', '/items', '/tuple'] as const
  readonly check: (options: Readonly<JsonObject>) => void
  readonly createProbeOptions: () => JsonObject

  constructor(
    check: (options: Readonly<JsonObject>) => void,
    createProbeOptions: () => JsonObject,
  ) {
    this.check = check
    this.createProbeOptions = createProbeOptions
  }

  prepareOptions(
    options: unknown,
    publicContext?: PublicOptionContext,
  ): PreparedExecutorOptions<JsonObject> {
    assert.equal(typeof options, 'object')
    assert.notEqual(options, null)
    assert.equal(Array.isArray(options), false)
    this.check(options as JsonObject)
    return preparedWithPublicReplacements(options, publicContext)
  }

  inspect(_prepared: PreparedExecutorOptions<JsonObject>): ExecutorDescriptorV2 {
    return freezeJsonSnapshot({ ...TEST_DESCRIPTOR, id: this.id }, 'Structured descriptor')
  }

  prepareProbeOptions(): PreparedExecutorOptions<JsonObject> {
    return this.prepareOptions(this.createProbeOptions())
  }

  async probe(prepared: PreparedExecutorOptions<JsonObject>): Promise<ExecutorProbe> {
    this.check(prepared.executionOptions)
    assert.doesNotMatch(
      JSON.stringify(prepared),
      /rolekit-non-secret-static-placeholder|tuple-literal-secret/u,
    )
    return { available: true, featureChecks: {} }
  }

  admit(
    _role: RoleSpec,
    _task: TaskPacket,
    prepared: PreparedExecutorOptions<JsonObject>,
  ): ExecutionAdmission {
    return freezeJsonSnapshot(
      {
        allowed: true,
        effectiveCapabilities: TEST_DESCRIPTOR.capabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: TEST_DESCRIPTOR.features.contextIsolation,
      },
      'Structured admission',
    ) as ExecutionAdmission
  }

  async execute(): Promise<ExecutorResponse> {
    return {
      status: 'completed',
      summary: 'done',
      output: {},
      artifacts: [],
      evidence: [],
    }
  }
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'rolekit-config-resolver-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeRole(
  path: string,
  id: string,
  requiredCapabilities: readonly string[] = ['repository.read'],
  instructions = 'Base instructions.',
): Promise<void> {
  await writeJson(path, {
    schema: 'rolekit/role-spec@1',
    id,
    description: `${id} role`,
    requiredCapabilities,
    instructions,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
    },
  })
}

function testRegistry(adapter: TrackingAdapter) {
  return createAdapterRegistry([
    defineAdapterRegistration<TestAdapterConfig, TestAdapterOptions>({
      id: 'test',
      configOptionsSchema: TEST_CONFIG_SCHEMA,
      create: () => adapter,
    }),
  ])
}

async function writeAdapterFixture(
  directory: string,
  options: JsonObject,
  settings: {
    readonly fragments?: readonly string[]
    readonly roleId?: string
    readonly roleCapabilities?: readonly string[]
  } = {},
): Promise<string> {
  const roleId = settings.roleId ?? 'implementer'
  await writeRole(
    join(directory, 'role.json'),
    roleId,
    settings.roleCapabilities ?? ['repository.read'],
  )
  const configPath = join(directory, 'rolekit.yaml')
  await writeFile(
    configPath,
    [
      'schema: rolekit/config@1',
      'roles:',
      `  ${roleId}:`,
      '    spec: role.json',
      ...(settings.fragments === undefined
        ? []
        : ['    promptFragments:', ...settings.fragments.map((fragment) => `      - ${fragment}`)]),
      '    executor: test-profile',
      'executors:',
      '  test-profile:',
      '    mode: adapter',
      '    adapter: test',
      `    options: ${JSON.stringify(options)}`,
      '',
    ].join('\n'),
    'utf8',
  )
  return configPath
}

describe('role binding compilation and runtime resolution', () => {
  it('compiles without probing or reading ambient secrets and composes fragments deterministically', async () => {
    await withTemporaryDirectory(async (directory) => {
      const adapter = new TrackingAdapter()
      const configPath = await writeAdapterFixture(
        directory,
        {
          model: 'requested-model',
          environment: { XAI_API_KEY: { $env: 'XAI_API_KEY' } },
        },
        { fragments: ['fragment-one.md', 'fragment-two.md'] },
      )
      await writeFile(join(directory, 'fragment-one.md'), 'Fragment one.\r\n \t\r\n', 'utf8')
      await writeFile(join(directory, 'fragment-two.md'), 'Fragment two.   \n\n', 'utf8')
      const previous = process.env.XAI_API_KEY
      process.env.XAI_API_KEY = 'ambient-secret-must-not-be-read'
      try {
        const loaded = await loadRolekitConfig(configPath)
        const compiled = await compileRoleBinding(loaded, 'implementer', testRegistry(adapter))

        assert.equal(compiled.executorProfileId, 'test-profile')
        assert.equal(compiled.executorId, 'test')
        assert.deepEqual(compiled.requiredSecrets, ['XAI_API_KEY'])
        assert.equal(adapter.inspectInvocationCount, 1)
        assert.equal(adapter.probeInvocationCount, 0)
        assert.equal(adapter.executeInvocationCount, 0)
        assert.equal(
          compiled.role.instructions,
          'Base instructions.\n\nFragment one.\n\nFragment two.',
        )
        assert.deepEqual(compiled.profilePublicOptions.environment, {
          XAI_API_KEY: { source: 'env', name: 'XAI_API_KEY', redacted: true },
        })
        assert.deepEqual((compiled.profile as AdapterExecutorProfileConfig).options?.environment, {
          XAI_API_KEY: { source: 'env', name: 'XAI_API_KEY', redacted: true },
        })
        assert.doesNotMatch(JSON.stringify(compiled), /ambient-secret-must-not-be-read/u)
        assert.doesNotMatch(JSON.stringify(compiled), /rolekit-non-secret-static-placeholder/u)
        if (compiled.capabilitySource !== 'adapter-verified') {
          assert.fail('Expected an adapter-verified binding.')
        }
        assert.deepEqual(
          (compiled.inspectionPreparedOptions.executionOptions as TestAdapterOptions).environment,
          {
            XAI_API_KEY: { source: 'env', name: 'XAI_API_KEY', redacted: true },
          },
        )
        assert.equal(Object.isFrozen(compiled), true)
        assert.equal(Object.isFrozen(compiled.role), true)
      } finally {
        if (previous === undefined) {
          delete process.env.XAI_API_KEY
        } else {
          process.env.XAI_API_KEY = previous
        }
      }
    })
  })

  it('keeps env refs public during compile and resolves them only for run', async () => {
    await withTemporaryDirectory(async (directory) => {
      const adapter = new TrackingAdapter()
      const configPath = await writeAdapterFixture(directory, {
        environment: { XAI_API_KEY: { $env: 'XAI_API_KEY' } },
      })
      const compiled = await compileRoleBinding(
        await loadRolekitConfig(configPath),
        'implementer',
        testRegistry(adapter),
      )

      await assert.rejects(
        resolveRunBinding(compiled, testRegistry(adapter), {}),
        /missing_secret.*XAI_API_KEY/u,
      )
      assert.equal(adapter.probeInvocationCount, 0)
      assert.equal(adapter.executeInvocationCount, 0)

      const runtime = await resolveRunBinding(compiled, testRegistry(adapter), {
        XAI_API_KEY: 'runtime-secret',
      })
      assert.equal(
        (runtime.adapterOptions as TestAdapterOptions).environment?.XAI_API_KEY,
        'runtime-secret',
      )
      assert.deepEqual(runtime.publicOptionContext.replacementsByJsonPointer, {
        '/environment/XAI_API_KEY': {
          source: 'env',
          name: 'XAI_API_KEY',
          redacted: true,
        },
      })
      const prepared = runtime.adapter.prepareOptions(
        runtime.adapterOptions,
        runtime.publicOptionContext,
      )
      assert.deepEqual(prepared.sensitiveValues, ['runtime-secret'])
      assert.doesNotMatch(JSON.stringify(prepared.publicOptions), /runtime-secret/u)
      assert.doesNotMatch(JSON.stringify(runtime), /runtime-secret/u)
      assert.equal(adapter.probeInvocationCount, 0)
    })
  })

  it('rejects adapter options against the selected built-in adapter config schema', async () => {
    await withTemporaryDirectory(async (directory) => {
      await writeRole(join(directory, 'role.json'), 'reviewer')
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: role.json',
          '    executor: codex-reviewer',
          'executors:',
          '  codex-reviewer:',
          '    mode: adapter',
          '    adapter: codex',
          '    options:',
          '      provider: xai',
          '',
        ].join('\n'),
        'utf8',
      )

      await assert.rejects(
        compileRoleBinding(
          await loadRolekitConfig(configPath),
          'reviewer',
          createBuiltInAdapterRegistry(),
        ),
        /rolekit\.yaml.*\/executors\/codex-reviewer\/options\/provider/u,
      )
    })
  })

  for (const unsafeCase of UNSAFE_BUILTIN_CONFIG_CASES) {
    it(`rejects config-unsafe ${unsafeCase.adapter}.${unsafeCase.field}`, async () => {
      await withTemporaryDirectory(async (directory) => {
        await writeRole(join(directory, 'role.json'), 'reviewer')
        const configPath = join(directory, 'rolekit.yaml')
        await writeFile(
          configPath,
          [
            'schema: rolekit/config@1',
            'roles:',
            '  reviewer:',
            '    spec: role.json',
            '    executor: selected',
            'executors:',
            '  selected:',
            '    mode: adapter',
            `    adapter: ${unsafeCase.adapter}`,
            `    options: ${JSON.stringify(unsafeCase.options)}`,
            '',
          ].join('\n'),
          'utf8',
        )
        await assert.rejects(
          compileRoleBinding(
            await loadRolekitConfig(configPath),
            'reviewer',
            createBuiltInAdapterRegistry(),
          ),
          new RegExp(`/executors/selected/options/${unsafeCase.field}`, 'u'),
        )
      })
    })
  }

  it('classifies secrets through root refs, sibling annotations, unions, patterns, arrays, and tuples', () => {
    const secretValue = {
      anyOf: [
        { type: 'string', minLength: 1 },
        {
          type: 'object',
          additionalProperties: false,
          required: ['$env'],
          properties: { $env: { type: 'string', minLength: 1 } },
        },
      ],
      'x-rolekit-secret': true,
    } as const
    const siblingSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['credential'],
      properties: {
        credential: { $ref: '#/$defs/value', 'x-rolekit-secret': true },
      },
      $defs: { value: { type: 'string', minLength: 1 } },
    } as const as JsonSchema<JsonObject>
    const sibling = analyzeAdapterConfig({ credential: 'ref-sibling-secret' }, siblingSchema, {
      sourcePath: 'sibling.json',
      basePointer: '/options',
    })
    assert.deepEqual(sibling.publicConfig.credential, { source: 'literal', redacted: true })

    const unionSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['credential'],
      properties: {
        credential: {
          anyOf: [{ $ref: '#/$defs/secret' }, { type: 'number' }],
        },
      },
      $defs: { secret: secretValue },
    } as const as JsonSchema<JsonObject>
    const union = analyzeAdapterConfig({ credential: { $env: 'TOKEN' } }, unionSchema, {
      sourcePath: 'union.json',
      basePointer: '/options',
    })
    assert.deepEqual(union.requiredSecrets, ['TOKEN'])
    assert.deepEqual(union.publicConfig.credential, {
      source: 'env',
      name: 'TOKEN',
      redacted: true,
    })

    const aggregateSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['bag', 'list', 'tuple'],
      properties: {
        bag: {
          type: 'object',
          additionalProperties: false,
          patternProperties: { '^TOKEN_': { $ref: '#/$defs/secret' } },
        },
        list: { type: 'array', items: { $ref: '#/$defs/secret' } },
        tuple: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          prefixItems: [{ type: 'string' }, { $ref: '#/$defs/secret' }],
          items: false,
        },
      },
      $defs: { secret: secretValue },
    } as const as JsonSchema<JsonObject>
    const aggregate = analyzeAdapterConfig(
      {
        bag: { TOKEN_ONE: 'pattern-secret' },
        list: [{ $env: 'LIST_SECRET' }],
        tuple: ['public', 'tuple-secret'],
      },
      aggregateSchema,
      { sourcePath: 'aggregate.json', basePointer: '/options' },
    )
    assert.deepEqual(aggregate.requiredSecrets, ['LIST_SECRET'])
    assert.deepEqual(aggregate.publicConfig, {
      bag: { TOKEN_ONE: { source: 'literal', redacted: true } },
      list: [{ source: 'env', name: 'LIST_SECRET', redacted: true }],
      tuple: ['public', { source: 'literal', redacted: true }],
    })
  })

  it('rejects ambiguous secret classification across applicable union branches', () => {
    const ambiguousSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['credential'],
      properties: {
        credential: {
          anyOf: [SecretStringConfigSchema, SecretStringConfigSchema],
        },
      },
    } as const as JsonSchema<JsonObject>
    assert.throws(
      () =>
        analyzeAdapterConfig({ credential: 'ambiguous-secret' }, ambiguousSchema, {
          sourcePath: 'ambiguous.json',
          basePointer: '/options',
        }),
      /ambiguous.*\/options\/credential/u,
    )
  })

  it('rejects interpolation and secret refs outside schema-declared secret fields', async () => {
    await withTemporaryDirectory(async (directory) => {
      const adapter = new TrackingAdapter()
      const registry = testRegistry(adapter)
      const interpolationPath = await writeAdapterFixture(directory, {
        model: '$' + '{MODEL_NAME}',
      })
      await assert.rejects(
        compileRoleBinding(await loadRolekitConfig(interpolationPath), 'implementer', registry),
        (error: unknown) => {
          assert.equal(error instanceof Error, true)
          const message = error instanceof Error ? error.message : ''
          assert.match(message, /interpolation/u)
          assert.match(message, /\/executors\/test-profile\/options\/model/u)
          return true
        },
      )

      const refPath = await writeAdapterFixture(directory, {
        model: { $env: 'MODEL_NAME' },
      })
      await assert.rejects(
        compileRoleBinding(await loadRolekitConfig(refPath), 'implementer', registry),
        /\/executors\/test-profile\/options\/model/u,
      )
    })
  })

  it('allows literal secret fields but redacts them from compiled snapshots, digests, and errors', async () => {
    await withTemporaryDirectory(async (directory) => {
      const adapter = new TrackingAdapter()
      const firstDirectory = join(directory, 'first')
      const secondDirectory = join(directory, 'second')
      await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)])
      const firstPath = await writeAdapterFixture(firstDirectory, {
        environment: { XAI_API_KEY: 'first-literal-secret' },
      })
      const secondPath = await writeAdapterFixture(secondDirectory, {
        environment: { XAI_API_KEY: 'second-literal-secret' },
      })
      const registry = testRegistry(adapter)
      const first = await compileRoleBinding(
        await loadRolekitConfig(firstPath),
        'implementer',
        registry,
      )
      const second = await compileRoleBinding(
        await loadRolekitConfig(secondPath),
        'implementer',
        registry,
      )

      assert.deepEqual(first.requiredSecrets, [])
      assert.deepEqual(first.profilePublicOptions.environment, {
        XAI_API_KEY: { source: 'literal', redacted: true },
      })
      assert.equal(first.profileDigest, second.profileDigest)
      assert.doesNotMatch(JSON.stringify(first), /first-literal-secret/u)
      const runtime = await resolveRunBinding(first, registry, {})
      assert.equal(
        (runtime.adapterOptions as TestAdapterOptions).environment?.XAI_API_KEY,
        'first-literal-secret',
      )
      assert.doesNotMatch(JSON.stringify(runtime), /first-literal-secret/u)
    })
  })

  it('compiles a host-native profile but rejects adapter-backed run resolution', async () => {
    await withTemporaryDirectory(async (directory) => {
      await writeRole(join(directory, 'role.json'), 'reviewer', ['repository.read'])
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: role.json',
          '    executor: host-reviewer',
          'executors:',
          '  host-reviewer:',
          '    mode: host',
          '    executorId: host-native',
          '    transport: remote',
          '    capabilities: [repository.read]',
          '    requestedProvider: host-provider',
          '    requestedModel: host-model',
          '    pathEnforcement: host',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '',
        ].join('\n'),
        'utf8',
      )

      const host = await compileRoleBinding(
        await loadRolekitConfig(configPath),
        'reviewer',
        createAdapterRegistry([]),
      )
      assert.equal(host.capabilitySource, 'host-attested')
      assert.equal(host.executorId, 'host-native')
      assert.equal(host.descriptor.transport, 'remote')
      assert.deepEqual(host.requiredSecrets, [])
      assert.equal('inspectionPreparedOptions' in host, false)
      await assert.rejects(
        resolveRunBinding(host, createAdapterRegistry([]), {}),
        /host_execution_required/u,
      )
    })
  })

  it('requires role keys to match RoleSpec ids and reports both source paths', async () => {
    await withTemporaryDirectory(async (directory) => {
      await writeRole(join(directory, 'role.json'), 'actual-role')
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  configured-role:',
          '    spec: role.json',
          '    executor: host',
          'executors:',
          '  host:',
          '    mode: host',
          '    executorId: host',
          '    transport: in-process',
          '    capabilities: [repository.read]',
          '    pathEnforcement: advisory',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '',
        ].join('\n'),
        'utf8',
      )

      await assert.rejects(
        compileRoleBinding(
          await loadRolekitConfig(configPath),
          'configured-role',
          createAdapterRegistry([]),
        ),
        /rolekit\.yaml.*\/roles\/configured-role.*role\.json.*actual-role/u,
      )
    })
  })

  it('selects exactly one explicit override and never falls back', async () => {
    await withTemporaryDirectory(async (directory) => {
      const adapter = new TrackingAdapter()
      const configPath = await writeAdapterFixture(directory, {})
      const loaded = await loadRolekitConfig(configPath)
      await assert.rejects(
        compileRoleBinding(loaded, 'implementer', testRegistry(adapter), 'test_profile'),
        /unknown_executor_profile.*test_profile/u,
      )
      const compiled = await compileRoleBinding(
        loaded,
        'implementer',
        testRegistry(adapter),
        'test-profile',
      )
      assert.equal(compiled.executorProfileId, 'test-profile')
    })
  })

  it('normalizes adapter paths relative to the file that declared the inherited profile', async () => {
    await withTemporaryDirectory(async (directory) => {
      const profilesDirectory = join(directory, 'profiles')
      await mkdir(profilesDirectory)
      await writeRole(join(directory, 'role.json'), 'implementer')
      await writeFile(
        join(profilesDirectory, 'base.yaml'),
        [
          'schema: rolekit/config@1',
          'roles: {}',
          'executors:',
          '  inherited-pi:',
          '    mode: adapter',
          '    adapter: pi',
          '    options:',
          '      tools: [read]',
          '      extensions: [./extension.ts]',
          '',
        ].join('\n'),
        'utf8',
      )
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'extends: [profiles/base.yaml]',
          'roles:',
          '  implementer:',
          '    spec: role.json',
          '    executor: inherited-pi',
          'executors: {}',
          '',
        ].join('\n'),
        'utf8',
      )

      const compiled = await compileRoleBinding(
        await loadRolekitConfig(configPath),
        'implementer',
        createBuiltInAdapterRegistry(),
      )
      const canonicalProfilesDirectory = await realpath(profilesDirectory)
      const normalizedExtensionPath = join(canonicalProfilesDirectory, 'extension.ts')
      assert.equal(compiled.profile.mode, 'adapter')
      assert.deepEqual(compiled.profile.options?.extensions, [normalizedExtensionPath])
      assert.deepEqual(compiled.profilePublicOptions.extensions, [normalizedExtensionPath])
    })
  })

  it('hashes exactly one canonical executor-profile preimage', async () => {
    const normalizedProfile: AdapterExecutorProfileConfig = {
      mode: 'adapter',
      adapter: 'test',
      options: {
        environment: {
          TOKEN: { source: 'env', name: 'TOKEN', redacted: true },
        },
        model: 'requested-model',
      },
    }
    const input = {
      schema: 'rolekit/executor-profile@1' as const,
      profileId: 'profile',
      normalizedProfile,
    }
    assert.equal(await digestExecutorProfile(input), await digestJson(input))
  })

  it('compiles every profile in the checked-in example without environment values', async () => {
    const loaded = await loadRolekitConfig(resolve('examples/rolekit.yaml'))
    const registry = createBuiltInAdapterRegistry()
    const implementer = await compileRoleBinding(loaded, 'implementer', registry)
    const reviewer = await compileRoleBinding(loaded, 'reviewer', registry)
    const piOneShotImplementer = await compileRoleBinding(
      loaded,
      'implementer',
      registry,
      'pi-one-shot-implementer',
    )
    const piOneShotReviewer = await compileRoleBinding(
      loaded,
      'reviewer',
      registry,
      'pi-one-shot-reviewer',
    )
    const codex = await compileRoleBinding(loaded, 'reviewer', registry, 'codex-reviewer')
    const host = await compileRoleBinding(loaded, 'reviewer', registry, 'host-reviewer')

    assert.equal(implementer.executorProfileId, 'pi-rpc-implementer')
    assert.equal(implementer.executorId, 'pi-rpc')
    assert.equal(reviewer.executorProfileId, 'pi-rpc-reviewer')
    assert.equal(reviewer.executorId, 'pi-rpc')
    assert.equal(piOneShotImplementer.executorId, 'pi')
    assert.equal(piOneShotReviewer.executorId, 'pi')
    assert.equal(codex.executorId, 'codex')
    assert.equal(host.capabilitySource, 'host-attested')
    assert.deepEqual(implementer.requiredSecrets, ['XAI_API_KEY'])
    assert.deepEqual(codex.requiredSecrets, ['OPENAI_API_KEY'])
  })

  it('returns built-in Pi RPC runtime options with resolved secrets and public markers', async () => {
    const loaded = await loadRolekitConfig(resolve('examples/rolekit.yaml'))
    const registry = createBuiltInAdapterRegistry()
    const compiled = await compileRoleBinding(loaded, 'implementer', registry)
    const runtime = await resolveRunBinding(compiled, registry, {
      XAI_API_KEY: 'example-runtime-secret',
    })
    assert.equal(
      (runtime.adapterOptions as PiRpcAdapterOptions).environment?.XAI_API_KEY,
      'example-runtime-secret',
    )
    const prepared = runtime.adapter.prepareOptions(
      runtime.adapterOptions,
      runtime.publicOptionContext,
    )
    assert.deepEqual(prepared.sensitiveValues, ['example-runtime-secret'])
    assert.doesNotMatch(JSON.stringify(prepared.publicOptions), /example-runtime-secret/u)
  })

  it('treats compiled adapter bindings as opaque handles and rejects clones without leaking literals', async () => {
    await withTemporaryDirectory(async (directory) => {
      const adapter = new TrackingAdapter()
      const configPath = await writeAdapterFixture(directory, {
        environment: { XAI_API_KEY: 'opaque-literal-secret' },
      })
      const registry = testRegistry(adapter)
      const compiled = await compileRoleBinding(
        await loadRolekitConfig(configPath),
        'implementer',
        registry,
      )
      const cloned = structuredClone(compiled)
      assert.doesNotMatch(JSON.stringify(compiled), /opaque-literal-secret/u)
      assert.doesNotMatch(JSON.stringify(cloned), /opaque-literal-secret/u)
      await assert.rejects(
        resolveRunBinding(cloned, registry, {}),
        /opaque runtime handle.*cloned|cloned.*opaque runtime handle/u,
      )
      const runtime = await resolveRunBinding(compiled, registry, {})
      assert.equal(
        (runtime.adapterOptions as TestAdapterOptions).environment?.XAI_API_KEY,
        'opaque-literal-secret',
      )
    })
  })

  it('keeps adapter registries opaque instead of exposing erased unknown-input registrations', () => {
    const registry = testRegistry(new TrackingAdapter())
    assert.deepEqual(Object.keys(registry), [])
    assert.equal('get' in registry, false)
    assert.equal('entries' in registry, false)
    assert.equal(JSON.stringify(registry), '{}')
  })

  it('preserves a required secret object property through static inspection', async () => {
    await withTemporaryDirectory(async (directory) => {
      await writeRole(join(directory, 'role.json'), 'reviewer')
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: role.json',
          '    executor: structured',
          'executors:',
          '  structured:',
          '    mode: adapter',
          '    adapter: structured',
          '    options:',
          '      credential:',
          '        token: { $env: REQUIRED_TOKEN }',
          '',
        ].join('\n'),
        'utf8',
      )
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['credential'],
        properties: {
          credential: {
            type: 'object',
            additionalProperties: false,
            required: ['token'],
            properties: { token: SecretStringConfigSchema },
          },
        },
      } as const as JsonSchema<JsonObject>
      const adapter = new StructureCheckingAdapter(
        (options) => {
          const credential = options.credential as Readonly<Record<string, unknown>>
          assert.equal(Object.hasOwn(credential, 'token'), true)
          assert.equal(typeof credential.token, 'string')
        },
        () => ({ credential: { token: randomUUID() } }),
      )
      const registry = createAdapterRegistry([
        defineAdapterRegistration({
          id: 'structured',
          configOptionsSchema: schema,
          create: () => adapter,
        }),
      ])
      const compiled = await inspectExecutorProfile(
        await loadRolekitConfig(configPath),
        'structured',
        registry,
      )
      assert.deepEqual(compiled.requiredSecrets, ['REQUIRED_TOKEN'])
      assert.equal(compiled.capabilitySource, 'adapter-verified')
      if (compiled.capabilitySource !== 'adapter-verified') {
        assert.fail('Expected an adapter-verified binding.')
      }
      assert.doesNotMatch(
        JSON.stringify(compiled.inspectionPreparedOptions),
        /rolekit-non-secret-static-placeholder/u,
      )
      assert.equal(
        Object.hasOwn(
          (compiled.inspectionPreparedOptions.executionOptions as JsonObject)
            .credential as JsonObject,
          'token',
        ),
        true,
      )
      const probe = await probeExecutorProfile(compiled, directory)
      assert.equal(probe.available, true, probe.diagnostic)
    })
  })

  it('preserves secret array length and tuple positions through static inspection', async () => {
    await withTemporaryDirectory(async (directory) => {
      await writeRole(join(directory, 'role.json'), 'reviewer')
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer:',
          '    spec: role.json',
          '    executor: structured',
          'executors:',
          '  structured:',
          '    mode: adapter',
          '    adapter: structured',
          '    options:',
          '      items: [{ $env: ARRAY_TOKEN }]',
          '      tuple: [public, tuple-literal-secret]',
          '',
        ].join('\n'),
        'utf8',
      )
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'tuple'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            items: SecretStringConfigSchema,
          },
          tuple: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            prefixItems: [{ type: 'string' }, SecretStringConfigSchema],
            items: false,
          },
        },
      } as const as JsonSchema<JsonObject>
      const adapter = new StructureCheckingAdapter(
        (options) => {
          assert.equal((options.items as readonly unknown[]).length, 1)
          assert.equal((options.tuple as readonly unknown[]).length, 2)
          assert.equal(typeof (options.items as readonly unknown[])[0], 'string')
          assert.equal(typeof (options.tuple as readonly unknown[])[1], 'string')
        },
        () => ({ items: [randomUUID()], tuple: ['public', randomUUID()] }),
      )
      const registry = createAdapterRegistry([
        defineAdapterRegistration({
          id: 'structured',
          configOptionsSchema: schema,
          create: () => adapter,
        }),
      ])
      const compiled = await inspectExecutorProfile(
        await loadRolekitConfig(configPath),
        'structured',
        registry,
      )
      if (compiled.capabilitySource !== 'adapter-verified') {
        assert.fail('Expected an adapter-verified binding.')
      }
      const publicInspection = compiled.inspectionPreparedOptions.executionOptions as JsonObject
      assert.equal((publicInspection.items as readonly unknown[]).length, 1)
      assert.equal((publicInspection.tuple as readonly unknown[]).length, 2)
      assert.doesNotMatch(JSON.stringify(compiled), /tuple-literal-secret/u)
      assert.doesNotMatch(JSON.stringify(compiled), /rolekit-non-secret-static-placeholder/u)
      const probe = await probeExecutorProfile(compiled, directory)
      assert.equal(probe.available, true, probe.diagnostic)
    })
  })

  it('accepts ordinary adapter metadata with a non-secret source field in digest input', async () => {
    await digestExecutorProfile({
      schema: 'rolekit/executor-profile@1',
      profileId: 'profile',
      normalizedProfile: {
        mode: 'adapter',
        adapter: 'test',
        options: { metadata: { source: 'catalog', name: 'ordinary' } },
      },
    })
  })

  it('accepts ordinary adapter metadata with redacted false in digest input', async () => {
    await digestExecutorProfile({
      schema: 'rolekit/executor-profile@1',
      profileId: 'profile',
      normalizedProfile: {
        mode: 'adapter',
        adapter: 'test',
        options: { metadata: { redacted: false, value: 'public' } },
      },
    })
  })

  it('rejects malformed public-secret marker attempts in digest input', async () => {
    const malformedMarkers: readonly JsonObject[] = [
      { source: 'env', redacted: true },
      { source: 'env', name: 'TOKEN', redacted: false },
      { redacted: true, value: 'public' },
    ]
    for (const marker of malformedMarkers) {
      await assert.rejects(
        digestExecutorProfile({
          schema: 'rolekit/executor-profile@1',
          profileId: 'profile',
          normalizedProfile: {
            mode: 'adapter',
            adapter: 'test',
            options: { marker },
          },
        }),
        /unsafe public secret marker/u,
      )
    }
  })

  it('strictly validates the exact executor-profile digest preimage', async () => {
    const valid = {
      schema: 'rolekit/executor-profile@1' as const,
      profileId: 'profile',
      normalizedProfile: {
        mode: 'adapter' as const,
        adapter: 'test',
        options: {
          environment: {
            TOKEN: { source: 'env', name: 'TOKEN', redacted: true },
          },
        },
      },
    }
    await digestExecutorProfile(valid)
    await digestExecutorProfile({
      ...valid,
      normalizedProfile: {
        mode: 'adapter',
        adapter: 'test',
        options: { resource: { name: 'ordinary-public-name' } },
      },
    })
    const invalidInputs: readonly unknown[] = [
      { ...valid, publicOptions: {} },
      { ...valid, normalizedProfile: { ...valid.normalizedProfile, privateState: true } },
      {
        ...valid,
        normalizedProfile: {
          ...valid.normalizedProfile,
          options: { token: { $env: 'TOKEN' } },
        },
      },
      {
        ...valid,
        normalizedProfile: {
          ...valid.normalizedProfile,
          options: { token: 'rolekit-non-secret-static-placeholder' },
        },
      },
      {
        ...valid,
        normalizedProfile: {
          ...valid.normalizedProfile,
          options: { token: { source: 'literal', redacted: true, extra: true } },
        },
      },
      {
        ...valid,
        normalizedProfile: {
          mode: 'host',
          executorId: 'host',
          transport: 'remote',
          capabilities: ['not-a-capability'],
          pathEnforcement: 'host',
          contextIsolation: TEST_DESCRIPTOR.features.contextIsolation,
        },
      },
    ]
    for (const input of invalidInputs) {
      await assert.rejects(
        digestExecutorProfile(input as Parameters<typeof digestExecutorProfile>[0]),
        /invalid_config|digest input|normalized profile/u,
      )
    }
  })

  it('uses exact own-key lookup for Object-prototype role and profile identifiers', async () => {
    await withTemporaryDirectory(async (directory) => {
      for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
        await writeRole(join(directory, `${id}.json`), id)
      }
      const configuredPath = join(directory, 'configured.yaml')
      await writeFile(
        configuredPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  constructor: { spec: constructor.json, executor: constructor }',
          '  toString: { spec: toString.json, executor: toString }',
          '  hasOwnProperty: { spec: hasOwnProperty.json, executor: hasOwnProperty }',
          'executors:',
          ...['constructor', 'toString', 'hasOwnProperty'].flatMap((id) => [
            `  ${id}:`,
            '    mode: host',
            `    executorId: ${id}`,
            '    transport: in-process',
            '    capabilities: [repository.read]',
            '    pathEnforcement: advisory',
            '    contextIsolation:',
            '      userConfig: isolated',
            '      projectInstructions: isolated',
            '      projectResources: isolated',
            '      environment: minimal',
            '      credentials: explicit',
          ]),
          '',
        ].join('\n'),
        'utf8',
      )
      const configured = await loadRolekitConfig(configuredPath)
      for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
        const compiled = await compileRoleBinding(configured, id, createAdapterRegistry([]))
        assert.equal(compiled.executorProfileId, id)
      }

      await writeRole(join(directory, 'ordinary.json'), 'ordinary')
      const absentPath = join(directory, 'absent.yaml')
      await writeFile(
        absentPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  ordinary: { spec: ordinary.json, executor: ordinary }',
          'executors:',
          '  ordinary:',
          '    mode: host',
          '    executorId: ordinary',
          '    transport: in-process',
          '    capabilities: [repository.read]',
          '    pathEnforcement: advisory',
          '    contextIsolation:',
          '      userConfig: isolated',
          '      projectInstructions: isolated',
          '      projectResources: isolated',
          '      environment: minimal',
          '      credentials: explicit',
          '',
        ].join('\n'),
        'utf8',
      )
      const absent = await loadRolekitConfig(absentPath)
      for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
        await assert.rejects(
          compileRoleBinding(absent, id, createAdapterRegistry([])),
          /unknown_role/u,
        )
        await assert.rejects(
          compileRoleBinding(absent, 'ordinary', createAdapterRegistry([]), id),
          /unknown_executor_profile/u,
        )
      }
    })
  })

  it('preserves declaring role provenance for spec read, parse, and extension failures', async () => {
    await withTemporaryDirectory(async (directory) => {
      const baseDirectory = join(directory, 'base')
      await mkdir(baseDirectory)
      const cases: readonly {
        readonly name: string
        readonly spec: string
        readonly content?: string
      }[] = [
        { name: 'missing', spec: 'missing.json' },
        { name: 'parse', spec: 'parse.json', content: '{ "schema": "broken" ' },
        { name: 'extension', spec: 'role.txt', content: 'not parsed' },
      ]
      for (const candidate of cases) {
        if (candidate.content !== undefined) {
          await writeFile(join(baseDirectory, candidate.spec), candidate.content, 'utf8')
        }
        const basePath = join(baseDirectory, `${candidate.name}.yaml`)
        await writeFile(
          basePath,
          [
            'schema: rolekit/config@1',
            'roles:',
            `  reviewer: { spec: ${candidate.spec}, executor: host }`,
            'executors:',
            '  host:',
            '    mode: host',
            '    executorId: host',
            '    transport: in-process',
            '    capabilities: [repository.read]',
            '    pathEnforcement: advisory',
            '    contextIsolation:',
            '      userConfig: isolated',
            '      projectInstructions: isolated',
            '      projectResources: isolated',
            '      environment: minimal',
            '      credentials: explicit',
            '',
          ].join('\n'),
          'utf8',
        )
        const rootPath = join(directory, `${candidate.name}.yaml`)
        await writeFile(
          rootPath,
          [
            'schema: rolekit/config@1',
            `extends: [base/${candidate.name}.yaml]`,
            'roles: {}',
            'executors: {}',
            '',
          ].join('\n'),
          'utf8',
        )
        const declaringPath = await realpath(basePath)
        await assert.rejects(
          compileRoleBinding(
            await loadRolekitConfig(rootPath),
            'reviewer',
            createAdapterRegistry([]),
          ),
          (error: unknown) => {
            assert.equal(error instanceof RolekitConfigError, true)
            const configError = error as RolekitConfigError
            assert.equal(configError.sourcePath, declaringPath)
            assert.equal(configError.pointer, '/roles/reviewer/spec')
            assert.match(configError.message, new RegExp(candidate.spec.replace('.', '\\.'), 'u'))
            return true
          },
        )
      }
    })
  })

  it('attributes missing default executors to declarations and distinguishes caller overrides', async () => {
    await withTemporaryDirectory(async (directory) => {
      const baseDirectory = join(directory, 'base')
      await mkdir(baseDirectory)
      await writeRole(join(baseDirectory, 'role.json'), 'reviewer')
      const basePath = join(baseDirectory, 'base.yaml')
      await writeFile(
        basePath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  reviewer: { spec: role.json, executor: missing-default }',
          'executors: {}',
          '',
        ].join('\n'),
        'utf8',
      )
      const rootPath = join(directory, 'rolekit.yaml')
      await writeFile(
        rootPath,
        [
          'schema: rolekit/config@1',
          'extends: [base/base.yaml]',
          'roles: {}',
          'executors: {}',
          '',
        ].join('\n'),
        'utf8',
      )
      const loaded = await loadRolekitConfig(rootPath)
      const declaringPath = await realpath(basePath)
      await assert.rejects(
        compileRoleBinding(loaded, 'reviewer', createAdapterRegistry([])),
        (error: unknown) => {
          const configError = error as RolekitConfigError
          assert.equal(configError.sourcePath, declaringPath)
          assert.equal(configError.pointer, '/roles/reviewer/executor')
          return true
        },
      )
      await assert.rejects(
        compileRoleBinding(loaded, 'reviewer', createAdapterRegistry([]), 'caller-missing'),
        (error: unknown) => {
          const configError = error as RolekitConfigError
          assert.match(configError.message, /caller-supplied executor override/u)
          assert.notEqual(configError.pointer, '/roles/reviewer/executor')
          return true
        },
      )
    })
  })

  it('compiles capability-denied profiles so task-aware admission can bind a blocked plan', async () => {
    await withTemporaryDirectory(async (directory) => {
      await writeRole(join(directory, 'implementer.json'), 'implementer', [
        'repository.read',
        'repository.write',
        'shell',
      ])
      const configPath = join(directory, 'rolekit.yaml')
      await writeFile(
        configPath,
        [
          'schema: rolekit/config@1',
          'roles:',
          '  implementer: { spec: implementer.json, executor: pi-read-only }',
          'executors:',
          '  pi-read-only:',
          '    mode: adapter',
          '    adapter: pi',
          '    options: { tools: [read, grep, find, ls] }',
          '  pi-write:',
          '    mode: adapter',
          '    adapter: pi',
          '    options: { tools: [read, edit, write, bash] }',
          '',
        ].join('\n'),
        'utf8',
      )
      const task: TaskPacket = {
        schema: 'rolekit/task-packet@1',
        taskId: 'capability-task',
        roleId: 'implementer',
        objective: 'Exercise task-aware admission.',
        input: {},
        context: [],
        constraints: [],
        acceptanceCriteria: [],
        expectedArtifacts: [],
      }
      const loaded = await loadRolekitConfig(configPath)
      const registry = createBuiltInAdapterRegistry()
      const denied = await compileRoleBinding(loaded, 'implementer', registry)
      const deniedTarget = compileTaskExecutionTarget(denied, task)
      assert.equal(deniedTarget.admission.allowed, false)
      assert.equal(deniedTarget.admission.blockedError.code, 'capability_mismatch')

      const writable = await compileRoleBinding(loaded, 'implementer', registry, 'pi-write')
      assert.deepEqual(writable.descriptor.capabilities, [
        'repository.read',
        'repository.write',
        'shell',
      ])
      assert.equal(compileTaskExecutionTarget(writable, task).admission.allowed, true)

      const deniedOverride = await compileRoleBinding(
        loaded,
        'implementer',
        registry,
        'pi-read-only',
      )
      assert.equal(compileTaskExecutionTarget(deniedOverride, task).admission.allowed, false)
    })
  })

  it('normalizes host capabilities before descriptor construction and profile digesting', async () => {
    await withTemporaryDirectory(async (directory) => {
      const makeHost = async (
        child: string,
        capabilities: readonly string[],
        pathEnforcement: 'advisory' | 'host',
      ) => {
        const childDirectory = join(directory, child)
        await mkdir(childDirectory)
        await writeRole(join(childDirectory, 'role.json'), 'reviewer')
        const configPath = join(childDirectory, 'rolekit.yaml')
        await writeFile(
          configPath,
          [
            'schema: rolekit/config@1',
            'roles:',
            '  reviewer: { spec: role.json, executor: host }',
            'executors:',
            '  host:',
            '    mode: host',
            '    executorId: host',
            '    transport: remote',
            `    capabilities: [${capabilities.join(', ')}]`,
            `    pathEnforcement: ${pathEnforcement}`,
            '    contextIsolation:',
            '      userConfig: isolated',
            '      projectInstructions: isolated',
            '      projectResources: isolated',
            '      environment: minimal',
            '      credentials: explicit',
            '',
          ].join('\n'),
          'utf8',
        )
        return compileRoleBinding(
          await loadRolekitConfig(configPath),
          'reviewer',
          createAdapterRegistry([]),
        )
      }
      const first = await makeHost(
        'first',
        ['shell', 'repository.read', 'repository.write'],
        'advisory',
      )
      const second = await makeHost(
        'second',
        ['repository.write', 'shell', 'repository.read'],
        'advisory',
      )
      const changed = await makeHost(
        'changed',
        ['repository.write', 'shell', 'repository.read'],
        'host',
      )
      assert.deepEqual(first.descriptor.capabilities, [
        'repository.read',
        'repository.write',
        'shell',
      ])
      assert.deepEqual(first.profile, second.profile)
      assert.equal(first.profileDigest, second.profileDigest)
      assert.notEqual(first.profileDigest, changed.profileDigest)
    })
  })

  it('redacts all hostile errors crossing compile and runtime adapter boundaries', async () => {
    await withTemporaryDirectory(async (directory) => {
      const literal = 'boundary-literal-secret'
      const configPath = await writeAdapterFixture(directory, {
        environment: { XAI_API_KEY: literal },
      })
      const thrownValues: readonly unknown[] = [
        new Error(literal),
        literal,
        new RolekitConfigError('invalid_config', literal),
        Object.defineProperty({}, 'message', {
          get() {
            throw new Error(literal)
          },
        }),
      ]
      for (const thrown of thrownValues) {
        const adapter = new TrackingAdapter()
        adapter.inspect = () => {
          throw thrown
        }
        await assert.rejects(
          compileRoleBinding(
            await loadRolekitConfig(configPath),
            'implementer',
            testRegistry(adapter),
          ),
          (error: unknown) => {
            assert.doesNotMatch(
              error instanceof Error ? error.message : String(error),
              new RegExp(literal, 'u'),
            )
            return true
          },
        )
      }

      const runtimeSecret = 'boundary-runtime-secret'
      const runtimeAdapter = new TrackingAdapter()
      const originalPrepare = runtimeAdapter.prepareOptions.bind(runtimeAdapter)
      runtimeAdapter.prepareOptions = (options, context) => {
        if ((options as TestAdapterOptions).environment?.XAI_API_KEY === runtimeSecret) {
          throw new RolekitConfigError('invalid_config', runtimeSecret)
        }
        return originalPrepare(options, context)
      }
      const runtimeConfig = await writeAdapterFixture(directory, {
        environment: { XAI_API_KEY: { $env: 'XAI_API_KEY' } },
      })
      const runtimeRegistry = testRegistry(runtimeAdapter)
      const compiled = await compileRoleBinding(
        await loadRolekitConfig(runtimeConfig),
        'implementer',
        runtimeRegistry,
      )
      await assert.rejects(
        resolveRunBinding(compiled, runtimeRegistry, { XAI_API_KEY: runtimeSecret }),
        (error: unknown) => {
          assert.doesNotMatch(
            error instanceof Error ? error.message : String(error),
            new RegExp(runtimeSecret, 'u'),
          )
          return true
        },
      )
    })
  })

  it('exposes config through its stable subpath without widening the root entry point', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      readonly exports?: Readonly<Record<string, unknown>>
    }
    assert.equal(Object.hasOwn(packageJson.exports ?? {}, './config'), true)
    const rootSource = await readFile(resolve('src/index.ts'), 'utf8')
    assert.doesNotMatch(rootSource, /from ['"]\.\/config\/index\.ts['"]/u)
  })
})

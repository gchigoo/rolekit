import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'

import { createExecutionPlan, Rolekit, RolekitError } from '../../src/core/index.ts'
import { freezeJsonSnapshot } from '../../src/core/json.ts'
import type {
  ExecutorAdapter,
  ExecutorDescriptor,
  ExecutorResponse,
  JsonObject,
  PreparedExecutorOptions,
  RoleSpec,
  RunEvent,
  RunOptions,
  Sha256Digest,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TaskPacket,
} from '../../src/core/types.ts'
import { checkAdapterConformance, FakeExecutorAdapter } from '../../src/testing/index.ts'

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
  requiredCapabilities: ['repository.read', 'repository.write'],
  inputSchema: Type.Object(
    { source: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  outputSchema: Type.Object(
    { message: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
}

const task: TaskPacket<ExampleInput> = {
  schema: 'rolekit/task-packet@1',
  taskId: 'task-1',
  roleId: role.id,
  objective: 'Create the requested report.',
  input: { source: 'README.md' },
  context: [],
  constraints: ['Keep the change bounded.'],
  acceptanceCriteria: ['The report is returned.'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const descriptor: ExecutorDescriptor = {
  schema: 'rolekit/executor-descriptor@2',
  adapterProtocol: 'rolekit/executor-adapter@1',
  adapterVersion: '1.0.0',
  id: 'fake',
  displayName: 'Fake executor',
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
    permissionCombinations: ['repository.read+repository.write'],
  },
}

function preparedSnapshot(
  executionOptions: JsonObject = {},
  publicOptions: JsonObject = executionOptions,
  sensitiveValues: readonly string[] = [],
): PreparedExecutorOptions<JsonObject> {
  return freezeJsonSnapshot(
    { executionOptions, publicOptions, sensitiveValues },
    'Test prepared executor options',
  ) as PreparedExecutorOptions<JsonObject>
}

const completedResponse: ExecutorResponse<ExampleOutput> = {
  status: 'completed',
  summary: 'Report created.',
  output: { message: 'done' },
  artifacts: [{ name: 'report', kind: 'text', content: 'done' }],
  evidence: [{ kind: 'note', value: 'fake execution' }],
  model: 'actual-model',
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

function hostileThenLookupProxy(): unknown {
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
      get(_target, property) {
        if (property === 'then') {
          throw nonCoercibleThrownValue
        }
        throw 'unexpected response access'
      },
    },
  )
}

describe('Rolekit', () => {
  it('normalizes a successful execution with actual executor identity and provenance', async () => {
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const rolekit = new Rolekit({
      roles: [role],
      adapters: [adapter],
      createRunId: () => 'run-1',
      now: () => new Date('2026-07-31T00:00:00.000Z'),
    })

    const result = await rolekit.run<ExampleInput, ExampleOutput>(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
      profile: {
        id: 'profile-1',
        digest: `sha256:${'1'.repeat(64)}`,
        requiredSecrets: ['TOKEN', 'API_KEY', 'TOKEN'],
      },
    })

    assert.equal(result.schema, 'rolekit/run-result@2')
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.output, { message: 'done' })
    assert.equal(result.executor.id, 'fake')
    assert.equal(result.executor.actualModel, 'actual-model')
    assert.equal(result.executor.profileId, 'profile-1')
    assert.equal(result.executor.profileDigest, `sha256:${'1'.repeat(64)}`)
    assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.equal(result.execution.planDigest, result.artifacts[0]?.provenance.planDigest)
    assert.deepEqual(result.artifacts[0]?.provenance, {
      runId: 'run-1',
      executorId: 'fake',
      planDigest: result.execution.planDigest,
    })
    assert.equal(result.startedAt, '2026-07-31T00:00:00.000Z')
    assert.equal(result.completedAt, '2026-07-31T00:00:00.000Z')
    assert.equal(adapter.invocations.length, 1)
  })

  it('emits lifecycle events for non-streaming adapters and contains callback failures', async () => {
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const callbackEvents: RunEvent[] = []
    const loggerEvents: unknown[] = []
    const rolekit = new Rolekit({
      roles: [role],
      adapters: [adapter],
      createRunId: () => 'lifecycle-only-run',
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      logger: (event) => loggerEvents.push(event),
    })

    const result = await rolekit.run(task, {
      executorId: adapter.id,
      cwd: '/workspace',
      adapterOptions: {},
      onEvent: (event) => {
        callbackEvents.push(event)
        throw new Error('host callback failed')
      },
    })

    assert.equal(result.status, 'completed')
    assert.deepEqual(
      callbackEvents.map((event) =>
        event.type === 'lifecycle' ? `${event.sequence}:${event.phase}` : event.type,
      ),
      ['1:started', '2:completed'],
    )
    assert.deepEqual(loggerEvents, [
      {
        type: 'diagnostic',
        level: 'error',
        message: 'Run event callback failed: host callback failed',
      },
    ])
  })

  it('emits a blocked lifecycle terminal event for runtime probe admission failure', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      probe: {
        available: false,
        featureChecks: { version: false },
        diagnostic: 'Fake executor is unavailable.',
      },
    })
    const events: RunEvent[] = []
    const rolekit = new Rolekit({
      roles: [role],
      adapters: [adapter],
      createRunId: () => 'blocked-event-run',
      now: () => new Date('2026-07-31T00:00:00.000Z'),
    })

    const result = await rolekit.run(task, {
      executorId: adapter.id,
      cwd: '/workspace',
      adapterOptions: {},
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.status, 'blocked')
    assert.deepEqual(
      events.map((event) => (event.type === 'lifecycle' ? event.phase : event.type)),
      ['started', 'blocked'],
    )
    assert.equal(adapter.invocations.length, 0)
  })

  it('emits a failed lifecycle terminal event when static admission throws', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      admission: () => {
        throw new Error('static admission failed')
      },
    })
    const events: RunEvent[] = []
    const rolekit = new Rolekit({
      roles: [role],
      adapters: [adapter],
      createRunId: () => 'failed-admission-event-run',
      now: () => new Date('2026-07-31T00:00:00.000Z'),
    })

    await assert.rejects(
      rolekit.run(task, {
        executorId: adapter.id,
        cwd: '/workspace',
        adapterOptions: {},
        onEvent: (event) => events.push(event),
      }),
      /admission failed: static admission failed/u,
    )

    assert.deepEqual(
      events.map((event) => (event.type === 'lifecycle' ? event.phase : event.type)),
      ['started', 'failed'],
    )
    assert.equal(adapter.probeCount, 0)
    assert.equal(adapter.invocations.length, 0)
  })

  it('runs the adapter protocol in prepare, inspect, static admit, probe, runtime admit, execute order', async () => {
    const calls: string[] = []
    const secret = 'prepared-runtime-secret'
    const protocolAdapter = {
      id: 'protocol',
      sensitiveOptionPointers: ['/environment'],
      prepareOptions(options: unknown) {
        calls.push('prepare')
        return freezeJsonSnapshot(
          {
            executionOptions: { options, environment: { TOKEN: secret } },
            publicOptions: {
              environment: {
                TOKEN: { source: 'literal', redacted: true },
              },
            },
            sensitiveValues: [secret],
            requestedModel: 'requested-only-model',
          },
          'Protocol test prepared options',
        )
      },
      inspect() {
        calls.push('inspect')
        return {
          schema: 'rolekit/executor-descriptor@2',
          adapterProtocol: 'rolekit/executor-adapter@1',
          adapterVersion: '1.0.0',
          id: 'protocol',
          displayName: 'Protocol executor',
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
            permissionCombinations: ['repository.read+repository.write'],
          },
        }
      },
      async probe(_prepared: unknown, context: { readonly cwd: string }) {
        calls.push(`probe:${context.cwd}`)
        return {
          available: true as const,
          executorVersion: 'runtime-version',
          featureChecks: { version: true, help: true },
        }
      },
      admit(
        _role: RoleSpec,
        _task: TaskPacket,
        prepared: { readonly publicOptions: Readonly<Record<string, unknown>> },
        probe?: { readonly available: boolean },
      ) {
        calls.push(probe === undefined ? 'admit:static' : 'admit:runtime')
        return {
          allowed: true as const,
          effectiveCapabilities: ['repository.read', 'repository.write', 'shell'],
          effectivePublicOptions: prepared.publicOptions,
          pathEnforcement: 'advisory' as const,
          contextIsolation: {
            userConfig: 'isolated' as const,
            projectInstructions: 'isolated' as const,
            projectResources: 'isolated' as const,
            environment: 'minimal' as const,
            credentials: 'explicit' as const,
          },
        }
      },
      async execute(
        _role: RoleSpec,
        _task: TaskPacket,
        context: {
          readonly options: Readonly<Record<string, unknown>>
          readonly sensitiveValues: readonly string[]
          readonly admission: { readonly allowed: boolean }
        },
      ): Promise<ExecutorResponse> {
        calls.push('execute')
        assert.deepEqual(context.sensitiveValues, [secret])
        assert.equal(context.admission.allowed, true)
        assert.deepEqual(context.options.environment, { TOKEN: secret })
        return {
          status: 'completed',
          summary: completedResponse.summary,
          output: completedResponse.output,
          artifacts: completedResponse.artifacts,
          evidence: completedResponse.evidence,
        }
      },
    } as unknown as ExecutorAdapter
    const rolekit = new Rolekit({ roles: [role], adapters: [protocolAdapter] })

    const result = await rolekit.run(task, {
      executorId: 'protocol',
      cwd: '/execution/project',
      adapterOptions: { model: 'requested-only-model' },
    })

    assert.deepEqual(calls, [
      'prepare',
      'inspect',
      'admit:static',
      'probe:/execution/project',
      'admit:runtime',
      'execute',
    ])
    assert.equal(result.status, 'completed')
    assert.equal(result.executor.executorVersion, 'runtime-version')
    assert.equal(result.executor.requestedModel, 'requested-only-model')
    assert.equal(result.executor.actualModel, undefined)
  })

  it('snapshots run options before caller mutation during probe and plan hashing', async () => {
    let releaseProbe: (() => void) | undefined
    let markProbeStarted: (() => void) | undefined
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve
    })
    let releaseDigest: (() => void) | undefined
    let markDigestStarted: (() => void) | undefined
    const digestStarted = new Promise<void>((resolve) => {
      markDigestStarted = resolve
    })
    let digestCount = 0
    let observedProbeCwd: string | undefined
    let observedExecutionCwd: string | undefined
    const admission = {
      allowed: true as const,
      effectiveCapabilities: descriptor.capabilities,
      effectivePublicOptions: {},
      pathEnforcement: 'advisory' as const,
      contextIsolation: descriptor.features.contextIsolation,
    }
    const adapter: ExecutorAdapter = {
      id: descriptor.id,
      prepareOptions: () => preparedSnapshot(),
      inspect: () => descriptor,
      async probe(_prepared, context) {
        observedProbeCwd = context.cwd
        markProbeStarted?.()
        await new Promise<void>((resolve) => {
          releaseProbe = resolve
        })
        return { available: true, executorVersion: 'runtime-version', featureChecks: {} }
      },
      admit: () => admission,
      async execute(_role, _task, context) {
        observedExecutionCwd = context.cwd
        return completedResponse
      },
    }
    const rolekit = new Rolekit({
      roles: [role],
      adapters: [adapter],
      now: () => new Date('2026-07-31T00:00:00.000Z'),
    })
    const originalProfile = {
      id: 'profile-original',
      digest: `sha256:${'4'.repeat(64)}` as Sha256Digest,
      requiredSecrets: ['TOKEN', 'API_KEY'],
    }
    const options: {
      executorId: string
      cwd: string
      adapterOptions: Record<string, never>
      profile: { id: string; digest: Sha256Digest; requiredSecrets: string[] }
      runId: string
    } = {
      executorId: 'fake',
      cwd: '/workspace/original',
      adapterOptions: {},
      profile: {
        id: originalProfile.id,
        digest: originalProfile.digest,
        requiredSecrets: [...originalProfile.requiredSecrets],
      },
      runId: 'run-option-snapshot',
    }
    const subtle = globalThis.crypto.subtle
    const originalOwnDigest = Object.getOwnPropertyDescriptor(subtle, 'digest')
    const originalDigest = subtle.digest
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      enumerable: true,
      writable: true,
      async value(...args: Parameters<typeof originalDigest>) {
        digestCount += 1
        if (digestCount === 1) {
          markDigestStarted?.()
          await new Promise<void>((resolve) => {
            releaseDigest = resolve
          })
        }
        return Reflect.apply(originalDigest, subtle, args) as Promise<ArrayBuffer>
      },
    })

    let result: Awaited<ReturnType<Rolekit['run']>> | undefined
    try {
      const resultPromise = rolekit.run(task, options)
      await probeStarted
      options.cwd = '/workspace/mutated-during-probe'
      options.profile.id = 'profile-mutated-during-probe'
      options.profile.digest = `sha256:${'5'.repeat(64)}` as Sha256Digest
      options.profile.requiredSecrets = ['MUTATED_PROBE_SECRET']
      releaseProbe?.()
      await digestStarted
      options.cwd = '/workspace/mutated-during-plan-hashing'
      options.profile.id = 'profile-mutated-during-plan-hashing'
      options.profile.digest = `sha256:${'6'.repeat(64)}` as Sha256Digest
      options.profile.requiredSecrets = ['MUTATED_HASH_SECRET']
      releaseDigest?.()
      result = await resultPromise
    } finally {
      if (originalOwnDigest === undefined) {
        Reflect.deleteProperty(subtle, 'digest')
      } else {
        Object.defineProperty(subtle, 'digest', originalOwnDigest)
      }
    }

    assert.ok(result)
    const storedRole = rolekit.getRole(role.id)
    assert.ok(storedRole)
    const expectedPlan = await createExecutionPlan({
      role: storedRole as unknown as SnapshotRoleSpec,
      task: task as unknown as SnapshotTaskPacket,
      target: {
        target: 'adapter',
        capabilitySource: 'adapter-verified',
        adapterProtocol: descriptor.adapterProtocol,
        adapterVersion: descriptor.adapterVersion,
        id: descriptor.id,
        transport: descriptor.transport,
        profileId: originalProfile.id,
        profileDigest: originalProfile.digest,
        requiredSecrets: originalProfile.requiredSecrets,
        admission,
      },
      workspace: { root: '/workspace/original' },
      runId: 'run-option-snapshot',
      createdAt: '2026-07-31T00:00:00.000Z',
    })
    assert.equal(observedProbeCwd, '/workspace/original')
    assert.equal(observedExecutionCwd, '/workspace/original')
    assert.equal(result.execution.contentDigest, expectedPlan.plan.contentDigest)
    assert.equal(result.executor.profileId, originalProfile.id)
    assert.equal(result.executor.profileDigest, originalProfile.digest)
    assert.equal(result.runId, 'run-option-snapshot')
  })

  it('rejects invalid cwd and profile provenance before probing', async () => {
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    const validProfile = {
      id: 'profile-1',
      digest: `sha256:${'7'.repeat(64)}` as Sha256Digest,
      requiredSecrets: ['TOKEN'],
    }
    const invalidOptions: readonly RunOptions[] = [
      { executorId: 'fake', cwd: '', adapterOptions: {}, runId: 'invalid-cwd' },
      {
        executorId: 'fake',
        cwd: '/workspace',
        adapterOptions: {},
        runId: 'invalid-profile-id',
        profile: { ...validProfile, id: '' },
      },
      {
        executorId: 'fake',
        cwd: '/workspace',
        adapterOptions: {},
        runId: 'invalid-profile-digest',
        profile: { ...validProfile, digest: 'sha256:not-a-digest' as Sha256Digest },
      },
      {
        executorId: 'fake',
        cwd: '/workspace',
        adapterOptions: {},
        runId: 'invalid-profile-secret',
        profile: { ...validProfile, requiredSecrets: [''] },
      },
    ]

    for (const invalid of invalidOptions) {
      await assert.rejects(
        rolekit.run(task, invalid),
        (error: unknown) => error instanceof RolekitError && error.code === 'invalid_contract',
      )
    }
    assert.equal(adapter.probeCount, 0)
  })

  it('rejects a response version that conflicts with the independently probed executor version', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      probe: {
        available: true,
        executorVersion: 'probed-runtime-version',
        featureChecks: { version: true },
      },
      response: { ...completedResponse, version: 'response-runtime-version' },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    await assert.rejects(
      rolekit.run(task, { executorId: 'fake', cwd: '/workspace', adapterOptions: {} }),
      (error: unknown) =>
        error instanceof RolekitError &&
        error.code === 'invalid_contract' &&
        /version/iu.test(error.message),
    )
  })

  it('makes captured-signal cancellation authoritative after execute resolves successfully', async () => {
    let markExecutionStarted: (() => void) | undefined
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve
    })
    let releaseExecution: (() => void) | undefined
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: async () => {
        markExecutionStarted?.()
        await new Promise<void>((resolve) => {
          releaseExecution = resolve
        })
        return completedResponse
      },
    })
    const controller = new AbortController()
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const resultPromise = rolekit.run(task, {
      executorId: 'fake',
      cwd: '/workspace',
      adapterOptions: {},
      signal: controller.signal,
    })
    await executionStarted
    controller.abort()
    releaseExecution?.()
    const result = await resultPromise

    assert.equal(result.status, 'cancelled')
    assert.equal(result.error.code, 'cancelled')
    assert.equal(result.output, undefined)
  })

  it('rejects mutable prepared execution and public snapshots before inspection', () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      preparedOptions: () => ({
        executionOptions: {},
        publicOptions: {},
        sensitiveValues: [],
      }),
    })
    const rolekit = new Rolekit({ adapters: [adapter] })

    assert.throws(
      () => rolekit.inspectExecutor(adapter.id, {}),
      (error: unknown) =>
        error instanceof RolekitError &&
        error.code === 'invalid_contract' &&
        /frozen/iu.test(error.message),
    )
    assert.equal(adapter.inspectCount, 0)
  })

  it('requires publicOptions to be a JSON object with no sensitive literal', () => {
    const secret = 'prepared-public-secret'
    for (const [name, preparedOptions] of [
      [
        'array',
        () =>
          freezeJsonSnapshot(
            { executionOptions: {}, publicOptions: [], sensitiveValues: [] },
            'Array public options',
          ),
      ],
      [
        'secret',
        () =>
          preparedSnapshot(
            { environment: { TOKEN: secret } },
            { nested: { diagnostic: `leaked ${secret}` } },
            [secret],
          ),
      ],
    ] as const) {
      const adapter = new FakeExecutorAdapter({
        descriptor,
        response: completedResponse,
        preparedOptions: preparedOptions as never,
      })
      const rolekit = new Rolekit({ adapters: [adapter] })
      assert.throws(
        () => rolekit.inspectExecutor(adapter.id, {}),
        (error: unknown) =>
          error instanceof RolekitError &&
          error.code === 'invalid_contract' &&
          new RegExp(name === 'array' ? 'publicOptions.*object' : 'sensitive', 'iu').test(
            error.message,
          ),
        name,
      )
    }
  })

  it('accepts public secret markers only below adapter-declared sensitive pointers', () => {
    const misplaced = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      preparedOptions: () => preparedSnapshot({}, { model: { source: 'literal', redacted: true } }),
    })
    assert.throws(
      () => new Rolekit({ adapters: [misplaced] }).inspectExecutor(misplaced.id, {}),
      /marker|sensitive.*pointer|\/model/iu,
    )

    const declared = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions: () =>
        preparedSnapshot(
          { environment: { TOKEN: 'secret' } },
          { environment: { TOKEN: { source: 'literal', redacted: true } } },
          ['secret'],
        ),
    })
    assert.doesNotThrow(() =>
      new Rolekit({ adapters: [declared] }).inspectExecutor(declared.id, {}),
    )
  })

  it('rejects sensitive literals inside prepared and effective public secret markers', () => {
    const secret = 'marker-name-secret'
    const markerWithSecret = { source: 'env' as const, name: secret, redacted: true as const }
    const preparedAdapter = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions: () =>
        preparedSnapshot(
          { environment: { TOKEN: secret } },
          { environment: { TOKEN: markerWithSecret } },
          [secret],
        ),
    })
    assert.throws(
      () => new Rolekit({ adapters: [preparedAdapter] }).inspectExecutor(preparedAdapter.id, {}),
      /marker|sensitive/iu,
    )

    const effectiveAdapter = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions: () =>
        preparedSnapshot(
          { environment: { TOKEN: secret } },
          { environment: { TOKEN: { source: 'literal', redacted: true } } },
          [secret],
        ),
      admission: () => ({
        allowed: true,
        effectiveCapabilities: descriptor.capabilities,
        effectivePublicOptions: { environment: { TOKEN: markerWithSecret } },
        pathEnforcement: 'advisory',
        contextIsolation: descriptor.features.contextIsolation,
      }),
    })
    assert.throws(
      () =>
        new Rolekit({ roles: [role], adapters: [effectiveAdapter] }).compile(task, {
          executorId: effectiveAdapter.id,
          adapterOptions: {},
        }),
      /effective public options|marker|sensitive/iu,
    )
  })

  it('rejects sensitive literals and misplaced markers in effective public options', () => {
    const secret = 'effective-public-secret'
    for (const [name, effectivePublicOptions] of [
      ['secret', { diagnostic: `leaked ${secret}` }],
      ['marker', { model: { source: 'literal', redacted: true } }],
    ] as const) {
      const adapter = new FakeExecutorAdapter({
        descriptor,
        response: completedResponse,
        preparedOptions: () =>
          preparedSnapshot(
            { environment: { TOKEN: secret } },
            { environment: { TOKEN: { source: 'literal', redacted: true } } },
            [secret],
          ),
        sensitiveOptionPointers: ['/environment'],
        admission: () => ({
          allowed: true,
          effectiveCapabilities: descriptor.capabilities,
          effectivePublicOptions,
          pathEnforcement: 'advisory',
          contextIsolation: descriptor.features.contextIsolation,
        }),
      })
      assert.throws(
        () =>
          new Rolekit({ roles: [role], adapters: [adapter] }).compile(task, {
            executorId: adapter.id,
            adapterOptions: {},
          }),
        (error: unknown) =>
          error instanceof RolekitError &&
          error.code === 'invalid_contract' &&
          /effective public options|marker|sensitive/iu.test(error.message),
        name,
      )
    }
  })

  it('redacts prepared secrets from inspect and admission protocol diagnostics', () => {
    const secret = 'post-prepare-protocol-secret'
    for (const phase of ['inspect', 'admit'] as const) {
      const adapter = new FakeExecutorAdapter({
        descriptor,
        response: completedResponse,
        sensitiveOptionPointers: ['/environment'],
        preparedOptions: () =>
          preparedSnapshot(
            { environment: { TOKEN: secret } },
            { environment: { TOKEN: { source: 'literal', redacted: true } } },
            [secret],
          ),
        ...(phase === 'inspect'
          ? {
              inspection: () => {
                throw new Error(`inspection exposed ${secret}`)
              },
            }
          : {}),
        ...(phase === 'admit'
          ? {
              admission: () => {
                throw new Error(`admission exposed ${secret}`)
              },
            }
          : {}),
      })
      assert.throws(
        () =>
          new Rolekit({ roles: [role], adapters: [adapter] }).compile(task, {
            executorId: adapter.id,
            adapterOptions: {},
          }),
        (error: unknown) => {
          assert.ok(error instanceof RolekitError)
          assert.doesNotMatch(error.message, new RegExp(secret, 'u'))
          assert.match(error.message, /\[REDACTED\]/u)
          return true
        },
        phase,
      )
    }
  })

  it('redacts prepared secrets from probe, returned admission, and execute diagnostics', async () => {
    const secret = 'post-prepare-runtime-secret'
    const preparedOptions = () =>
      preparedSnapshot(
        { environment: { TOKEN: secret } },
        { environment: { TOKEN: { source: 'literal', redacted: true } } },
        [secret],
      )

    const probing = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      probe: () => {
        throw new Error(`probe exposed ${secret}`)
      },
    })
    const probeResult = await new Rolekit({ roles: [role], adapters: [probing] }).run(task, {
      executorId: probing.id,
      cwd: '/project',
      adapterOptions: {},
    })
    assert.equal(probeResult.status, 'blocked')
    assert.doesNotMatch(JSON.stringify(probeResult), new RegExp(secret, 'u'))
    assert.match(JSON.stringify(probeResult), /\[REDACTED\]/u)

    const blocked = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      admission: ({ prepared, probe }) =>
        probe === undefined
          ? {
              allowed: true,
              effectiveCapabilities: descriptor.capabilities,
              effectivePublicOptions: prepared.publicOptions,
              pathEnforcement: 'advisory',
              contextIsolation: descriptor.features.contextIsolation,
            }
          : {
              allowed: false,
              effectiveCapabilities: descriptor.capabilities,
              effectivePublicOptions: prepared.publicOptions,
              pathEnforcement: 'advisory',
              contextIsolation: descriptor.features.contextIsolation,
              blockedError: {
                code: 'runtime_blocked',
                message: `runtime admission exposed ${secret}`,
                retryable: false,
              },
            },
    })
    const blockedResult = await new Rolekit({ roles: [role], adapters: [blocked] }).run(task, {
      executorId: blocked.id,
      cwd: '/project',
      adapterOptions: {},
    })
    assert.equal(blockedResult.status, 'blocked')
    assert.doesNotMatch(JSON.stringify(blockedResult), new RegExp(secret, 'u'))
    assert.match(JSON.stringify(blockedResult), /\[REDACTED\]/u)

    const executing = new FakeExecutorAdapter({
      descriptor,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      response: () => {
        throw new Error(`execute exposed ${secret}`)
      },
    })
    const executeResult = await new Rolekit({ roles: [role], adapters: [executing] }).run(task, {
      executorId: executing.id,
      cwd: '/project',
      adapterOptions: {},
    })
    assert.equal(executeResult.status, 'failed')
    assert.doesNotMatch(JSON.stringify(executeResult), new RegExp(secret, 'u'))
    assert.match(JSON.stringify(executeResult), /\[REDACTED\]/u)
  })

  it('conformance enforces prepared safety and redacts post-prepare protocol errors', async () => {
    const secret = 'conformance-protocol-secret'
    const mutable = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      preparedOptions: () => ({
        executionOptions: {},
        publicOptions: { leaked: secret },
        sensitiveValues: [secret],
      }),
    })
    const mutableReport = await checkAdapterConformance({
      adapter: mutable,
      role,
      task,
      runId: 'conformance-mutable',
      cwd: '/project',
      options: {},
    })
    assert.equal(mutableReport.valid, false)
    assert.match(mutableReport.errors.join('\n'), /frozen|sensitive/iu)
    assert.doesNotMatch(mutableReport.errors.join('\n'), new RegExp(secret, 'u'))

    const throwing = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions: () =>
        preparedSnapshot(
          { environment: { TOKEN: secret } },
          { environment: { TOKEN: { source: 'literal', redacted: true } } },
          [secret],
        ),
      inspection: () => {
        throw new Error(`conformance inspection exposed ${secret}`)
      },
    })
    const throwingReport = await checkAdapterConformance({
      adapter: throwing,
      role,
      task,
      runId: 'conformance-redaction',
      cwd: '/project',
      options: {},
    })
    const surface = JSON.stringify(throwingReport)
    assert.equal(throwingReport.valid, false)
    assert.doesNotMatch(surface, new RegExp(secret, 'u'))
    assert.match(surface, /\[REDACTED\]/u)
  })

  it('redacts all conformance validation and safety errors after preparation', async () => {
    const secret = 'conformance-validation-secret'
    const preparedOptions = () =>
      preparedSnapshot(
        { environment: { TOKEN: secret } },
        { environment: { TOKEN: { source: 'literal', redacted: true } } },
        [secret],
      )
    const safeAdmission = (
      prepared: PreparedExecutorOptions,
    ): ReturnType<ExecutorAdapter['admit']> => ({
      allowed: true,
      effectiveCapabilities: descriptor.capabilities,
      effectivePublicOptions: prepared.publicOptions,
      pathEnforcement: 'advisory',
      contextIsolation: descriptor.features.contextIsolation,
    })
    const reports = []

    const invalidDescriptor = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      inspection: () => ({ ...descriptor, [secret]: undefined }) as unknown as ExecutorDescriptor,
    })
    reports.push(
      await checkAdapterConformance({
        adapter: invalidDescriptor,
        role,
        task,
        runId: 'conformance-invalid-descriptor',
        cwd: '/project',
        options: {},
      }),
    )

    const invalidStaticAdmission = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      admission: ({ prepared }) => ({
        ...safeAdmission(prepared),
        effectivePublicOptions: { [secret]: undefined } as never,
      }),
    })
    reports.push(
      await checkAdapterConformance({
        adapter: invalidStaticAdmission,
        role,
        task,
        runId: 'conformance-invalid-static-admission',
        cwd: '/project',
        options: {},
      }),
    )

    const unsafeStaticAdmission = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      admission: ({ prepared }) => ({
        ...safeAdmission(prepared),
        effectivePublicOptions: { environment: { [secret]: 'safe' } },
      }),
    })
    reports.push(
      await checkAdapterConformance({
        adapter: unsafeStaticAdmission,
        role,
        task,
        runId: 'conformance-unsafe-static-admission',
        cwd: '/project',
        options: {},
      }),
    )

    const invalidProbe = new FakeExecutorAdapter({
      descriptor,
      response: completedResponse,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      probe: {
        available: true,
        featureChecks: { [secret]: undefined } as never,
      },
    })
    reports.push(
      await checkAdapterConformance({
        adapter: invalidProbe,
        role,
        task,
        runId: 'conformance-invalid-probe',
        cwd: '/project',
        options: {},
      }),
    )

    for (const [name, effectivePublicOptions] of [
      ['invalid', { [secret]: undefined } as never],
      ['unsafe', { environment: { [secret]: 'safe' } }],
    ] as const) {
      const invalidRuntimeAdmission = new FakeExecutorAdapter({
        descriptor,
        response: completedResponse,
        sensitiveOptionPointers: ['/environment'],
        preparedOptions,
        admission: ({ prepared, probe }) =>
          probe === undefined
            ? safeAdmission(prepared)
            : { ...safeAdmission(prepared), effectivePublicOptions },
      })
      reports.push(
        await checkAdapterConformance({
          adapter: invalidRuntimeAdmission,
          role,
          task,
          runId: `conformance-${name}-runtime-admission`,
          cwd: '/project',
          options: {},
        }),
      )
    }

    const secretOutputRole = {
      ...role,
      outputSchema: Type.Object({ [secret]: Type.Boolean() }, { additionalProperties: false }),
    } as unknown as RoleSpec
    const invalidResponse = new FakeExecutorAdapter({
      descriptor,
      sensitiveOptionPointers: ['/environment'],
      preparedOptions,
      response: {
        ...completedResponse,
        output: { [secret]: false },
      },
    })
    reports.push(
      await checkAdapterConformance({
        adapter: invalidResponse,
        role: secretOutputRole,
        task,
        runId: 'conformance-invalid-response',
        cwd: '/project',
        options: {},
      }),
    )

    for (const report of reports) {
      const errorSurface = report.errors.join('\n')
      assert.equal(report.valid, false)
      assert.doesNotMatch(errorSurface, new RegExp(secret, 'u'))
      assert.match(errorSurface, /\[REDACTED\]/u)
    }
  })

  it('returns invalid conformance reports for malformed boundary values without executing', async () => {
    const secret = 'conformance-boundary-secret'
    const safeAdmission = (
      prepared: PreparedExecutorOptions,
    ): ReturnType<ExecutorAdapter['admit']> => ({
      allowed: true,
      effectiveCapabilities: descriptor.capabilities,
      effectivePublicOptions: prepared.publicOptions,
      pathEnforcement: 'advisory',
      contextIsolation: descriptor.features.contextIsolation,
    })
    const malformedValues = (
      accessorProperty: string,
    ): readonly {
      readonly name: string
      readonly value: unknown
      readonly expectsRedaction: boolean
    }[] => {
      const hostileProxy = new Proxy(
        {},
        {
          get() {
            throw new Error(`hostile boundary exposed ${secret}`)
          },
          getPrototypeOf() {
            throw new Error(`hostile boundary exposed ${secret}`)
          },
        },
      )
      const accessorBacked = {}
      Object.defineProperty(accessorBacked, accessorProperty, {
        enumerable: true,
        get() {
          throw new Error(`accessor boundary exposed ${secret}`)
        },
      })
      return [
        { name: 'null', value: null, expectsRedaction: false },
        { name: 'hostile proxy', value: hostileProxy, expectsRedaction: true },
        {
          name: 'non-coercible hostile proxy',
          value: hostileReflectionProxy(),
          expectsRedaction: false,
        },
        { name: 'accessor-backed value', value: accessorBacked, expectsRedaction: true },
      ]
    }

    for (const boundary of ['descriptor', 'static admission', 'runtime admission'] as const) {
      for (const malformed of malformedValues(`boundary-${secret}`)) {
        let executeCount = 0
        const adapter = new FakeExecutorAdapter({
          descriptor,
          preparedOptions: () =>
            preparedSnapshot(
              { environment: { TOKEN: secret } },
              { environment: { TOKEN: { source: 'literal', redacted: true } } },
              [secret],
            ),
          sensitiveOptionPointers: ['/environment'],
          ...(boundary === 'descriptor'
            ? { inspection: () => malformed.value as ExecutorDescriptor }
            : {
                admission: ({ prepared, probe }) => {
                  if (boundary === 'runtime admission' && probe === undefined) {
                    return safeAdmission(prepared)
                  }
                  return malformed.value as ReturnType<ExecutorAdapter['admit']>
                },
              }),
          response: () => {
            executeCount += 1
            return completedResponse
          },
        })

        const report = await checkAdapterConformance({
          adapter,
          role,
          task,
          runId: `conformance-${boundary}-${malformed.name}`,
          cwd: '/project',
          options: {},
        })
        const surface = JSON.stringify(report)
        assert.equal(report.valid, false, `${boundary}: ${malformed.name}`)
        assert.equal(executeCount, 0, `${boundary}: ${malformed.name}`)
        assert.equal(report.response, undefined, `${boundary}: ${malformed.name}`)
        assert.doesNotMatch(surface, new RegExp(secret, 'u'), `${boundary}: ${malformed.name}`)
        if (malformed.expectsRedaction) {
          assert.match(surface, /\[REDACTED\]/u, `${boundary}: ${malformed.name}`)
        }
      }
    }
  })

  it('conformance does not execute after an unavailable probe is admitted', async () => {
    let executeCount = 0
    const adapter = new FakeExecutorAdapter({
      descriptor,
      probe: {
        available: false,
        featureChecks: { version: false },
        diagnostic: 'The fake executor is unavailable.',
      },
      admission: ({ prepared }) => ({
        allowed: true,
        effectiveCapabilities: descriptor.capabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: descriptor.features.contextIsolation,
      }),
      response: () => {
        executeCount += 1
        return completedResponse
      },
    })

    const report = await checkAdapterConformance({
      adapter,
      role,
      task,
      runId: 'conformance-unavailable-admitted',
      cwd: '/project',
      options: {},
    })

    assert.equal(report.valid, false)
    assert.match(report.errors.join('\n'), /unavailable probe was admitted/u)
    assert.equal(executeCount, 0)
    assert.equal(report.response, undefined)
  })

  it('stops compile after pure static admission without probing or executing', () => {
    const calls: string[] = []
    const protocolAdapter = {
      id: 'compile-protocol',
      prepareOptions() {
        calls.push('prepare')
        return preparedSnapshot()
      },
      inspect() {
        calls.push('inspect')
        return {
          schema: 'rolekit/executor-descriptor@2',
          adapterProtocol: 'rolekit/executor-adapter@1',
          adapterVersion: '1.0.0',
          id: 'compile-protocol',
          displayName: 'Compile protocol',
          transport: 'in-process',
          capabilities: ['repository.read', 'repository.write'],
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
            permissionCombinations: ['repository.read+repository.write'],
          },
        }
      },
      probe() {
        calls.push('probe')
        throw new Error('compile must not probe')
      },
      admit() {
        calls.push('admit:static')
        return {
          allowed: true,
          effectiveCapabilities: ['repository.read', 'repository.write'],
          effectivePublicOptions: {},
          pathEnforcement: 'advisory',
          contextIsolation: {
            userConfig: 'isolated',
            projectInstructions: 'isolated',
            projectResources: 'isolated',
            environment: 'minimal',
            credentials: 'explicit',
          },
        }
      },
      execute() {
        calls.push('execute')
        throw new Error('compile must not execute')
      },
    } as unknown as ExecutorAdapter
    const rolekit = new Rolekit({ roles: [role], adapters: [protocolAdapter] })

    const compilation = (
      rolekit as unknown as {
        compile(
          taskValue: TaskPacket,
          options: { executorId: string; adapterOptions: unknown },
        ): {
          readonly admission: { readonly allowed: boolean }
        }
      }
    ).compile(task, { executorId: 'compile-protocol', adapterOptions: {} })

    assert.equal(compilation.admission.allowed, true)
    assert.deepEqual(calls, ['prepare', 'inspect', 'admit:static'])
  })

  it('returns static admission blocks before probing', async () => {
    let probeCount = 0
    let executeCount = 0
    const blockedError = {
      code: 'unsupported_permission_combination',
      message: 'The requested permission combination cannot be enforced.',
      retryable: false,
    }
    const protocolAdapter = {
      id: 'static-block',
      prepareOptions: () => preparedSnapshot(),
      inspect: () => ({
        schema: 'rolekit/executor-descriptor@2',
        adapterProtocol: 'rolekit/executor-adapter@1',
        adapterVersion: '1.0.0',
        id: 'static-block',
        displayName: 'Static block',
        transport: 'in-process',
        capabilities: ['repository.read', 'repository.write'],
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
          permissionCombinations: [],
        },
      }),
      probe: async () => {
        probeCount += 1
        return { available: true, featureChecks: {} }
      },
      admit: () => ({
        allowed: false,
        effectiveCapabilities: ['repository.read'],
        effectivePublicOptions: {},
        pathEnforcement: 'advisory',
        contextIsolation: {
          userConfig: 'isolated',
          projectInstructions: 'isolated',
          projectResources: 'isolated',
          environment: 'minimal',
          credentials: 'explicit',
        },
        blockedError,
      }),
      execute: async () => {
        executeCount += 1
        return completedResponse
      },
    } as unknown as ExecutorAdapter
    const result = await new Rolekit({ roles: [role], adapters: [protocolAdapter] }).run(task, {
      executorId: 'static-block',
      cwd: '/project',
      adapterOptions: {},
    })

    assert.equal(result.schema, 'rolekit/run-result@2')
    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, blockedError.code)
    assert.equal(result.policy.admission.allowed, false)
    assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.equal(probeCount, 0)
    assert.equal(executeCount, 0)
  })

  it('creates a cancelled plan for a pre-aborted execution without probing', async () => {
    const controller = new AbortController()
    controller.abort()
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const result = await new Rolekit({ roles: [role], adapters: [adapter] }).run(task, {
      executorId: 'fake',
      cwd: '/project',
      adapterOptions: {},
      runId: 'pre-aborted-run',
      signal: controller.signal,
    })

    assert.equal(result.schema, 'rolekit/run-result@2')
    assert.equal(result.status, 'cancelled')
    assert.equal(result.error.code, 'cancelled')
    assert.equal(result.policy.admission.allowed, true)
    assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.equal(adapter.probeCount, 0)
    assert.equal(adapter.invocations.length, 0)
  })

  it('returns probe diagnostics through runtime admission without executing', async () => {
    let admitCount = 0
    let executeCount = 0
    const diagnostic = 'Executable was not found in the execution cwd.'
    const protocolAdapter = {
      id: 'probe-block',
      prepareOptions: () => preparedSnapshot(),
      inspect: () => ({
        schema: 'rolekit/executor-descriptor@2',
        adapterProtocol: 'rolekit/executor-adapter@1',
        adapterVersion: '1.0.0',
        id: 'probe-block',
        displayName: 'Probe block',
        transport: 'in-process',
        capabilities: ['repository.read', 'repository.write'],
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
          permissionCombinations: ['repository.read+repository.write'],
        },
      }),
      probe: async () => ({ available: false, featureChecks: { version: false }, diagnostic }),
      admit: (
        _role: RoleSpec,
        _task: TaskPacket,
        _prepared: unknown,
        probe?: { readonly available: boolean },
      ) => {
        admitCount += 1
        const allowed = probe === undefined
        return {
          allowed,
          effectiveCapabilities: ['repository.read', 'repository.write'],
          effectivePublicOptions: {},
          pathEnforcement: 'advisory',
          contextIsolation: {
            userConfig: 'isolated',
            projectInstructions: 'isolated',
            projectResources: 'isolated',
            environment: 'minimal',
            credentials: 'explicit',
          },
          ...(allowed
            ? {}
            : {
                blockedError: {
                  code: 'executor_unavailable',
                  message: diagnostic,
                  retryable: true,
                },
              }),
        }
      },
      execute: async () => {
        executeCount += 1
        return completedResponse
      },
    } as unknown as ExecutorAdapter
    const result = await new Rolekit({ roles: [role], adapters: [protocolAdapter] }).run(task, {
      executorId: 'probe-block',
      cwd: '/project',
      adapterOptions: {},
    })

    assert.equal(result.schema, 'rolekit/run-result@2')
    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'executor_unavailable')
    assert.equal(result.error?.message, diagnostic)
    assert.equal(result.policy.admission.allowed, false)
    assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.equal(admitCount, 2)
    assert.equal(executeCount, 0)
  })

  it('rejects legacy describe-only adapters instead of silently shimming V1 conformance', () => {
    const legacyAdapter = {
      id: 'legacy',
      async describe() {
        return { ...descriptor, id: 'legacy' }
      },
      async execute() {
        return completedResponse
      },
    }

    assert.throws(
      () => new Rolekit({ adapters: [legacyAdapter as unknown as ExecutorAdapter] }),
      (error: unknown) =>
        error instanceof RolekitError &&
        error.code === 'invalid_contract' &&
        error.message.includes('prepareOptions'),
    )
  })

  it('rejects concurrent reuse of an active run id and releases it on completion', async () => {
    let releaseFirstRun: (() => void) | undefined
    const firstRunGate = new Promise<void>((resolvePromise) => {
      releaseFirstRun = resolvePromise
    })
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: async () => {
        await firstRunGate
        return completedResponse
      },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    const runOptions = {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
      runId: 'shared-run-id',
    } as const

    const firstRun = rolekit.run(task, runOptions)
    while (adapter.invocations.length === 0) {
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
    }

    const secondRun = rolekit.run(task, runOptions)
    releaseFirstRun?.()
    await assert.rejects(
      secondRun,
      (error: unknown) =>
        error instanceof RolekitError &&
        error.code === 'duplicate_run' &&
        error.message.includes('already active'),
    )

    assert.equal((await firstRun).status, 'completed')
    assert.equal(adapter.inspectCount, 1)
    assert.equal((await rolekit.run(task, runOptions)).status, 'completed')
  })

  it('rejects task input before invoking an adapter', async () => {
    const adapter = new FakeExecutorAdapter({ descriptor, response: completedResponse })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })
    const invalidTask = { ...task, input: { source: '' } }

    await assert.rejects(
      rolekit.run(invalidTask, {
        executorId: 'fake',
        cwd: 'D:/project',
        adapterOptions: {},
      }),
      (error: unknown) =>
        error instanceof RolekitError &&
        error.code === 'invalid_contract' &&
        error.message.includes('input'),
    )
    assert.equal(adapter.invocations.length, 0)
  })

  it('blocks a capability mismatch without executing the adapter', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor: {
        ...descriptor,
        capabilities: ['repository.read'],
      },
      response: completedResponse,
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
      runId: 'capability-run',
    })

    assert.equal(result.status, 'blocked')
    assert.equal(result.error?.code, 'capability_mismatch')
    assert.equal(adapter.invocations.length, 0)
  })

  it('fails output that does not match the role schema', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: {
        ...completedResponse,
        output: { unexpected: true },
      },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'output_validation_failed')
  })

  it('executes empty-reference role schemas and normalizes invalid recursive output', async () => {
    interface RecursiveNode {
      readonly value: string
      readonly children: readonly RecursiveNode[]
    }

    const inputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'children'],
      properties: {
        value: { type: 'string' },
        children: { type: 'array', items: { $ref: '' } },
      },
    } as const
    const outputSchema = {
      $ref: 'recursive-output',
      $defs: {
        recursiveOutput: {
          $id: 'recursive-output',
          type: 'object',
          additionalProperties: false,
          required: ['value', 'children'],
          properties: {
            value: { type: 'string' },
            children: { type: 'array', items: { $dynamicRef: '' } },
          },
        },
      },
    } as const
    const recursiveRole: RoleSpec<RecursiveNode, RecursiveNode> = {
      ...role,
      id: 'recursive-role',
      inputSchema,
      outputSchema,
    }
    const recursiveTask: TaskPacket<RecursiveNode> = {
      ...task,
      taskId: 'recursive-valid',
      roleId: recursiveRole.id,
      input: {
        value: 'input root',
        children: [{ value: 'input child', children: [] }],
      },
    }
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: ({ task: invocationTask }) => ({
        ...completedResponse,
        output:
          invocationTask.taskId === 'recursive-valid'
            ? { value: 'output root', children: [{ value: 'output child', children: [] }] }
            : { value: 'output root', children: [{ value: 42, children: [] }] },
      }),
    })
    const rolekit = new Rolekit({ roles: [recursiveRole], adapters: [adapter] })

    const validResult = await rolekit.run(recursiveTask, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })
    const invalidResult = await rolekit.run(
      { ...recursiveTask, taskId: 'recursive-invalid' },
      {
        executorId: 'fake',
        cwd: 'D:/project',
        adapterOptions: {},
      },
    )

    assert.equal(validResult.status, 'completed')
    assert.equal(invalidResult.status, 'failed')
    assert.equal(invalidResult.error?.code, 'output_validation_failed')
    assert.equal(adapter.invocations.length, 2)
  })

  it('normalizes response Proxy reflection failures with non-coercible thrown values', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: hostileReflectionProxy() as never,
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'invalid_executor_response')
    assert.deepEqual(result.artifacts, [])
    assert.deepEqual(result.evidence, [])
  })

  it('retains the message from an ordinary adapter Error', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: () => {
        throw new Error('CLI stderr: command failed safely')
      },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'adapter_error')
    assert.equal(result.error?.message, 'CLI stderr: command failed safely')
    assert.equal(result.error?.retryable, true)
  })

  it('does not treat an adapter-originated AbortError as caller cancellation', async () => {
    const adapterAbort = new Error('Adapter timed out internally')
    adapterAbort.name = 'AbortError'
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: () => {
        throw adapterAbort
      },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'adapter_error')
    assert.equal(result.error?.message, 'Adapter timed out internally')
    assert.equal(result.error?.retryable, true)
  })

  it('contains hostile thenable Proxy rejection values during adapter execution', async () => {
    const adapter: ExecutorAdapter = {
      id: descriptor.id,
      prepareOptions: () => preparedSnapshot(),
      inspect: () => descriptor,
      probe: async () => ({ available: true, featureChecks: {} }),
      admit: (_role, _task, prepared) => ({
        allowed: true,
        effectiveCapabilities: descriptor.capabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: descriptor.features.contextIsolation,
      }),
      execute(): Promise<ExecutorResponse> {
        return hostileThenLookupProxy() as Promise<ExecutorResponse>
      },
    }
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'adapter_error')
    assert.equal(result.error?.message, 'Executor adapter execution failed.')
    assert.deepEqual(result.artifacts, [])
    assert.deepEqual(result.evidence, [])
  })

  it('fails when an expected artifact is absent', async () => {
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: { ...completedResponse, artifacts: [] },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'missing_artifact')
  })

  it('accepts a fourth adapter through the public registry without a core change', async () => {
    const adapters = ['pi', 'cursor', 'codex', 'custom'].map(
      (id) =>
        new FakeExecutorAdapter({
          descriptor: { ...descriptor, id },
          response: completedResponse,
        }),
    )
    const rolekit = new Rolekit({ roles: [role], adapters })

    const result = await rolekit.run(task, {
      executorId: 'custom',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(result.status, 'completed')
    assert.deepEqual(rolekit.listAdapterIds(), ['codex', 'cursor', 'custom', 'pi'])
    assert.equal(adapters[3]?.invocations.length, 1)
  })

  it('stores a detached, recursively frozen role snapshot', () => {
    const mutableCapabilities = ['repository.read', 'repository.write'] as const
    const mutableOutputSchema = Type.Object(
      { message: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    )
    const mutableRole: RoleSpec<ExampleInput, ExampleOutput> = {
      ...role,
      requiredCapabilities: [...mutableCapabilities],
      outputSchema: mutableOutputSchema,
    }
    const rolekit = new Rolekit({ roles: [mutableRole] })
    const stored = rolekit.getRole(role.id)

    ;(mutableRole.requiredCapabilities as string[]).pop()
    ;(
      mutableOutputSchema.properties.message as unknown as {
        minLength: number
      }
    ).minLength = 0

    assert.ok(stored)
    assert.notEqual(stored, mutableRole)
    assert.deepEqual(stored?.requiredCapabilities, mutableCapabilities)
    assert.equal(
      (
        (stored.outputSchema.properties as Readonly<Record<string, unknown>>).message as Readonly<
          Record<string, unknown>
        >
      ).minLength,
      1,
    )
    assert.equal(Object.isFrozen(stored), true)
    assert.equal(Object.isFrozen(stored?.requiredCapabilities), true)
    assert.equal(Object.isFrozen(stored?.inputSchema), true)
    assert.equal(Object.isFrozen(stored?.outputSchema), true)
  })

  it('keeps post-execution output validation authoritative against adapter mutation', async () => {
    let mutationSucceeded: boolean | undefined
    const adapter = new FakeExecutorAdapter({
      descriptor,
      response: ({ role: invocationRole }) => {
        const properties = invocationRole.outputSchema.properties as Readonly<
          Record<string, Readonly<Record<string, unknown>>>
        >
        mutationSucceeded = Reflect.set(properties.message ?? {}, 'minLength', 0)
        return {
          ...completedResponse,
          output: { message: '' },
        }
      },
    })
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const result = await rolekit.run(task, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })

    assert.equal(mutationSucceeded, false)
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'output_validation_failed')
  })

  it('snapshots and freezes a task before the first await and adapter invocation', async () => {
    let releaseProbe: (() => void) | undefined
    let roleWasFrozen = false
    let taskWasFrozen = false
    let inputWasFrozen = false
    let observedObjective: string | undefined
    const adapter: ExecutorAdapter = {
      id: 'fake',
      prepareOptions: () => preparedSnapshot(),
      inspect: () => descriptor,
      async probe(): Promise<{
        readonly available: true
        readonly featureChecks: Readonly<Record<string, boolean>>
      }> {
        await new Promise<void>((resolve) => {
          releaseProbe = resolve
        })
        return { available: true, featureChecks: {} }
      },
      admit: (_role, _task, prepared) => ({
        allowed: true,
        effectiveCapabilities: descriptor.capabilities,
        effectivePublicOptions: prepared.publicOptions,
        pathEnforcement: 'advisory',
        contextIsolation: descriptor.features.contextIsolation,
      }),
      async execute(
        invocationRole: RoleSpec,
        invocationTask: TaskPacket,
      ): Promise<ExecutorResponse> {
        roleWasFrozen = Object.isFrozen(invocationRole)
        taskWasFrozen = Object.isFrozen(invocationTask)
        inputWasFrozen = Object.isFrozen(invocationTask.input)
        observedObjective = invocationTask.objective
        try {
          ;(invocationTask.expectedArtifacts as { name: string; kind: string }[]).pop()
        } catch {
          // A frozen task rejects the adversarial mutation as intended.
        }
        return { ...completedResponse, artifacts: [] }
      },
    }
    const mutableTask: TaskPacket<ExampleInput> = {
      ...task,
      input: { ...task.input },
      expectedArtifacts: [...task.expectedArtifacts],
    }
    const rolekit = new Rolekit({ roles: [role], adapters: [adapter] })

    const resultPromise = rolekit.run(mutableTask, {
      executorId: 'fake',
      cwd: 'D:/project',
      adapterOptions: {},
    })
    ;(mutableTask.input as { source: string }).source = 'MUTATED.md'
    ;(mutableTask as { objective: string }).objective = 'Mutated after run started.'
    releaseProbe?.()
    const result = await resultPromise

    assert.equal(roleWasFrozen, true)
    assert.equal(taskWasFrozen, true)
    assert.equal(inputWasFrozen, true)
    assert.equal(observedObjective, task.objective)
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'missing_artifact')
  })
})

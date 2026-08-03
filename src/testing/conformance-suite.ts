import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RolekitError } from '../core/errors.ts'
import { Rolekit } from '../core/rolekit.ts'
import { ExecutorDescriptorV1Schema } from '../core/schemas.ts'
import type {
  Capability,
  ExecutionContext,
  ExecutorAdapter,
  ExecutorResponse,
  PreparedExecutorOptions,
  RoleSpec,
  RunEvent,
  TaskPacket,
} from '../core/types.ts'
import { validatePreparedExecutorOptions, validateStrictValue } from '../core/validation.ts'
import { checkAdapterConformance } from './conformance.ts'

export interface AdapterConformanceFactory<TOptions> {
  readonly createAdapter: () => ExecutorAdapter<TOptions>
  readonly validRawOptions: unknown
  readonly unavailableRawOptions?: unknown
  readonly capabilities: readonly Capability[]
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } },
} as const

function suiteRole(capabilities: readonly Capability[]): RoleSpec {
  return {
    schema: 'rolekit/role-spec@1',
    id: 'adapter-conformance-role',
    description: 'Exercises one reusable adapter conformance fixture.',
    requiredCapabilities: capabilities,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['source'],
      properties: { source: { type: 'string' } },
    },
    outputSchema,
  }
}

function suiteTask(role: RoleSpec): TaskPacket {
  return {
    schema: 'rolekit/task-packet@1',
    taskId: 'adapter-conformance-task',
    roleId: role.id,
    objective: 'Return one minimal fixture result.',
    input: { source: 'fixture' },
    context: [],
    constraints: ['Do not perform work outside the fixture boundary.'],
    acceptanceCriteria: ['Return a completed response and the report artifact.'],
    allowedPaths: ['fixture'],
    expectedArtifacts: [{ name: 'report', kind: 'text' }],
  }
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return
  }
  seen.add(value)
  assert.equal(Object.isFrozen(value), true)
  for (const entry of Object.values(value)) {
    assertDeepFrozen(entry, seen)
  }
}

function delegateAdapter<TOptions>(
  adapter: ExecutorAdapter<TOptions>,
  execute: (
    role: RoleSpec,
    task: TaskPacket,
    context: ExecutionContext<TOptions>,
  ) => Promise<ExecutorResponse>,
  hooks: {
    readonly probe?: ExecutorAdapter<TOptions>['probe']
    readonly onCancel?: (runId: string) => void
  } = {},
): ExecutorAdapter<TOptions> {
  return {
    id: adapter.id,
    ...(adapter.sensitiveOptionPointers === undefined
      ? {}
      : { sensitiveOptionPointers: adapter.sensitiveOptionPointers }),
    prepareOptions: (options, publicContext) => adapter.prepareOptions(options, publicContext),
    inspect: (prepared) => adapter.inspect(prepared),
    ...(adapter.prepareProbeOptions === undefined
      ? {}
      : {
          prepareProbeOptions: (prepared: PreparedExecutorOptions<TOptions>) =>
            adapter.prepareProbeOptions?.(prepared) as PreparedExecutorOptions<TOptions>,
        }),
    probe:
      hooks.probe === undefined
        ? (prepared, context) => adapter.probe(prepared, context)
        : hooks.probe,
    admit: (role, task, prepared, probe) => adapter.admit(role, task, prepared, probe),
    execute,
    ...(adapter.cancel === undefined
      ? {}
      : {
          cancel: async (runId: string) => {
            hooks.onCancel?.(runId)
            await adapter.cancel?.(runId)
          },
        }),
  }
}

function createRuntime<TOptions>(adapter: ExecutorAdapter<TOptions>, role: RoleSpec): Rolekit {
  return new Rolekit({
    roles: [role],
    adapters: [adapter],
    now: () => new Date('2000-01-01T00:00:00.000Z'),
  })
}

/**
 * Defines a reusable certification suite. The supplied valid fixture must be
 * credential-free, return a completed response, and include a non-empty
 * `report:text` artifact. Any configured secret values must be fixture-only
 * sentinels suitable for redaction assertions.
 */
export function defineAdapterConformanceSuite<TOptions>(
  name: string,
  factory: AdapterConformanceFactory<TOptions>,
): void {
  const role = suiteRole(factory.capabilities)
  const task = suiteTask(role)

  describe(`${name} adapter conformance`, () => {
    it('publishes a strict frozen V2 descriptor while V1 remains document-compatible', () => {
      const adapter = factory.createAdapter()
      const prepared = adapter.prepareOptions(factory.validRawOptions)
      const descriptor = adapter.inspect(prepared)

      assert.equal(descriptor.schema, 'rolekit/executor-descriptor@2')
      assert.equal(descriptor.adapterProtocol, 'rolekit/executor-adapter@1')
      assert.equal(descriptor.id, adapter.id)
      assert.match(descriptor.adapterVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
      assert.deepEqual(
        factory.capabilities.filter((capability) => !descriptor.capabilities.includes(capability)),
        [],
      )
      assertDeepFrozen(descriptor)

      const frozenV1Document = Object.freeze({
        id: adapter.id,
        displayName: descriptor.displayName,
        transport: descriptor.transport,
        capabilities: Object.freeze([...descriptor.capabilities]),
        available: true,
        version: 'document-only-1.0.0',
      })
      assert.equal(validateStrictValue(ExecutorDescriptorV1Schema, frozenV1Document).valid, true)
    })

    it('prepares typed frozen options and redacts every declared sensitive value', () => {
      const adapter = factory.createAdapter()
      const prepared = adapter.prepareOptions(factory.validRawOptions)
      const validation = validatePreparedExecutorOptions(prepared, adapter.sensitiveOptionPointers)

      assert.equal(validation.valid, true, validation.errors.join('\n'))
      assertDeepFrozen(prepared)
      const publicSurface = JSON.stringify(prepared.publicOptions)
      for (const sensitiveValue of prepared.sensitiveValues) {
        assert.ok(sensitiveValue.length > 0)
        assert.doesNotMatch(publicSurface, new RegExp(sensitiveValue, 'u'))
      }
    })

    it('rejects deterministic invalid raw options before probe or execution', () => {
      const adapter = factory.createAdapter()
      let probeCount = 0
      let executeCount = 0
      const rejecting = delegateAdapter(
        adapter,
        async () => {
          executeCount += 1
          throw new Error('Invalid option validation executed the adapter fixture.')
        },
        {
          probe: async () => {
            probeCount += 1
            throw new Error('Invalid option validation probed the adapter fixture.')
          },
        },
      )

      for (const invalidOptions of [{ __rolekitUnknownOption: true }, { command: 42 }] as const) {
        assert.throws(() => rejecting.prepareOptions(invalidOptions), /option|command|unknown/iu)
      }
      assert.equal(probeCount, 0)
      assert.equal(executeCount, 0)
    })

    it('keeps static inspection and admission free of probe and execution', () => {
      const adapter = factory.createAdapter()
      let probeCount = 0
      let executeCount = 0
      const staticOnly = delegateAdapter(
        adapter,
        async () => {
          executeCount += 1
          throw new Error('Static compilation executed the adapter fixture.')
        },
        {
          probe: async () => {
            probeCount += 1
            throw new Error('Static compilation probed the adapter fixture.')
          },
        },
      )
      const compilation = createRuntime(staticOnly, role).compile(task, {
        executorId: adapter.id,
        adapterOptions: factory.validRawOptions as TOptions,
      })

      assert.equal(compilation.admission.allowed, true)
      assert.equal(probeCount, 0)
      assert.equal(executeCount, 0)
      assertDeepFrozen(compilation)
    })

    it('reports an available runtime only after version and feature checks succeed', async () => {
      const adapter = factory.createAdapter()
      const prepared = adapter.prepareOptions(factory.validRawOptions)
      const probe = await adapter.probe(prepared, { cwd: process.cwd() })

      assert.equal(probe.available, true, probe.diagnostic)
      assert.equal(probe.featureChecks.version, true)
      assert.equal(probe.featureChecks['version:parsed'], true)
      assert.equal(probe.featureChecks['version:minimum-tested'], true)
      assert.ok(Object.values(probe.featureChecks).some((value) => value === true))
      assertDeepFrozen(probe)
    })

    if (factory.unavailableRawOptions !== undefined) {
      it('rejects an unavailable runtime before execution', async () => {
        const adapter = factory.createAdapter()
        let executeCount = 0
        const unavailable = delegateAdapter(adapter, async (roleValue, taskValue, context) => {
          executeCount += 1
          return adapter.execute(roleValue, taskValue, context)
        })
        const prepared = unavailable.prepareOptions(factory.unavailableRawOptions)
        const probe = await unavailable.probe(prepared, { cwd: process.cwd() })
        const admission = unavailable.admit(role, task, prepared, probe)

        assert.equal(probe.available, false)
        assert.equal(admission.allowed, false)
        assert.equal(executeCount, 0)
        assert.match(probe.diagnostic, /unavailable|not found|spawn|executable|command/iu)
      })
    }

    it('passes capability, path, context, response, output, and artifact finalization', async () => {
      const adapter = factory.createAdapter()
      const report = await checkAdapterConformance({
        adapter,
        role,
        task,
        runId: `${adapter.id}-conformance-run`,
        cwd: process.cwd(),
        options: factory.validRawOptions,
      })

      assert.equal(report.valid, true, report.errors.join('\n'))
      assert.equal(report.response?.status, 'completed')
      assert.equal(report.result?.status, 'completed')
      assert.ok(report.result?.artifacts.some((artifact) => artifact.name === 'report'))
      assertDeepFrozen(report)
      const surface = JSON.stringify(report)
      const prepared = adapter.prepareOptions(factory.validRawOptions)
      for (const sensitiveValue of prepared.sensitiveValues) {
        assert.doesNotMatch(surface, new RegExp(sensitiveValue, 'u'))
      }
    })

    it('cancels through the real adapter boundary and releases the run id', async () => {
      const adapter = factory.createAdapter()
      const descriptor = adapter.inspect(adapter.prepareOptions(factory.validRawOptions))
      if (descriptor.features.cancellation === 'none') {
        return
      }

      let enterExecution: (() => void) | undefined
      const executionEntered = new Promise<void>((resolvePromise) => {
        enterExecution = resolvePromise
      })
      let adapterResponse: ExecutorResponse | undefined
      const cancelRunIds: string[] = []
      const observing = delegateAdapter(
        adapter,
        async (roleValue, taskValue, context) => {
          enterExecution?.()
          adapterResponse = await adapter.execute(roleValue, taskValue, context)
          return adapterResponse
        },
        { onCancel: (runId) => cancelRunIds.push(runId) },
      )
      const runtime = createRuntime(observing, role)
      const controller = new AbortController()
      const options = {
        executorId: adapter.id,
        cwd: process.cwd(),
        adapterOptions: factory.validRawOptions as TOptions,
        runId: `${adapter.id}-cancelled-run`,
        signal: controller.signal,
      } as const
      const resultPromise = runtime.run(task, options)
      await executionEntered
      controller.abort()
      const result = await resultPromise

      assert.equal(adapterResponse?.status, 'cancelled')
      assert.equal(result.status, 'cancelled')
      assert.deepEqual(cancelRunIds, [options.runId])
      const cleanupResult = await runtime.run(task, {
        executorId: options.executorId,
        cwd: options.cwd,
        adapterOptions: options.adapterOptions,
        runId: options.runId,
      })
      assert.equal(cleanupResult.status, 'completed')
    })

    it('rejects duplicate active run IDs and permits reuse after cleanup', async () => {
      const adapter = factory.createAdapter()
      let executionCompleted: (() => void) | undefined
      const completed = new Promise<void>((resolvePromise) => {
        executionCompleted = resolvePromise
      })
      let releaseResult: (() => void) | undefined
      const resultGate = new Promise<void>((resolvePromise) => {
        releaseResult = resolvePromise
      })
      const gated = delegateAdapter(adapter, async (roleValue, taskValue, context) => {
        const response = await adapter.execute(roleValue, taskValue, context)
        executionCompleted?.()
        await resultGate
        return response
      })
      const runtime = createRuntime(gated, role)
      const runOptions = {
        executorId: adapter.id,
        cwd: process.cwd(),
        adapterOptions: factory.validRawOptions as TOptions,
        runId: `${adapter.id}-duplicate-run`,
      } as const
      const first = runtime.run(task, runOptions)
      await completed
      await assert.rejects(
        runtime.run(task, runOptions),
        (error: unknown) => error instanceof RolekitError && error.code === 'duplicate_run',
      )
      releaseResult?.()
      assert.equal((await first).status, 'completed')
      assert.equal((await runtime.run(task, runOptions)).status, 'completed')
    })

    it('emits ordered frozen lifecycle and declared adapter events while preserving inputs', async () => {
      const adapter = factory.createAdapter()
      const descriptor = adapter.inspect(adapter.prepareOptions(factory.validRawOptions))
      let immutableInputsObserved = false
      const observing = delegateAdapter(adapter, async (roleValue, taskValue, context) => {
        assertDeepFrozen(roleValue)
        assertDeepFrozen(taskValue)
        immutableInputsObserved = true
        return adapter.execute(roleValue, taskValue, context)
      })
      const events: RunEvent[] = []
      const originalTask = JSON.stringify(task)
      const result = await createRuntime(observing, role).run(task, {
        executorId: adapter.id,
        cwd: process.cwd(),
        adapterOptions: factory.validRawOptions as TOptions,
        runId: `${adapter.id}-events-run`,
        onEvent: (event) => events.push(event),
      })

      assert.equal(result.status, 'completed')
      assert.equal(immutableInputsObserved, true)
      assert.equal(JSON.stringify(task), originalTask)
      assert.equal(events[0]?.type, 'lifecycle')
      assert.equal(events[0]?.type === 'lifecycle' ? events[0].phase : undefined, 'started')
      const terminal = events.at(-1)
      assert.equal(terminal?.type, 'lifecycle')
      assert.equal(terminal?.type === 'lifecycle' ? terminal.phase : undefined, 'completed')
      if (descriptor.features.events) {
        assert.ok(
          events.slice(1, -1).some((event) => event.type !== 'lifecycle'),
          `${adapter.id} declares adapter events but emitted only lifecycle events`,
        )
      }
      assert.deepEqual(
        events.map((event) => event.sequence),
        events.map((_event, index) => index + 1),
      )
      for (const event of events) {
        assertDeepFrozen(event)
      }
    })
  })
}

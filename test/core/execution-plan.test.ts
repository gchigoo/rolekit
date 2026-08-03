import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AnyRunResultSchema,
  assertExecutionPlanIntegrity,
  canonicalJson,
  createExecutionContract,
  createExecutionPlan,
  digestJson,
  ExecutionContractSchema,
  ExecutionPlanContentSchema,
  ExecutorArtifactSchema,
  finalizeExecution,
  LatestRunResultSchema,
  RolekitError,
  RunResultSchema,
  RunResultV1Schema,
  RunResultV2Schema,
  validateValue,
} from '../../src/core/index.ts'
import type {
  ArtifactRef,
  ArtifactRefV2,
  CreateExecutionPlanInput,
  ExecutionPlanContent,
  ExecutionReceipt,
  ExecutorArtifact,
  JsonSchema,
  ResolvedExecutionPlan,
  Sha256Digest,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
} from '../../src/core/types.ts'

const contextIsolation = {
  userConfig: 'isolated',
  projectInstructions: 'isolated',
  projectResources: 'isolated',
  environment: 'minimal',
  credentials: 'explicit',
} as const

const role: SnapshotRoleSpec = {
  schema: 'rolekit/role-spec@1',
  id: 'implementer',
  description: 'Implements one bounded change.',
  instructions: 'Follow the task contract exactly.',
  requiredCapabilities: ['repository.write', 'repository.read'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: { source: { type: 'string', minLength: 1 } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['message'],
    properties: { message: { type: 'string', minLength: 1 } },
  },
}

const task: SnapshotTaskPacket = {
  schema: 'rolekit/task-packet@1',
  taskId: 'task-1',
  roleId: role.id,
  objective: 'Create the requested report.',
  input: { source: 'README.md' },
  context: [],
  constraints: ['Keep the change bounded.'],
  acceptanceCriteria: ['The report is returned.'],
  requiredCapabilities: ['shell', 'repository.read'],
  allowedPaths: ['reports/**', 'README.md'],
  expectedArtifacts: [{ name: 'report', kind: 'text' }],
}

const target = {
  target: 'adapter',
  capabilitySource: 'adapter-verified',
  adapterProtocol: 'rolekit/executor-adapter@1',
  adapterVersion: '1.2.3',
  id: 'fake',
  transport: 'in-process',
  profileId: 'profile-1',
  profileDigest: `sha256:${'1'.repeat(64)}` as Sha256Digest,
  requestedProvider: 'requested-provider',
  requestedModel: 'requested-model',
  requiredSecrets: ['TOKEN', 'API_KEY', 'TOKEN'],
  admission: {
    allowed: true,
    effectiveCapabilities: ['shell', 'repository.write', 'repository.read'],
    effectivePublicOptions: {
      environment: {
        API_KEY: { source: 'env', name: 'XAI_API_KEY', redacted: true },
      },
      sandbox: 'workspace-write',
    },
    pathEnforcement: 'adapter',
    contextIsolation,
  },
} as const

const assertTask5TypeContracts = (): void => {
  // @ts-expect-error A host plan executor cannot claim adapter-verified capabilities.
  const invalidHostExecutor: ExecutionPlanContent['executor'] = {
    target: 'host',
    capabilitySource: 'adapter-verified',
    id: 'native-host',
    transport: 'remote',
    publicOptions: {},
    optionsDigest: `sha256:${'2'.repeat(64)}` as Sha256Digest,
    requiredSecrets: [],
  }
  // @ts-expect-error Executor artifacts require content or a URI.
  const invalidExecutorArtifact: ExecutorArtifact = { name: 'report', kind: 'text' }
  // @ts-expect-error RunResult v2 artifacts require content or a URI.
  const invalidV2Artifact: ArtifactRefV2 = {
    name: 'report',
    kind: 'text',
    provenance: {
      runId: 'run-1',
      executorId: 'fake',
      planDigest: `sha256:${'3'.repeat(64)}` as Sha256Digest,
    },
  }
  const permissiveV1Artifact: ArtifactRef = {
    name: 'report',
    kind: 'text',
    provenance: { runId: 'legacy-run', executorId: 'fake' },
  }
  void invalidHostExecutor
  void invalidExecutorArtifact
  void invalidV2Artifact
  void permissiveV1Artifact
}
void assertTask5TypeContracts

function planInput(overrides: Partial<CreateExecutionPlanInput> = {}): CreateExecutionPlanInput {
  return {
    role,
    task,
    target,
    workspace: { root: '/workspace', revision: 'abc123' },
    runId: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function completedReceipt(resolved: ResolvedExecutionPlan): ExecutionReceipt {
  return {
    schema: 'rolekit/execution-receipt@1',
    planDigest: resolved.planDigest,
    runId: resolved.plan.runId,
    taskId: resolved.plan.content.task.snapshot.taskId,
    roleId: resolved.plan.content.role.snapshot.id,
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:03.000Z',
    actualExecutor: {
      id: 'fake',
      transport: 'in-process',
      executorVersion: 'runtime-2.0.0',
      actualProvider: 'observed-provider',
      actualModel: 'observed-model',
    },
    response: {
      status: 'completed',
      summary: 'Report created.',
      output: { message: 'done' },
      artifacts: [{ name: 'report', kind: 'text', content: 'done' }],
      evidence: [{ kind: 'note', value: 'verified' }],
      usage: { inputTokens: 2, durationMs: 999_999 },
      provider: 'observed-provider',
      model: 'observed-model',
      version: 'runtime-2.0.0',
    },
  }
}

async function resignPlan(
  plan: ResolvedExecutionPlan['plan'],
): Promise<ResolvedExecutionPlan['plan']> {
  const roleSnapshot = structuredClone(plan.content.role.snapshot)
  const taskSnapshot = structuredClone(plan.content.task.snapshot)
  const contract = createExecutionContract(roleSnapshot, taskSnapshot)
  const content = {
    ...structuredClone(plan.content),
    role: { snapshot: roleSnapshot, digest: await digestJson(roleSnapshot) },
    task: { snapshot: taskSnapshot, digest: await digestJson(taskSnapshot) },
    contract,
    contractDigest: await digestJson(contract),
    policy: {
      ...structuredClone(plan.content.policy),
      requiredCapabilities: [...contract.requiredCapabilities],
      allowedPaths: [...(taskSnapshot.allowedPaths ?? [])].sort(),
    },
  }
  return {
    ...structuredClone(plan),
    content,
    contentDigest: await digestJson(content),
  }
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

function isStableInvalidContract(error: unknown, message: string): boolean {
  try {
    return (
      error instanceof RolekitError &&
      error.code === 'invalid_contract' &&
      error.message === message
    )
  } catch {
    return false
  }
}

const legacyRunResult = {
  schema: 'rolekit/run-result@1',
  runId: 'legacy-run',
  taskId: 'task-1',
  roleId: 'implementer',
  status: 'blocked',
  executor: { id: 'fake', transport: 'in-process' },
  summary: 'Legacy blocked result.',
  artifacts: [],
  evidence: [],
  usage: {},
  error: { code: 'blocked', message: 'Blocked.', retryable: false },
  createdAt: '2026-01-01T00:00:00.000Z',
} as const

describe('portable execution plans', () => {
  it('produces the same digest for objects with different insertion order', async () => {
    assert.equal(await digestJson({ a: 1, b: 2 }), await digestJson({ b: 2, a: 1 }))
    assert.equal(canonicalJson({ 2: 'two', 10: 'ten' }), '{"10":"ten","2":"two"}')
    assert.match(await digestJson({ ok: true }), /^sha256:[a-f0-9]{64}$/u)
  })

  it('moves the versioned portable execution contract into core', () => {
    const contract = createExecutionContract(role, task)
    assert.equal(contract.schema, 'rolekit/execution-contract@1')
    assert.deepEqual(contract.requiredCapabilities, [
      'repository.read',
      'repository.write',
      'shell',
    ])
    assert.equal(Object.hasOwn(contract.outputContract, 'finalResponseSchema'), false)
    assert.deepEqual(contract.outputContract.finalResponseRules, [
      'Return exactly one JSON object as the final response.',
      'Do not wrap the JSON object in Markdown fences.',
      'Use status `completed` only when the task output and every expected artifact are present.',
      'Use `failed`, `blocked`, or `cancelled` with a structured error otherwise.',
      'Artifact names and kinds must exactly match the task contract.',
    ])
  })

  it('enforces execution-contract@1 final response rules as one exact ordered tuple', () => {
    const contract = createExecutionContract(role, task)
    const rules = [...contract.outputContract.finalResponseRules]
    const changed = structuredClone(contract) as unknown as {
      outputContract: { finalResponseRules: string[] }
    }
    changed.outputContract.finalResponseRules = [...rules]
    changed.outputContract.finalResponseRules[0] = 'Return any valid value.'
    const deleted = structuredClone(contract) as unknown as {
      outputContract: { finalResponseRules: string[] }
    }
    deleted.outputContract.finalResponseRules = rules.slice(0, -1)
    const added = structuredClone(contract) as unknown as {
      outputContract: { finalResponseRules: string[] }
    }
    added.outputContract.finalResponseRules = [...rules, 'An invisible v1 rule.']
    const reordered = structuredClone(contract) as unknown as {
      outputContract: { finalResponseRules: string[] }
    }
    reordered.outputContract.finalResponseRules = [
      rules[1] as string,
      rules[0] as string,
      ...rules.slice(2),
    ]

    assert.deepEqual(
      [changed, deleted, added, reordered].map(
        (candidate) => validateValue(ExecutionContractSchema as JsonSchema, candidate).valid,
      ),
      [false, false, false, false],
    )
  })

  it('changes semantic content when role instructions change', async () => {
    const first = await createExecutionPlan(planInput())
    const second = await createExecutionPlan(
      planInput({ role: { ...role, instructions: 'Use different instructions.' } }),
    )
    assert.notEqual(first.plan.content.role.digest, second.plan.content.role.digest)
    assert.notEqual(first.plan.contentDigest, second.plan.contentDigest)
  })

  it('keeps contentDigest stable while run-specific planDigest changes', async () => {
    const first = await createExecutionPlan(
      planInput({ runId: 'run-1', createdAt: '2026-01-01T00:00:00.000Z' }),
    )
    const second = await createExecutionPlan(
      planInput({ runId: 'run-2', createdAt: '2026-01-02T00:00:00.000Z' }),
    )
    assert.equal(first.plan.contentDigest, second.plan.contentDigest)
    assert.notEqual(first.planDigest, second.planDigest)
  })

  it('normalizes domain-defined sets and embeds only public secret markers', async () => {
    const resolved = await createExecutionPlan(planInput())
    assert.deepEqual(resolved.plan.content.role.snapshot.requiredCapabilities, [
      'repository.read',
      'repository.write',
    ])
    assert.deepEqual(resolved.plan.content.task.snapshot.requiredCapabilities, [
      'repository.read',
      'shell',
    ])
    assert.deepEqual(resolved.plan.content.task.snapshot.allowedPaths, ['README.md', 'reports/**'])
    assert.deepEqual(resolved.plan.content.executor.requiredSecrets, ['API_KEY', 'TOKEN'])
    assert.deepEqual(resolved.plan.content.executor.publicOptions.environment, {
      API_KEY: { source: 'env', name: 'XAI_API_KEY', redacted: true },
    })
    assert.equal(JSON.stringify(resolved.plan).includes('resolved-secret-value'), false)
    assert.equal(Object.isFrozen(resolved.plan), true)
    assert.equal(Object.isFrozen(resolved.plan.content.role.snapshot), true)
  })

  it('supports a host-native target without an adapter descriptor', async () => {
    const resolved = await createExecutionPlan(
      planInput({
        target: {
          target: 'host',
          capabilitySource: 'host-attested',
          id: 'native-host',
          transport: 'remote',
          requestedModel: 'host-model-alias',
          requiredSecrets: [],
          admission: {
            allowed: true,
            effectiveCapabilities: ['repository.read', 'repository.write', 'shell'],
            effectivePublicOptions: {},
            pathEnforcement: 'host',
            contextIsolation,
          },
        },
      }),
    )
    assert.equal(resolved.plan.content.executor.target, 'host')
    assert.equal(resolved.plan.content.executor.capabilitySource, 'host-attested')
    assert.equal(Object.hasOwn(resolved.plan.content.executor, 'adapterProtocol'), false)
  })

  it('rejects adapter protocol fields on a host target instead of silently dropping them', async () => {
    await assert.rejects(
      createExecutionPlan(
        planInput({
          target: {
            target: 'host',
            capabilitySource: 'host-attested',
            adapterProtocol: 'rolekit/executor-adapter@1',
            adapterVersion: '1.0.0',
            id: 'native-host',
            transport: 'remote',
            requiredSecrets: [],
            admission: target.admission,
          } as never,
        }),
      ),
      /target|adapterProtocol|additional/iu,
    )
  })

  it('rejects a plan whose embedded role snapshot no longer matches its digest', async () => {
    const resolved = await createExecutionPlan(planInput())
    const tampered = structuredClone(resolved.plan)
    ;(tampered.content.role.snapshot as { instructions?: string }).instructions = 'tampered'
    await assert.rejects(assertExecutionPlanIntegrity(tampered), /role.*digest/iu)
  })

  it('rejects a resigned plan with non-canonical task allowedPaths', async () => {
    const resolved = await createExecutionPlan(planInput())
    const forged = structuredClone(resolved.plan)
    ;(forged.content.task.snapshot as unknown as { allowedPaths: string[] }).allowedPaths = [
      'reports/**',
      'README.md',
    ]
    const resigned = await resignPlan(forged)

    await assert.rejects(assertExecutionPlanIntegrity(resigned), /task|allowedPaths|canonical/iu)
  })

  it('rejects a resigned plan with an invalid compiled role schema', async () => {
    const resolved = await createExecutionPlan(planInput())
    const forged = structuredClone(resolved.plan)
    ;(forged.content.role.snapshot as { outputSchema: JsonSchema }).outputSchema = {
      type: 'not-a-json-schema-type',
    }
    const resigned = await resignPlan(forged)

    await assert.rejects(assertExecutionPlanIntegrity(resigned), /role|schema|canonical/iu)
  })

  it('rejects a resigned plan with duplicate expected artifact names', async () => {
    const resolved = await createExecutionPlan(planInput())
    const forged = structuredClone(resolved.plan)
    ;(
      forged.content.task.snapshot as unknown as {
        expectedArtifacts: { name: string; kind: string }[]
      }
    ).expectedArtifacts = [
      { name: 'report', kind: 'text' },
      { name: 'report', kind: 'json' },
    ]
    const resigned = await resignPlan(forged)

    await assert.rejects(assertExecutionPlanIntegrity(resigned), /task|artifact|canonical/iu)
  })

  it('contains hostile nested plan reflection failures as one stable contract error', async () => {
    const resolved = await createExecutionPlan(planInput())
    const hostile = structuredClone(resolved.plan) as unknown as {
      content: { role: { snapshot: unknown } }
    }
    hostile.content.role.snapshot = hostileReflectionProxy()

    await assert.rejects(assertExecutionPlanIntegrity(hostile as never), (error: unknown) =>
      isStableInvalidContract(error, 'Execution plan could not be snapshotted.'),
    )
  })

  it('rejects independently tampered contract, options, content, and instance digests', async () => {
    const resolved = await createExecutionPlan(planInput())
    const contractTampered = structuredClone(resolved.plan)
    ;(contractTampered.content.contract.task as { objective: string }).objective = 'tampered'
    await assert.rejects(assertExecutionPlanIntegrity(contractTampered), /contract/iu)

    const optionsTampered = structuredClone(resolved.plan)
    ;(optionsTampered.content.executor.publicOptions as { sandbox: string }).sandbox = 'none'
    await assert.rejects(assertExecutionPlanIntegrity(optionsTampered), /options.*digest/iu)

    const contentTampered = structuredClone(resolved.plan)
    ;(contentTampered.content.workspace as { revision?: string }).revision = 'other'
    await assert.rejects(assertExecutionPlanIntegrity(contentTampered), /content.*digest/iu)

    const instanceTampered = structuredClone(resolved.plan)
    ;(instanceTampered as { runId: string }).runId = 'run-other'
    const recomputed = await assertExecutionPlanIntegrity(instanceTampered)
    assert.notEqual(recomputed.planDigest, resolved.planDigest)
  })

  it('snapshots a mutable plan before the first digest await', async () => {
    const resolved = await createExecutionPlan(planInput())
    const mutable = structuredClone(resolved.plan)
    const integrity = assertExecutionPlanIntegrity(mutable)
    ;(mutable as { runId: string }).runId = 'mutated-after-call'
    assert.equal((await integrity).plan.runId, resolved.plan.runId)
  })
})

describe('pure execution finalization', () => {
  it('binds the receipt envelope before inspecting a nested executor response', async () => {
    const resolved = await createExecutionPlan(planInput())
    let responseInspected = false
    const response = new Proxy(
      {},
      {
        getPrototypeOf() {
          responseInspected = true
          return Object.prototype
        },
      },
    )

    await assert.rejects(
      finalizeExecution(resolved, {
        ...completedReceipt(resolved),
        planDigest: `sha256:${'0'.repeat(64)}`,
        response,
      }),
      /planDigest/u,
    )
    assert.equal(responseInspected, false)
  })

  it('rejects receipt timestamps that begin before the bound plan was created', async () => {
    const resolved = await createExecutionPlan(planInput())
    await assert.rejects(
      finalizeExecution(resolved, {
        ...completedReceipt(resolved),
        startedAt: '2025-12-31T23:59:59.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
      }),
      /createdAt|startedAt|precede/iu,
    )
  })

  it('rejects a receipt bound to another plan or executor identity', async () => {
    const resolved = await createExecutionPlan(planInput())
    const receipt = completedReceipt(resolved)
    await assert.rejects(
      finalizeExecution(resolved, {
        ...receipt,
        planDigest: `sha256:${'0'.repeat(64)}`,
      }),
      /planDigest/u,
    )
    await assert.rejects(
      finalizeExecution(resolved, {
        ...receipt,
        actualExecutor: { ...receipt.actualExecutor, id: 'other' },
      }),
      /executor/iu,
    )
    await assert.rejects(
      finalizeExecution(resolved, {
        ...receipt,
        actualExecutor: { ...receipt.actualExecutor, transport: 'remote' },
      }),
      /transport/iu,
    )
  })

  it('contains hostile receipt-envelope reflection failures as one stable contract error', async () => {
    const resolved = await createExecutionPlan(planInput())

    await assert.rejects(
      finalizeExecution(resolved, hostileReflectionProxy() as never),
      (error: unknown) =>
        isStableInvalidContract(error, 'Execution receipt could not be snapshotted.'),
    )
  })

  it('records plan and contract digests in RunResult v2 with receipt-derived identity and timing', async () => {
    const resolved = await createExecutionPlan(planInput())
    const result = await finalizeExecution<{ readonly message: string }>(
      resolved,
      completedReceipt(resolved),
    )
    assert.equal(result.schema, 'rolekit/run-result@2')
    assert.equal(result.status, 'completed')
    assert.match(result.execution.planDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.equal(result.execution.contentDigest, resolved.plan.contentDigest)
    assert.equal(result.execution.contractDigest, resolved.plan.content.contractDigest)
    assert.equal(result.executor.requestedProvider, 'requested-provider')
    assert.equal(result.executor.requestedModel, 'requested-model')
    assert.equal(result.executor.actualProvider, 'observed-provider')
    assert.equal(result.executor.actualModel, 'observed-model')
    assert.equal(result.executor.executorVersion, 'runtime-2.0.0')
    assert.equal(result.startedAt, '2026-01-01T00:00:01.000Z')
    assert.equal(result.completedAt, '2026-01-01T00:00:03.000Z')
    assert.equal(result.usage.durationMs, 2_000)
    assert.deepEqual(result.artifacts[0]?.provenance, {
      runId: 'run-1',
      executorId: 'fake',
      planDigest: resolved.planDigest,
    })
    assert.equal(Object.isFrozen(result), true)
  })

  it('normalizes malformed and non-JSON adapter responses into a failed V2 result', async () => {
    const resolved = await createExecutionPlan(planInput())
    for (const response of [
      { status: 'completed', summary: 'bad', output: { message: 'done' }, artifacts: null },
      { status: 'completed', summary: 'bad', output: { message: 'done' }, artifacts: [1n] },
    ]) {
      const result = await finalizeExecution(resolved, {
        ...completedReceipt(resolved),
        response,
      })
      assert.equal(result.schema, 'rolekit/run-result@2')
      assert.equal(result.status, 'failed')
      assert.equal(result.error.code, 'invalid_executor_response')
      assert.deepEqual(result.artifacts, [])
      assert.deepEqual(result.evidence, [])
    }
  })

  it('snapshots receipt scalar identity before the first plan-integrity await', async () => {
    const resolved = await createExecutionPlan(planInput())
    const receipt = completedReceipt(resolved)
    const actualExecutor = receipt.actualExecutor as { id: string }
    const resultPromise = finalizeExecution(resolved, receipt)
    actualExecutor.id = 'other'
    const result = await resultPromise
    assert.equal(result.status, 'completed')
    assert.equal(result.summary, 'Report created.')
    assert.deepEqual(result.output, { message: 'done' })
    assert.equal(result.executor.id, 'fake')
  })

  it('rejects conflicting nested observed identity and completed execution under denied admission', async () => {
    const resolved = await createExecutionPlan(planInput())
    const receipt = completedReceipt(resolved)
    await assert.rejects(
      finalizeExecution(resolved, {
        ...receipt,
        response: { ...(receipt.response as object), model: 'conflicting-model' },
      }),
      /model/iu,
    )

    const denied = await createExecutionPlan(
      planInput({
        target: {
          ...target,
          admission: {
            allowed: false,
            effectiveCapabilities: ['repository.read'],
            effectivePublicOptions: target.admission.effectivePublicOptions,
            pathEnforcement: 'adapter',
            contextIsolation,
            blockedError: {
              code: 'capability_mismatch',
              message: 'Missing required capability.',
              retryable: false,
            },
          },
        },
      }),
    )
    await assert.rejects(finalizeExecution(denied, completedReceipt(denied)), /admission|denied/iu)
  })
})

describe('versioned RunResult schemas', () => {
  it('runtime schemas reject impossible executor targets and payload-less strict artifacts', async () => {
    const resolved = await createExecutionPlan(planInput())
    const impossibleExecutor = structuredClone(resolved.plan.content) as unknown as {
      executor: { target: string; capabilitySource: string }
    }
    impossibleExecutor.executor.target = 'host'
    impossibleExecutor.executor.capabilitySource = 'adapter-verified'

    assert.equal(
      validateValue(ExecutionPlanContentSchema as JsonSchema, impossibleExecutor).valid,
      false,
    )
    assert.equal(
      validateValue(ExecutorArtifactSchema as JsonSchema, { name: 'report', kind: 'text' }).valid,
      false,
    )
    assert.equal(
      validateValue(RunResultV1Schema as JsonSchema, {
        ...legacyRunResult,
        artifacts: [
          {
            name: 'legacy-report',
            kind: 'text',
            provenance: { runId: 'legacy-run', executorId: 'fake' },
          },
        ],
      }).valid,
      true,
    )
  })

  it('keeps explicit RunResult v1 validation while default aliases point at v2', () => {
    assert.equal(validateValue(RunResultV1Schema as JsonSchema, legacyRunResult).valid, true)
    assert.equal(validateValue(RunResultSchema as JsonSchema, legacyRunResult).valid, false)
    assert.equal(RunResultSchema, RunResultV2Schema)
    assert.equal(validateValue(RunResultV2Schema as JsonSchema, legacyRunResult).valid, false)
  })

  it('exports explicit latest and current result schemas', async () => {
    const resolved = await createExecutionPlan(planInput())
    const latest = await finalizeExecution(resolved, completedReceipt(resolved))
    assert.equal(LatestRunResultSchema, RunResultV2Schema)
    assert.equal(validateValue(LatestRunResultSchema as JsonSchema, latest).valid, true)
    assert.equal(validateValue(AnyRunResultSchema as JsonSchema, latest).valid, true)
    assert.equal(validateValue(AnyRunResultSchema as JsonSchema, legacyRunResult).valid, false)

    const artifactWithoutContent = structuredClone(latest)
    if (artifactWithoutContent.artifacts[0] !== undefined) {
      delete (artifactWithoutContent.artifacts[0] as { content?: unknown }).content
    }
    assert.equal(
      validateValue(RunResultV2Schema as JsonSchema, artifactWithoutContent).valid,
      false,
    )
    assert.equal(
      validateValue(RunResultV2Schema as JsonSchema, {
        ...latest,
        usage: { ...latest.usage, inputTokens: 0.5 },
      }).valid,
      false,
    )
  })
})

import { mergeCapabilities } from './capabilities.ts'
import { digestJson } from './digest.ts'
import { RolekitError } from './errors.ts'
import { createExecutionContract } from './execution-contract.ts'
import { canonicalJson, freezeJsonSnapshot, normalizeJsonSchema } from './json.ts'
import { validateExecutorResponse } from './response-validation.ts'
import {
  ExecutionAdmissionSchema,
  ExecutionPlanContentSchema,
  ExecutionPlanSchema,
  ExecutionReceiptSchema,
  ExecutionTargetInputSchema,
  RoleSpecSchema,
  TaskPacketSchema,
} from './schemas.ts'
import type {
  ActualExecutorIdentityV2,
  ArtifactRefV2,
  CreateExecutionPlanInput,
  ExecutionAdmission,
  ExecutionError,
  ExecutionPlan,
  ExecutionPlanContent,
  ExecutionReceipt,
  ExecutionTargetInput,
  ExecutorResponse,
  JsonObject,
  JsonSchema,
  ResolvedExecutionPlan,
  RunResultV2,
  Sha256Digest,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TokenUsage,
} from './types.ts'
import { validateStrictValue } from './validation.ts'

function invalidContract(message: string, details?: JsonObject): RolekitError {
  return new RolekitError('invalid_contract', message, details)
}

function assertStrictContract(schema: JsonSchema, value: unknown, label: string): void {
  const validation = validateStrictValue(schema, value)
  if (!validation.valid) {
    throw invalidContract(`${label} is invalid: ${validation.errors.join('; ')}`, {
      errors: [...validation.errors],
    })
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }
  return [...duplicates].sort()
}

function normalizedRole(role: SnapshotRoleSpec): SnapshotRoleSpec {
  const detached = freezeJsonSnapshot(role, 'Role snapshot') as SnapshotRoleSpec
  assertStrictContract(RoleSpecSchema as JsonSchema, detached, 'Role snapshot')
  const snapshot = freezeJsonSnapshot(
    {
      ...detached,
      requiredCapabilities: mergeCapabilities(detached.requiredCapabilities),
      inputSchema: normalizeJsonSchema(detached.inputSchema, `Role "${detached.id}" inputSchema`),
      outputSchema: normalizeJsonSchema(
        detached.outputSchema,
        `Role "${detached.id}" outputSchema`,
      ),
    },
    `Normalized role snapshot "${detached.id}"`,
  ) as SnapshotRoleSpec
  assertStrictContract(RoleSpecSchema as JsonSchema, snapshot, `Role snapshot "${snapshot.id}"`)
  return snapshot
}

function normalizedTask(task: SnapshotTaskPacket): SnapshotTaskPacket {
  const detached = freezeJsonSnapshot(task, 'Task snapshot') as SnapshotTaskPacket
  assertStrictContract(TaskPacketSchema as JsonSchema, detached, 'Task snapshot')
  const duplicateArtifacts = duplicateValues(
    detached.expectedArtifacts.map((artifact) => artifact.name),
  )
  if (duplicateArtifacts.length > 0) {
    throw invalidContract(
      `Task "${detached.taskId}" repeats expected artifact names: ${duplicateArtifacts.join(', ')}.`,
    )
  }
  const snapshot = freezeJsonSnapshot(
    {
      ...detached,
      ...(detached.requiredCapabilities === undefined
        ? {}
        : { requiredCapabilities: mergeCapabilities(detached.requiredCapabilities) }),
      ...(detached.allowedPaths === undefined
        ? {}
        : { allowedPaths: sortedUnique(detached.allowedPaths) }),
    },
    `Normalized task snapshot "${detached.taskId}"`,
  ) as SnapshotTaskPacket
  assertStrictContract(
    TaskPacketSchema as JsonSchema,
    snapshot,
    `Task snapshot "${snapshot.taskId}"`,
  )
  return snapshot
}

interface NormalizedPlanSnapshots {
  readonly role: SnapshotRoleSpec
  readonly task: SnapshotTaskPacket
}

function normalizedRoleAndTask(
  roleInput: SnapshotRoleSpec,
  taskInput: SnapshotTaskPacket,
): NormalizedPlanSnapshots {
  const role = normalizedRole(roleInput)
  const task = normalizedTask(taskInput)
  if (task.roleId !== role.id) {
    throw invalidContract(`Task roleId "${task.roleId}" does not match role snapshot "${role.id}".`)
  }
  return { role, task }
}

function normalizedAdmission(admission: ExecutionAdmission, label: string): ExecutionAdmission {
  const detached = freezeJsonSnapshot(admission, label) as ExecutionAdmission
  assertStrictContract(ExecutionAdmissionSchema as JsonSchema, detached, label)
  return freezeJsonSnapshot(
    {
      ...detached,
      effectiveCapabilities: mergeCapabilities(detached.effectiveCapabilities),
    },
    `Normalized ${label.toLowerCase()}`,
  ) as ExecutionAdmission
}

function executionPlanExecutor(
  target: ExecutionTargetInput,
  admission: ExecutionAdmission,
  optionsDigest: Sha256Digest,
): ExecutionPlanContent['executor'] {
  const common = {
    id: target.id,
    transport: target.transport,
    ...(target.profileId === undefined ? {} : { profileId: target.profileId }),
    ...(target.profileDigest === undefined ? {} : { profileDigest: target.profileDigest }),
    ...(target.requestedProvider === undefined
      ? {}
      : { requestedProvider: target.requestedProvider }),
    ...(target.requestedModel === undefined ? {} : { requestedModel: target.requestedModel }),
    publicOptions: admission.effectivePublicOptions,
    optionsDigest,
    requiredSecrets: sortedUnique(target.requiredSecrets),
  } as const
  return target.target === 'adapter'
    ? {
        target: 'adapter',
        capabilitySource: 'adapter-verified',
        adapterProtocol: target.adapterProtocol,
        adapterVersion: target.adapterVersion,
        ...common,
      }
    : {
        target: 'host',
        capabilitySource: 'host-attested',
        ...common,
      }
}

function planAdmission(admission: ExecutionAdmission): ExecutionPlanContent['policy']['admission'] {
  return admission.allowed ? { allowed: true } : { allowed: false, error: admission.blockedError }
}

function snapshotExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  let snapshot: ExecutionPlan
  try {
    snapshot = freezeJsonSnapshot(plan, 'Execution plan') as ExecutionPlan
  } catch {
    throw invalidContract('Execution plan could not be snapshotted.')
  }
  assertStrictContract(ExecutionPlanSchema as JsonSchema, snapshot, 'Execution plan')
  return snapshot
}

function canonicalPlanSnapshots(content: ExecutionPlanContent): NormalizedPlanSnapshots {
  let normalized: NormalizedPlanSnapshots
  try {
    normalized = normalizedRoleAndTask(content.role.snapshot, content.task.snapshot)
  } catch {
    throw invalidContract('Execution plan embedded role and task snapshots are invalid.')
  }
  if (canonicalJson(content.role.snapshot) !== canonicalJson(normalized.role)) {
    throw invalidContract('Execution plan embedded role snapshot is not canonical.')
  }
  if (canonicalJson(content.task.snapshot) !== canonicalJson(normalized.task)) {
    throw invalidContract('Execution plan embedded task snapshot is not canonical.')
  }
  return normalized
}

function assertSemanticPlanContent(
  content: ExecutionPlanContent,
  snapshots: NormalizedPlanSnapshots,
): void {
  const expectedContract = createExecutionContract(snapshots.role, snapshots.task)
  if (canonicalJson(content.contract) !== canonicalJson(expectedContract)) {
    throw invalidContract(
      'Execution plan contract does not match its embedded role and task snapshots.',
    )
  }
  if (
    canonicalJson(content.policy.requiredCapabilities) !==
    canonicalJson(expectedContract.requiredCapabilities)
  ) {
    throw invalidContract('Execution plan policy requiredCapabilities do not match the contract.')
  }
  const expectedAllowedPaths = sortedUnique(snapshots.task.allowedPaths ?? [])
  if (canonicalJson(content.policy.allowedPaths) !== canonicalJson(expectedAllowedPaths)) {
    throw invalidContract('Execution plan policy allowedPaths do not match the task snapshot.')
  }
  if (
    canonicalJson(content.executor.requiredSecrets) !==
    canonicalJson(sortedUnique(content.executor.requiredSecrets))
  ) {
    throw invalidContract('Execution plan required secret names are not normalized.')
  }
}

export async function createExecutionPlan(
  input: CreateExecutionPlanInput,
): Promise<ResolvedExecutionPlan> {
  const { role, task } = normalizedRoleAndTask(input.role, input.task)
  const target = freezeJsonSnapshot(input.target, 'Execution target') as ExecutionTargetInput
  assertStrictContract(ExecutionTargetInputSchema as JsonSchema, target, 'Execution target')
  const admission = normalizedAdmission(target.admission, 'Execution target admission')
  const workspace = freezeJsonSnapshot(input.workspace, 'Execution workspace')
  const instance = freezeJsonSnapshot(
    { runId: input.runId, createdAt: input.createdAt },
    'Execution plan instance fields',
  )
  const contract = createExecutionContract(role, task)

  const [roleDigest, taskDigest, contractDigest, optionsDigest] = await Promise.all([
    digestJson(role, 'Execution plan role snapshot'),
    digestJson(task, 'Execution plan task snapshot'),
    digestJson(contract, 'Execution contract'),
    digestJson(admission.effectivePublicOptions, 'Effective public executor options'),
  ])

  const content = freezeJsonSnapshot(
    {
      schema: 'rolekit/execution-plan-content@1',
      role: { snapshot: role, digest: roleDigest },
      task: { snapshot: task, digest: taskDigest },
      contract,
      contractDigest,
      executor: executionPlanExecutor(target, admission, optionsDigest),
      workspace,
      policy: {
        admission: planAdmission(admission),
        requiredCapabilities: contract.requiredCapabilities,
        allowedPaths: sortedUnique(task.allowedPaths ?? []),
        pathEnforcement: admission.pathEnforcement,
        contextIsolation: admission.contextIsolation,
      },
    },
    `Execution plan content for run "${instance.runId}"`,
  ) as ExecutionPlanContent
  assertStrictContract(ExecutionPlanContentSchema as JsonSchema, content, 'Execution plan content')

  const contentDigest = await digestJson(content, 'Execution plan content')
  const plan = freezeJsonSnapshot(
    {
      schema: 'rolekit/execution-plan@1',
      runId: instance.runId,
      createdAt: instance.createdAt,
      content,
      contentDigest,
    },
    `Execution plan "${instance.runId}"`,
  ) as ExecutionPlan
  assertStrictContract(ExecutionPlanSchema as JsonSchema, plan, 'Execution plan')
  const planDigest = await digestJson(plan, 'Execution plan instance')
  return freezeJsonSnapshot({ plan, planDigest }, `Resolved execution plan "${plan.runId}"`)
}

export async function assertExecutionPlanIntegrity(
  plan: ExecutionPlan,
): Promise<ResolvedExecutionPlan> {
  const snapshot = snapshotExecutionPlan(plan)
  const normalizedSnapshots = canonicalPlanSnapshots(snapshot.content)

  const roleDigest = await digestJson(
    snapshot.content.role.snapshot,
    'Execution plan role snapshot',
  )
  if (roleDigest !== snapshot.content.role.digest) {
    throw invalidContract('Execution plan role snapshot digest does not match the embedded role.')
  }
  const taskDigest = await digestJson(
    snapshot.content.task.snapshot,
    'Execution plan task snapshot',
  )
  if (taskDigest !== snapshot.content.task.digest) {
    throw invalidContract('Execution plan task snapshot digest does not match the embedded task.')
  }
  assertSemanticPlanContent(snapshot.content, normalizedSnapshots)
  const contractDigest = await digestJson(snapshot.content.contract, 'Execution contract')
  if (contractDigest !== snapshot.content.contractDigest) {
    throw invalidContract('Execution plan contract digest does not match the embedded contract.')
  }
  const optionsDigest = await digestJson(
    snapshot.content.executor.publicOptions,
    'Effective public executor options',
  )
  if (optionsDigest !== snapshot.content.executor.optionsDigest) {
    throw invalidContract('Execution plan options digest does not match the public options.')
  }
  const contentDigest = await digestJson(snapshot.content, 'Execution plan content')
  if (contentDigest !== snapshot.contentDigest) {
    throw invalidContract('Execution plan content digest does not match the embedded content.')
  }
  const planDigest = await digestJson(snapshot, 'Execution plan instance')
  return freezeJsonSnapshot(
    { plan: snapshot, planDigest },
    `Validated execution plan "${snapshot.runId}"`,
  )
}

interface ReceiptSnapshot {
  readonly envelope: Omit<ExecutionReceipt, 'response'>
  readonly response: unknown
}

function snapshotReceiptUnsafe(receipt: ExecutionReceipt): ReceiptSnapshot {
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    (Object.getPrototypeOf(receipt) !== Object.prototype && Object.getPrototypeOf(receipt) !== null)
  ) {
    throw invalidContract('Execution receipt must be a plain object.')
  }
  const candidate: Record<string, unknown> = {}
  let response: unknown
  let hasResponse = false
  for (const key of Reflect.ownKeys(receipt)) {
    if (typeof key === 'symbol') {
      throw invalidContract('Execution receipt contains symbol-keyed state.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(receipt, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      throw invalidContract(
        `Execution receipt property "${key}" must be an enumerable data property.`,
      )
    }
    if (key === 'response') {
      response = descriptor.value
      hasResponse = true
    } else {
      candidate[key] = descriptor.value
    }
  }
  if (!hasResponse) {
    throw invalidContract('Execution receipt must include response.')
  }
  candidate.response = null
  const envelopeWithPlaceholder = freezeJsonSnapshot(candidate, 'Execution receipt envelope')
  assertStrictContract(
    ExecutionReceiptSchema as JsonSchema,
    envelopeWithPlaceholder,
    'Execution receipt envelope',
  )
  const { response: _placeholder, ...envelope } =
    envelopeWithPlaceholder as unknown as ExecutionReceipt
  return {
    envelope: freezeJsonSnapshot(envelope, 'Execution receipt scalar snapshot'),
    response,
  }
}

function snapshotReceipt(receipt: ExecutionReceipt): ReceiptSnapshot {
  try {
    return snapshotReceiptUnsafe(receipt)
  } catch {
    throw invalidContract('Execution receipt could not be snapshotted.')
  }
}

function executionError(
  code: string,
  message: string,
  retryable: boolean,
  details?: JsonObject,
): ExecutionError {
  return {
    code,
    message,
    retryable,
    ...(details === undefined ? {} : { details }),
  }
}

function receiptDurationMs(planCreatedAt: string, startedAt: string, completedAt: string): number {
  const created = Date.parse(planCreatedAt)
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(created) || !Number.isFinite(started) || !Number.isFinite(completed)) {
    throw invalidContract('Execution plan and receipt timestamps must be valid ISO timestamps.')
  }
  if (started < created) {
    throw invalidContract('Execution receipt startedAt must not precede execution plan createdAt.')
  }
  if (completed < started) {
    throw invalidContract('Execution receipt completedAt must not precede startedAt.')
  }
  return completed - started
}

function observedResponseString(response: unknown, key: string): string | undefined {
  try {
    if (typeof response !== 'object' || response === null || Array.isArray(response)) {
      return undefined
    }
    const descriptor = Object.getOwnPropertyDescriptor(response, key)
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined
  } catch {
    return undefined
  }
}

export function createActualExecutorIdentity(
  descriptor: { readonly id: string; readonly transport: ActualExecutorIdentityV2['transport'] },
  probe: { readonly executorVersion?: string } | undefined,
  response?: unknown,
): ActualExecutorIdentityV2 {
  const responseVersion = observedResponseString(response, 'version')
  const provider = observedResponseString(response, 'provider')
  const model = observedResponseString(response, 'model')
  const executorVersion = probe?.executorVersion ?? responseVersion
  return freezeJsonSnapshot(
    {
      id: descriptor.id,
      transport: descriptor.transport,
      ...(executorVersion === undefined ? {} : { executorVersion }),
      ...(provider === undefined ? {} : { actualProvider: provider }),
      ...(model === undefined ? {} : { actualModel: model }),
    },
    `Actual executor identity "${descriptor.id}"`,
  ) as ActualExecutorIdentityV2
}

function responseIdentityError(
  response: ExecutorResponse,
  actual: ActualExecutorIdentityV2,
): string | undefined {
  for (const [responseKey, actualKey, label] of [
    ['provider', 'actualProvider', 'provider'],
    ['model', 'actualModel', 'model'],
    ['version', 'executorVersion', 'executor version'],
  ] as const) {
    const observed = response[responseKey]
    if (observed !== undefined && observed !== actual[actualKey]) {
      return `Execution receipt ${label} does not match the nested executor response.`
    }
  }
  return undefined
}

function resultExecutor(
  content: ExecutionPlanContent,
  actual: ActualExecutorIdentityV2,
): RunResultV2['executor'] {
  const planned = content.executor
  const common = {
    id: actual.id,
    transport: actual.transport,
    ...(actual.executorVersion === undefined ? {} : { executorVersion: actual.executorVersion }),
    ...(planned.requestedProvider === undefined
      ? {}
      : { requestedProvider: planned.requestedProvider }),
    ...(planned.requestedModel === undefined ? {} : { requestedModel: planned.requestedModel }),
    ...(actual.actualProvider === undefined ? {} : { actualProvider: actual.actualProvider }),
    ...(actual.actualModel === undefined ? {} : { actualModel: actual.actualModel }),
    ...(planned.profileId === undefined ? {} : { profileId: planned.profileId }),
    ...(planned.profileDigest === undefined ? {} : { profileDigest: planned.profileDigest }),
  } as const
  return planned.target === 'adapter'
    ? {
        capabilitySource: 'adapter-verified',
        adapterProtocol: planned.adapterProtocol as 'rolekit/executor-adapter@1',
        adapterVersion: planned.adapterVersion as string,
        ...common,
      }
    : { capabilitySource: 'host-attested', ...common }
}

function normalizeArtifacts(
  response: ExecutorResponse | undefined,
  runId: string,
  executorId: string,
  planDigest: Sha256Digest,
): readonly ArtifactRefV2[] {
  return (response?.artifacts ?? []).map((artifact) => ({
    ...artifact,
    provenance: { runId, executorId, planDigest },
  }))
}

function usageWithReceiptDuration(usage: TokenUsage | undefined, durationMs: number): TokenUsage {
  return { ...usage, durationMs }
}

interface NormalizedOutcome<TOutput> {
  readonly status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  readonly summary: string
  readonly output?: TOutput
  readonly error?: ExecutionError
  readonly response?: ExecutorResponse<TOutput>
}

function normalizedOutcome<TOutput>(
  plan: ExecutionPlan,
  validation: ReturnType<typeof validateExecutorResponse<TOutput>>,
): NormalizedOutcome<TOutput> {
  const response = validation.response
  if (!validation.valid) {
    const outputOnlyFailure =
      response?.status === 'completed' &&
      validation.errors.length > 0 &&
      validation.errors.every((error) => error.startsWith('output does not match the role schema:'))
    return {
      status: 'failed',
      summary: outputOnlyFailure
        ? `Executor "${plan.content.executor.id}" returned output that does not match role "${plan.content.role.snapshot.id}".`
        : `Executor "${plan.content.executor.id}" returned an invalid response.`,
      error: executionError(
        outputOnlyFailure ? 'output_validation_failed' : 'invalid_executor_response',
        validation.errors.join('; '),
        false,
        { errors: [...validation.errors] },
      ),
      ...(response === undefined ? {} : { response }),
    }
  }
  if (response === undefined) {
    throw invalidContract('Executor response validation succeeded without a trusted snapshot.')
  }
  if (response.status !== 'completed') {
    return {
      status: response.status,
      summary: response.summary,
      error: response.error,
      response,
    }
  }
  const missingArtifacts = plan.content.task.snapshot.expectedArtifacts.filter(
    (expected) =>
      !response.artifacts.some(
        (actual) => actual.name === expected.name && actual.kind === expected.kind,
      ),
  )
  if (missingArtifacts.length > 0) {
    return {
      status: 'failed',
      summary: `Executor "${plan.content.executor.id}" did not return every expected artifact.`,
      error: executionError(
        'missing_artifact',
        `Missing artifacts: ${missingArtifacts.map((artifact) => `${artifact.name}:${artifact.kind}`).join(', ')}.`,
        false,
        {
          missing: missingArtifacts.map((artifact) => ({
            name: artifact.name,
            kind: artifact.kind,
          })),
        },
      ),
      response,
    }
  }
  return {
    status: 'completed',
    summary: response.summary,
    output: response.output,
    response,
  }
}

export async function finalizeExecution<TOutput>(
  resolvedPlan: ResolvedExecutionPlan,
  receipt: ExecutionReceipt,
): Promise<RunResultV2<TOutput>> {
  const receiptSnapshot = snapshotReceipt(receipt)
  const planSnapshot = snapshotExecutionPlan(resolvedPlan.plan)
  const resolvedPlanDigest = resolvedPlan.planDigest
  const checkedPlan = await assertExecutionPlanIntegrity(planSnapshot)
  if (resolvedPlanDigest !== checkedPlan.planDigest) {
    throw invalidContract('Resolved execution plan planDigest does not match the plan instance.')
  }
  const envelope = receiptSnapshot.envelope
  if (envelope.planDigest !== checkedPlan.planDigest) {
    throw invalidContract('Execution receipt planDigest does not match the execution plan.')
  }
  if (envelope.runId !== checkedPlan.plan.runId) {
    throw invalidContract('Execution receipt runId does not match the execution plan.')
  }
  if (envelope.taskId !== checkedPlan.plan.content.task.snapshot.taskId) {
    throw invalidContract('Execution receipt taskId does not match the execution plan.')
  }
  if (envelope.roleId !== checkedPlan.plan.content.role.snapshot.id) {
    throw invalidContract('Execution receipt roleId does not match the execution plan.')
  }
  const plannedExecutor = checkedPlan.plan.content.executor
  if (envelope.actualExecutor.id !== plannedExecutor.id) {
    throw invalidContract('Execution receipt executor id does not match the planned executor.')
  }
  if (envelope.actualExecutor.transport !== plannedExecutor.transport) {
    throw invalidContract(
      'Execution receipt executor transport does not match the planned transport.',
    )
  }
  const durationMs = receiptDurationMs(
    checkedPlan.plan.createdAt,
    envelope.startedAt,
    envelope.completedAt,
  )
  const responseValidation = validateExecutorResponse<TOutput>(
    receiptSnapshot.response,
    checkedPlan.plan.content.role.snapshot.outputSchema,
  )
  const validationSnapshot = {
    valid: responseValidation.valid,
    ...(responseValidation.response === undefined ? {} : { response: responseValidation.response }),
    errors: Object.freeze([...responseValidation.errors]),
  }
  const trustedResponse = validationSnapshot.response
  if (trustedResponse !== undefined) {
    const identityError = responseIdentityError(trustedResponse, envelope.actualExecutor)
    if (identityError !== undefined) {
      throw invalidContract(identityError)
    }
  }
  if (
    !checkedPlan.plan.content.policy.admission.allowed &&
    (trustedResponse === undefined ||
      (trustedResponse.status !== 'blocked' && trustedResponse.status !== 'cancelled'))
  ) {
    throw invalidContract(
      'An execution plan with denied admission may finalize only a blocked or cancelled response.',
    )
  }

  const outcome = normalizedOutcome<TOutput>(checkedPlan.plan, validationSnapshot)
  const response = outcome.response
  const base = {
    schema: 'rolekit/run-result@2' as const,
    runId: envelope.runId,
    taskId: envelope.taskId,
    roleId: envelope.roleId,
    execution: {
      planDigest: checkedPlan.planDigest,
      contentDigest: checkedPlan.plan.contentDigest,
      roleDigest: checkedPlan.plan.content.role.digest,
      taskDigest: checkedPlan.plan.content.task.digest,
      contractDigest: checkedPlan.plan.content.contractDigest,
      optionsDigest: checkedPlan.plan.content.executor.optionsDigest,
    },
    policy: checkedPlan.plan.content.policy,
    executor: resultExecutor(checkedPlan.plan.content, envelope.actualExecutor),
    summary: outcome.summary,
    artifacts: normalizeArtifacts(
      response,
      envelope.runId,
      envelope.actualExecutor.id,
      checkedPlan.planDigest,
    ),
    evidence: response?.evidence ?? [],
    usage: usageWithReceiptDuration(response?.usage, durationMs),
    startedAt: envelope.startedAt,
    completedAt: envelope.completedAt,
  }
  const result =
    outcome.status === 'completed'
      ? { ...base, status: 'completed' as const, output: outcome.output as TOutput }
      : {
          ...base,
          status: outcome.status,
          error: outcome.error as ExecutionError,
        }
  return freezeJsonSnapshot(result, `Run result "${envelope.runId}"`) as RunResultV2<TOutput>
}

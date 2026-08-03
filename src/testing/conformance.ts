import { mergeCapabilities, missingCapabilities } from '../core/capabilities.ts'
import { RunEventEmitter } from '../core/events.ts'
import {
  createActualExecutorIdentity,
  createExecutionPlan,
  finalizeExecution,
} from '../core/execution-plan.ts'
import { freezeJsonSnapshot, normalizeJsonSchema } from '../core/json.ts'
import { validateExecutorResponse } from '../core/response-validation.ts'
import {
  ExecutionAdmissionSchema,
  ExecutorDescriptorV2Schema,
  ExecutorProbeSchema,
  RoleSpecSchema,
  TaskPacketSchema,
} from '../core/schemas.ts'
import type {
  ExecutionAdmission,
  ExecutionReceipt,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorProbe,
  ExecutorResponse,
  JsonSchema,
  PreparedExecutorOptions,
  PublicOptionContext,
  RoleSpec,
  RunEvent,
  RunResultV2,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TaskPacket,
} from '../core/types.ts'
import {
  preparedSensitiveValues,
  redactSensitiveJsonValue,
  redactSensitiveText,
  validatePreparedExecutorOptions,
  validatePublicOptionSafety,
  validateStrictValue,
} from '../core/validation.ts'

export interface AdapterConformanceInput {
  readonly adapter: ExecutorAdapter
  readonly role: RoleSpec
  readonly task: TaskPacket
  readonly runId: string
  readonly cwd: string
  readonly options: unknown
  readonly publicOptionContext?: PublicOptionContext
  readonly signal?: AbortSignal
}

export interface AdapterConformanceReport {
  readonly valid: boolean
  readonly descriptor?: ExecutorDescriptorV2
  readonly probe?: ExecutorProbe
  readonly admission?: ExecutionAdmission
  readonly response?: ExecutorResponse
  readonly result?: RunResultV2
  readonly events: readonly RunEvent[]
  readonly errors: readonly string[]
}

const CONFORMANCE_TIMESTAMP = '2000-01-01T00:00:00.000Z'

function errorMessage(error: unknown, sensitiveValues: readonly string[] = []): string {
  try {
    const message = error instanceof Error ? error.message : String(error)
    return redactSensitiveText(message, sensitiveValues)
  } catch {
    return 'Adapter protocol operation failed.'
  }
}

function sensitiveOptionPointers(adapter: ExecutorAdapter): unknown {
  try {
    return adapter.sensitiveOptionPointers
  } catch {
    return { invalid: true }
  }
}

function validationErrors(
  label: string,
  errors: readonly string[],
  sensitiveValues: readonly string[],
): readonly string[] {
  return errors.map((error) => `${label}: ${redactSensitiveText(error, sensitiveValues)}`)
}

function strictBoundarySnapshot<T>(
  candidate: unknown,
  schema: JsonSchema,
  label: string,
  sensitiveValues: readonly string[],
  errors: string[],
): T | undefined {
  let snapshot: unknown
  try {
    snapshot = freezeJsonSnapshot(candidate, label)
  } catch (error: unknown) {
    errors.push(`${label}: ${errorMessage(error, sensitiveValues)}`)
    return undefined
  }

  const validation = validateStrictValue(schema, snapshot)
  errors.push(...validationErrors(label, validation.errors, sensitiveValues))
  return validation.valid ? (snapshot as T) : undefined
}

function immutableContractSnapshots(
  roleCandidate: RoleSpec,
  taskCandidate: TaskPacket,
  errors: string[],
): { readonly role: RoleSpec; readonly task: TaskPacket } | undefined {
  let normalizedRoleCandidate: unknown
  try {
    normalizedRoleCandidate = {
      ...roleCandidate,
      inputSchema: normalizeJsonSchema(
        roleCandidate.inputSchema,
        `Role "${roleCandidate.id}" inputSchema`,
      ),
      outputSchema: normalizeJsonSchema(
        roleCandidate.outputSchema,
        `Role "${roleCandidate.id}" outputSchema`,
      ),
    }
  } catch (error: unknown) {
    errors.push(`role: ${errorMessage(error)}`)
    return undefined
  }
  const role = strictBoundarySnapshot<RoleSpec>(
    normalizedRoleCandidate,
    RoleSpecSchema as JsonSchema,
    'role',
    [],
    errors,
  )
  const task = strictBoundarySnapshot<TaskPacket>(
    taskCandidate,
    TaskPacketSchema as JsonSchema,
    'task',
    [],
    errors,
  )
  if (role === undefined || task === undefined) {
    return undefined
  }
  if (task.roleId !== role.id) {
    errors.push(`task: roleId "${task.roleId}" does not match role id "${role.id}"`)
  }
  const inputValidation = validateStrictValue(role.inputSchema, task.input)
  errors.push(...validationErrors('task input', inputValidation.errors, []))
  return errors.length === 0 ? { role, task } : undefined
}

function admissionHonestyErrors(
  descriptor: ExecutorDescriptorV2,
  admission: ExecutionAdmission,
  role: RoleSpec,
  task: TaskPacket,
): readonly string[] {
  const errors: string[] = []
  const outsideDescriptor = admission.effectiveCapabilities.filter(
    (capability) => !descriptor.capabilities.includes(capability),
  )
  if (outsideDescriptor.length > 0) {
    errors.push(
      `admission capabilities exceed the descriptor: ${outsideDescriptor.sort().join(', ')}`,
    )
  }
  if (admission.allowed) {
    const required = mergeCapabilities(role.requiredCapabilities, task.requiredCapabilities)
    const missing = missingCapabilities(required, admission.effectiveCapabilities)
    if (missing.length > 0) {
      errors.push(`allowed admission omits required capabilities: ${missing.join(', ')}`)
    }
    const combination = required.join('+')
    if (
      combination.length > 0 &&
      !descriptor.features.permissionCombinations.includes(combination)
    ) {
      errors.push(`allowed admission uses an undeclared permission combination: ${combination}`)
    }
  }
  if (!descriptor.features.supportedPathEnforcement.includes(admission.pathEnforcement)) {
    errors.push(`admission path enforcement "${admission.pathEnforcement}" is not declared`)
  }
  const isolationKeys = [
    'userConfig',
    'projectInstructions',
    'projectResources',
    'environment',
    'credentials',
  ] as const
  if (
    isolationKeys.some((key) => {
      const inspected = descriptor.features.contextIsolation[key]
      return inspected !== 'unknown' && admission.contextIsolation[key] !== inspected
    })
  ) {
    errors.push('admission context isolation contradicts the inspected descriptor')
  }
  return errors
}

function conformanceReceipt(
  runId: string,
  taskId: string,
  roleId: string,
  planDigest: ExecutionReceipt['planDigest'],
  descriptor: ExecutorDescriptorV2,
  probe: ExecutorProbe,
  response: unknown,
): ExecutionReceipt {
  return {
    schema: 'rolekit/execution-receipt@1',
    planDigest,
    runId,
    taskId,
    roleId,
    startedAt: CONFORMANCE_TIMESTAMP,
    completedAt: CONFORMANCE_TIMESTAMP,
    actualExecutor: createActualExecutorIdentity(descriptor, probe, response),
    response,
  }
}

export async function checkAdapterConformance(
  input: AdapterConformanceInput,
): Promise<AdapterConformanceReport> {
  const errors: string[] = []
  const events: RunEvent[] = []
  let descriptor: ExecutorDescriptorV2 | undefined
  let probe: ExecutorProbe | undefined
  let admission: ExecutionAdmission | undefined
  let response: ExecutorResponse | undefined
  let result: RunResultV2 | undefined
  let sensitiveValues: readonly string[] = []
  const declarations = sensitiveOptionPointers(input.adapter)
  const report = (): AdapterConformanceReport =>
    Object.freeze({
      valid: errors.length === 0,
      ...(descriptor === undefined ? {} : { descriptor }),
      ...(probe === undefined ? {} : { probe }),
      ...(admission === undefined ? {} : { admission }),
      ...(response === undefined ? {} : { response }),
      ...(result === undefined ? {} : { result }),
      events: Object.freeze([...events]),
      errors: Object.freeze([...errors]),
    })

  const contracts = immutableContractSnapshots(input.role, input.task, errors)
  if (contracts === undefined) {
    return report()
  }
  const { role, task } = contracts

  let preparedCandidate: unknown
  try {
    preparedCandidate = input.adapter.prepareOptions(input.options, input.publicOptionContext)
  } catch (error: unknown) {
    errors.push(`protocol: prepare: ${errorMessage(error)}`)
    return report()
  }
  sensitiveValues = preparedSensitiveValues(preparedCandidate)
  const preparedValidation = validatePreparedExecutorOptions(preparedCandidate, declarations)
  errors.push(
    ...preparedValidation.errors.map(
      (error) => `prepared: ${redactSensitiveText(error, sensitiveValues)}`,
    ),
  )
  if (!preparedValidation.valid || preparedValidation.prepared === undefined) {
    return report()
  }
  const prepared: PreparedExecutorOptions = preparedValidation.prepared
  sensitiveValues = prepared.sensitiveValues

  let descriptorCandidate: unknown
  try {
    descriptorCandidate = input.adapter.inspect(prepared)
  } catch (error: unknown) {
    errors.push(`protocol: inspect: ${errorMessage(error, sensitiveValues)}`)
    return report()
  }
  descriptor = strictBoundarySnapshot<ExecutorDescriptorV2>(
    descriptorCandidate,
    ExecutorDescriptorV2Schema as JsonSchema,
    'descriptor',
    sensitiveValues,
    errors,
  )
  if (descriptor === undefined) {
    return report()
  }
  if (descriptor.id !== input.adapter.id) {
    errors.push(
      `descriptor: ${redactSensitiveText(
        `id "${descriptor.id}" does not match adapter id "${input.adapter.id}"`,
        sensitiveValues,
      )}`,
    )
    return report()
  }

  let staticAdmissionCandidate: unknown
  try {
    staticAdmissionCandidate = input.adapter.admit(role, task, prepared)
  } catch (error: unknown) {
    errors.push(`protocol: static admission: ${errorMessage(error, sensitiveValues)}`)
    return report()
  }
  const staticAdmission = strictBoundarySnapshot<ExecutionAdmission>(
    staticAdmissionCandidate,
    ExecutionAdmissionSchema as JsonSchema,
    'static admission',
    sensitiveValues,
    errors,
  )
  if (staticAdmission === undefined) {
    return report()
  }
  const staticPublicSafety = validatePublicOptionSafety(
    staticAdmission.effectivePublicOptions,
    sensitiveValues,
    declarations,
    'Static effective public options',
  )
  errors.push(...validationErrors('static admission', staticPublicSafety.errors, sensitiveValues))
  errors.push(
    ...validationErrors(
      'static admission',
      admissionHonestyErrors(descriptor, staticAdmission, role, task),
      sensitiveValues,
    ),
  )
  admission = redactSensitiveJsonValue(staticAdmission, sensitiveValues)
  if (!staticPublicSafety.valid || errors.length > 0) {
    return report()
  }
  if (!staticAdmission.allowed) {
    errors.push(
      `static admission: adapter blocked the conformant fixture (${staticAdmission.blockedError.code})`,
    )
    return report()
  }

  let probeCandidate: unknown
  try {
    probeCandidate = await input.adapter.probe(prepared, {
      cwd: input.cwd,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch (error: unknown) {
    errors.push(`protocol: probe: ${errorMessage(error, sensitiveValues)}`)
    return report()
  }
  const trustedProbe = strictBoundarySnapshot<ExecutorProbe>(
    probeCandidate,
    ExecutorProbeSchema as JsonSchema,
    'probe',
    sensitiveValues,
    errors,
  )
  if (trustedProbe === undefined) {
    return report()
  }
  probe = redactSensitiveJsonValue(trustedProbe, sensitiveValues)

  let runtimeAdmissionCandidate: unknown
  try {
    runtimeAdmissionCandidate = input.adapter.admit(role, task, prepared, probe)
  } catch (error: unknown) {
    errors.push(`protocol: runtime admission: ${errorMessage(error, sensitiveValues)}`)
    return report()
  }
  const runtimeAdmission = strictBoundarySnapshot<ExecutionAdmission>(
    runtimeAdmissionCandidate,
    ExecutionAdmissionSchema as JsonSchema,
    'runtime admission',
    sensitiveValues,
    errors,
  )
  if (runtimeAdmission === undefined) {
    return report()
  }
  const runtimePublicSafety = validatePublicOptionSafety(
    runtimeAdmission.effectivePublicOptions,
    sensitiveValues,
    declarations,
    'Runtime effective public options',
  )
  errors.push(...validationErrors('runtime admission', runtimePublicSafety.errors, sensitiveValues))
  errors.push(
    ...validationErrors(
      'runtime admission',
      admissionHonestyErrors(descriptor, runtimeAdmission, role, task),
      sensitiveValues,
    ),
  )
  admission = redactSensitiveJsonValue(runtimeAdmission, sensitiveValues)
  const unavailableProbeAdmitted = probe.available === false && runtimeAdmission.allowed
  if (unavailableProbeAdmitted) {
    errors.push('runtime admission: unavailable probe was admitted')
  }
  if (probe.available === false && !unavailableProbeAdmitted) {
    errors.push(`probe: executor was unavailable: ${probe.diagnostic}`)
  }
  if (!runtimePublicSafety.valid || !runtimeAdmission.allowed || errors.length > 0) {
    return report()
  }

  const emitter = new RunEventEmitter({
    runId: input.runId,
    timestamp: () => CONFORMANCE_TIMESTAMP,
    sensitiveValues,
    onEvent: (event) => events.push(event),
  })
  emitter.emitStarted()

  let candidate: unknown
  try {
    candidate = await input.adapter.execute(role, task, {
      runId: input.runId,
      cwd: input.cwd,
      options: prepared.executionOptions,
      admission,
      sensitiveValues,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      emitEvent: (event) => emitter.emitAdapter(event),
    })
  } catch (error: unknown) {
    errors.push(`protocol: execute: ${errorMessage(error, sensitiveValues)}`)
    emitter.emitTerminal(input.signal?.aborted === true ? 'cancelled' : 'failed')
    return report()
  }
  candidate = redactSensitiveJsonValue(candidate, sensitiveValues)
  const responseValidation = validateExecutorResponse(candidate, role.outputSchema)
  errors.push(...validationErrors('response', responseValidation.errors, sensitiveValues))
  response = responseValidation.response

  if (input.signal?.aborted === true && response?.status !== 'cancelled') {
    errors.push(
      'cancellation: an aborted adapter execution must return a cancelled response after cleanup',
    )
  }
  if (!descriptor.features.events && events.length > 1) {
    errors.push('events: adapter emitted events while descriptor.features.events is false')
  }

  try {
    const resolvedPlan = await createExecutionPlan({
      role: role as unknown as SnapshotRoleSpec,
      task: task as unknown as SnapshotTaskPacket,
      target: {
        target: 'adapter',
        capabilitySource: 'adapter-verified',
        adapterProtocol: descriptor.adapterProtocol,
        adapterVersion: descriptor.adapterVersion,
        id: descriptor.id,
        transport: descriptor.transport,
        ...(prepared.requestedProvider === undefined
          ? {}
          : { requestedProvider: prepared.requestedProvider }),
        ...(prepared.requestedModel === undefined
          ? {}
          : { requestedModel: prepared.requestedModel }),
        requiredSecrets: [],
        admission,
      },
      workspace: { root: input.cwd },
      runId: input.runId,
      createdAt: CONFORMANCE_TIMESTAMP,
    })
    result = await finalizeExecution(
      resolvedPlan,
      conformanceReceipt(
        input.runId,
        task.taskId,
        role.id,
        resolvedPlan.planDigest,
        descriptor,
        probe,
        candidate,
      ),
    )
    if (response?.status === 'completed' && result.status !== 'completed') {
      errors.push(`finalization: ${redactSensitiveText(result.error.message, sensitiveValues)}`)
    }
  } catch (error: unknown) {
    errors.push(`finalization: ${errorMessage(error, sensitiveValues)}`)
  }

  emitter.emitTerminal(result?.status ?? response?.status ?? 'failed')
  return report()
}

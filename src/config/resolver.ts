import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { mergeCapabilities, missingCapabilities } from '../core/capabilities.ts'
import { digestJson } from '../core/digest.ts'
import { RolekitError } from '../core/errors.ts'
import { freezeJsonSnapshot, normalizeJsonSchema } from '../core/json.ts'
import {
  ExecutionAdmissionSchema,
  ExecutionTargetInputSchema,
  ExecutorDescriptorV2Schema,
  ExecutorProbeSchema,
  RoleSpecSchema,
  TaskPacketSchema,
} from '../core/schemas.ts'
import type {
  ExecutionAdmission,
  ExecutionTargetInput,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  ExecutorProbe,
  JsonObject,
  JsonSchema,
  PreparedExecutorOptions,
  PublicOptionContext,
  PublicSecretMarker,
  RoleSpec,
  TaskPacket,
} from '../core/types.ts'
import {
  redactSensitiveText,
  validatePreparedExecutorOptions,
  validatePublicOptionSafety,
  validateStrictValue,
} from '../core/validation.ts'
import { privateLoadedRolekitConfigState, readStructuredFile } from './loader.ts'
import { ExecutorProfileConfigSchema } from './schemas.ts'
import {
  type AnalyzedAdapterConfig,
  analyzeAdapterConfig,
  redactStaticInspectionPreparedOptions,
  resolveAdapterConfigSecrets,
} from './secrets.ts'
import {
  type AdapterExecutorProfileConfig,
  type AdapterRegistration,
  type AdapterRegistrationHandle,
  type AdapterRegistry,
  type CompiledExecutorProfile,
  type CompiledRoleBinding,
  type ExecutorProfileDigestInput,
  type HostExecutorDescriptor,
  type HostExecutorProfileConfig,
  type LoadedExecutorProfileEntry,
  type LoadedRoleConfigEntry,
  type LoadedRolekitConfig,
  type ResolvedRunBinding,
  RolekitConfigError,
} from './types.ts'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u
const STATIC_INSPECTION_SENTINEL = 'rolekit-non-secret-static-placeholder'
const COMPILED_RUNTIME_TOKEN = Symbol('rolekit.compiled-runtime-token')

function sortedUnique<TValue extends string>(values: readonly TValue[]): readonly TValue[] {
  return [...new Set(values)].sort()
}

function safeFailureMessage(error: unknown, sensitiveValues: readonly string[] = []): string {
  let message = 'Adapter configuration failed.'
  try {
    if (error instanceof Error && error.message.length > 0) {
      message = error.message
    } else if (typeof error === 'string' && error.length > 0) {
      message = error
    }
  } catch {
    // Hostile thrown values are reduced to the generic message above.
  }
  return redactSensitiveText(message, sensitiveValues)
}

function pointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function adapterBoundary<TValue>(
  run: () => TValue,
  sensitiveValues: readonly string[],
  sourcePath: string,
  pointer: string,
): TValue {
  try {
    return run()
  } catch (error: unknown) {
    throw new RolekitConfigError('invalid_config', safeFailureMessage(error, sensitiveValues), {
      sourcePath,
      pointer,
    })
  }
}

function assertPreparedOptions(
  prepared: unknown,
  adapter: ExecutorAdapter,
  sourcePath: string,
  pointer: string,
): asserts prepared is PreparedExecutorOptions {
  const validation = validatePreparedExecutorOptions(prepared, adapter.sensitiveOptionPointers)
  if (!validation.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Adapter prepared options are unsafe: ${validation.errors.join('; ')}`,
      { sourcePath, pointer },
    )
  }
}

function assertDescriptor(
  descriptor: unknown,
  expectedId: string,
  sourcePath: string,
  pointer: string,
): asserts descriptor is ExecutorDescriptorV2 {
  const validation = validateStrictValue(ExecutorDescriptorV2Schema as JsonSchema, descriptor)
  if (!validation.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Adapter descriptor is invalid: ${validation.errors.join('; ')}`,
      { sourcePath, pointer },
    )
  }
  if ((descriptor as ExecutorDescriptorV2).id !== expectedId) {
    throw new RolekitConfigError(
      'invalid_config',
      `Adapter registration "${expectedId}" returned a descriptor with a different id.`,
      { sourcePath, pointer },
    )
  }
}

function normalizePromptPart(value: string): string {
  return value.replaceAll('\r\n', '\n').replace(/\s+$/u, '')
}

function roleSpecFailure(entry: LoadedRoleConfigEntry, message: string): RolekitConfigError {
  return new RolekitConfigError(
    'invalid_config',
    `Declared role spec ${entry.specPath}: ${message}`,
    { sourcePath: entry.sourcePath, pointer: `${entry.pointer}/spec` },
  )
}

async function loadResolvedRole(roleId: string, entry: LoadedRoleConfigEntry): Promise<RoleSpec> {
  let parsed: unknown
  try {
    parsed = await readStructuredFile(entry.specPath)
  } catch {
    throw roleSpecFailure(entry, 'Unable to read or parse the declared role spec.')
  }
  const validation = validateStrictValue(RoleSpecSchema as JsonSchema, parsed)
  if (!validation.valid) {
    throw roleSpecFailure(entry, `Role spec is invalid: ${validation.errors.join('; ')}`)
  }

  const candidate = parsed as RoleSpec
  if (candidate.id !== roleId) {
    throw roleSpecFailure(
      entry,
      `Role spec declares id "${candidate.id}" instead of config key "${roleId}".`,
    )
  }

  const fragments: string[] = []
  for (const [index, fragmentPath] of entry.promptFragmentPaths.entries()) {
    let text: string
    try {
      text = await readFile(fragmentPath, 'utf8')
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? ` (${error.code})`
          : ''
      throw new RolekitConfigError(
        'invalid_config',
        `Unable to read prompt fragment ${fragmentPath}${code}.`,
        { sourcePath: entry.sourcePath, pointer: `${entry.pointer}/promptFragments/${index}` },
      )
    }
    const normalized = normalizePromptPart(text)
    if (normalized.length === 0) {
      throw new RolekitConfigError(
        'invalid_config',
        `Prompt fragment ${fragmentPath} is empty after trailing file whitespace is removed.`,
        { sourcePath: entry.sourcePath, pointer: `${entry.pointer}/promptFragments/${index}` },
      )
    }
    fragments.push(normalized)
  }

  const instructions =
    fragments.length === 0
      ? candidate.instructions
      : [
          ...(candidate.instructions === undefined
            ? []
            : [normalizePromptPart(candidate.instructions)]),
          ...fragments,
        ].join('\n\n')

  let inputSchema: JsonObject
  let outputSchema: JsonObject
  try {
    inputSchema = normalizeJsonSchema(
      candidate.inputSchema,
      `Role "${roleId}" inputSchema from ${entry.specPath}`,
    )
    outputSchema = normalizeJsonSchema(
      candidate.outputSchema,
      `Role "${roleId}" outputSchema from ${entry.specPath}`,
    )
  } catch (error: unknown) {
    throw roleSpecFailure(entry, safeFailureMessage(error))
  }

  const role = freezeJsonSnapshot(
    {
      ...candidate,
      inputSchema,
      outputSchema,
      ...(instructions === undefined ? {} : { instructions }),
    },
    `Resolved role "${roleId}"`,
  ) as unknown as RoleSpec
  const resolvedValidation = validateStrictValue(RoleSpecSchema as JsonSchema, role)
  if (!resolvedValidation.valid) {
    throw roleSpecFailure(
      entry,
      `Resolved role spec is invalid: ${resolvedValidation.errors.join('; ')}`,
    )
  }
  return role
}

function adapterProfile(
  adapterId: string,
  publicConfig: JsonObject,
  hadOptions: boolean,
): AdapterExecutorProfileConfig {
  return freezeJsonSnapshot(
    {
      mode: 'adapter',
      adapter: adapterId,
      ...(hadOptions ? { options: publicConfig } : {}),
    },
    `Normalized adapter profile "${adapterId}"`,
  ) as AdapterExecutorProfileConfig
}

function hostDescriptor(profile: HostExecutorProfileConfig): HostExecutorDescriptor {
  return freezeJsonSnapshot(
    {
      schema: 'rolekit/host-executor-descriptor@1',
      id: profile.executorId,
      transport: profile.transport,
      capabilities: profile.capabilities,
      contextIsolation: profile.contextIsolation,
      pathEnforcement: profile.pathEnforcement,
    },
    `Host executor descriptor "${profile.executorId}"`,
  ) as HostExecutorDescriptor
}

function isPublicSecretMarker(value: unknown): value is PublicSecretMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Readonly<Record<string, unknown>>
  const keys = Object.keys(candidate).sort()
  if (
    candidate.source === 'literal' &&
    candidate.redacted === true &&
    keys.length === 2 &&
    keys[0] === 'redacted' &&
    keys[1] === 'source'
  ) {
    return true
  }
  return (
    candidate.source === 'env' &&
    candidate.redacted === true &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    keys.length === 3 &&
    keys[0] === 'name' &&
    keys[1] === 'redacted' &&
    keys[2] === 'source'
  )
}

function assertDigestPublicValue(value: unknown, pointer: string): void {
  if (value === STATIC_INSPECTION_SENTINEL) {
    throw new RolekitConfigError(
      'invalid_config',
      `Executor profile normalized profile contains a private static sentinel at ${pointer}.`,
    )
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return
  }
  if (typeof value === 'string') {
    return
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertDigestPublicValue(entry, `${pointer}/${index}`)
    }
    return
  }
  if (typeof value !== 'object' || value === null) {
    throw new RolekitConfigError(
      'invalid_config',
      `Executor profile normalized profile is not portable JSON at ${pointer}.`,
    )
  }
  const candidate = value as Readonly<Record<string, unknown>>
  if (Object.hasOwn(candidate, '$env')) {
    throw new RolekitConfigError(
      'invalid_config',
      `Executor profile normalized profile contains an unresolved environment reference at ${pointer}.`,
    )
  }
  if (candidate.source === 'env' || candidate.source === 'literal' || candidate.redacted === true) {
    if (!isPublicSecretMarker(candidate)) {
      throw new RolekitConfigError(
        'invalid_config',
        `Executor profile normalized profile contains an unsafe public secret marker at ${pointer}.`,
      )
    }
    return
  }
  for (const [key, entry] of Object.entries(candidate)) {
    assertDigestPublicValue(entry, `${pointer}/${pointerToken(key)}`)
  }
}

export async function digestExecutorProfile(
  input: ExecutorProfileDigestInput,
): Promise<Awaited<ReturnType<typeof digestJson>>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new RolekitConfigError(
      'invalid_config',
      'Executor profile digest input must be an object.',
    )
  }
  let keys: readonly string[]
  try {
    keys = Object.keys(input).sort()
  } catch {
    throw new RolekitConfigError('invalid_config', 'Executor profile digest input is invalid.')
  }
  if (
    keys.length !== 3 ||
    keys[0] !== 'normalizedProfile' ||
    keys[1] !== 'profileId' ||
    keys[2] !== 'schema'
  ) {
    throw new RolekitConfigError(
      'invalid_config',
      'Executor profile digest input must contain exactly schema, profileId, and normalizedProfile.',
    )
  }
  if (input.schema !== 'rolekit/executor-profile@1') {
    throw new RolekitConfigError('invalid_config', 'Executor profile digest schema is invalid.')
  }
  if (typeof input.profileId !== 'string' || !IDENTIFIER.test(input.profileId)) {
    throw new RolekitConfigError('invalid_config', 'Executor profile digest profileId is invalid.')
  }
  const validation = validateStrictValue(
    ExecutorProfileConfigSchema as JsonSchema,
    input.normalizedProfile,
  )
  if (!validation.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Executor profile normalized profile is invalid: ${validation.errors.join('; ')}`,
    )
  }
  if (input.normalizedProfile.mode === 'host') {
    const hostProfile = input.normalizedProfile
    const normalizedCapabilities = sortedUnique(hostProfile.capabilities)
    if (
      normalizedCapabilities.some(
        (capability, index) => capability !== hostProfile.capabilities[index],
      )
    ) {
      throw new RolekitConfigError(
        'invalid_config',
        'Executor profile normalized host capabilities must be sorted and unique.',
      )
    }
  }
  assertDigestPublicValue(input.normalizedProfile, '/normalizedProfile')
  const preimage: ExecutorProfileDigestInput = {
    schema: 'rolekit/executor-profile@1',
    profileId: input.profileId,
    normalizedProfile: input.normalizedProfile,
  }
  return digestJson(preimage, 'Executor profile digest input')
}

interface InternalAnalyzedRegistration {
  readonly publicConfig: JsonObject
  readonly publicOptionContext: PublicOptionContext
  readonly requiredSecrets: readonly string[]
  readonly literalSecretValues: readonly string[]
  readonly inspect: () => {
    readonly adapter: ExecutorAdapter
    readonly prepared: PreparedExecutorOptions
  }
  readonly resolve: (environment: Readonly<Record<string, string | undefined>>) => {
    readonly rawOptions: unknown
    readonly publicOptionContext: PublicOptionContext
  }
}

interface InternalRegistrationEntry {
  readonly id: string
  readonly analyze: (
    value: unknown,
    options: {
      readonly sourcePath: string
      readonly basePointer: string
      readonly declaringDirectory?: string
    },
  ) => InternalAnalyzedRegistration
  readonly create: () => ExecutorAdapter
}

const privateRegistrationEntries = new WeakMap<object, InternalRegistrationEntry>()
const privateRegistryEntries = new WeakMap<object, ReadonlyMap<string, InternalRegistrationEntry>>()

export function defineAdapterRegistration<TConfig, TOptions>(input: {
  readonly id: string
  readonly configOptionsSchema: JsonSchema<TConfig>
  readonly create: () => ExecutorAdapter<TOptions>
}): AdapterRegistration<TConfig, TOptions> {
  const inspectConfig = (options: TConfig) => {
    const analyzed = analyzeAdapterConfig(options, input.configOptionsSchema, {
      sourcePath: `adapter:${input.id}`,
      basePointer: '/options',
    })
    const adapter = input.create()
    const prepared = adapter.prepareOptions(analyzed.inspectionConfig, analyzed.publicOptionContext)
    return {
      prepared,
      requiredSecrets: analyzed.requiredSecrets,
    }
  }
  const resolveExecutionOptions = (
    options: TConfig,
    environment: Readonly<Record<string, string | undefined>>,
  ) => {
    const resolved = resolveAdapterConfigSecrets(options, input.configOptionsSchema, environment, {
      sourcePath: `adapter:${input.id}`,
      basePointer: '/options',
    })
    return {
      rawOptions: resolved.rawOptions,
      publicOptionContext: resolved.publicOptionContext,
    }
  }
  const registration = Object.freeze({
    id: input.id,
    configOptionsSchema: input.configOptionsSchema,
    create: input.create,
    inspectConfig,
    resolveExecutionOptions,
  }) as unknown as AdapterRegistration<TConfig, TOptions>

  privateRegistrationEntries.set(registration, {
    id: input.id,
    create: input.create as () => ExecutorAdapter,
    analyze(value, options) {
      const analyzed: AnalyzedAdapterConfig<TConfig> = analyzeAdapterConfig(
        value,
        input.configOptionsSchema,
        options,
      )
      return {
        publicConfig: analyzed.publicConfig,
        publicOptionContext: analyzed.publicOptionContext,
        requiredSecrets: analyzed.requiredSecrets,
        literalSecretValues: analyzed.literalSecretValues,
        inspect() {
          const adapter = input.create()
          return {
            adapter,
            prepared: adapter.prepareOptions(
              analyzed.inspectionConfig,
              analyzed.publicOptionContext,
            ),
          }
        },
        resolve(environment) {
          const resolved = resolveAdapterConfigSecrets(
            analyzed.normalizedConfig,
            input.configOptionsSchema,
            environment,
            {
              sourcePath: options.sourcePath,
              basePointer: options.basePointer,
            },
          )
          return {
            rawOptions: resolved.rawOptions,
            publicOptionContext: resolved.publicOptionContext,
          }
        },
      }
    },
  })
  return registration
}

export function createAdapterRegistry(
  registrations: readonly AdapterRegistrationHandle[],
): AdapterRegistry {
  const entries = new Map<string, InternalRegistrationEntry>()
  for (const registration of registrations) {
    const entry =
      typeof registration === 'object' && registration !== null
        ? privateRegistrationEntries.get(registration)
        : undefined
    if (entry === undefined) {
      throw new RolekitConfigError(
        'invalid_config',
        'Adapter registrations must be opaque values returned by defineAdapterRegistration().',
      )
    }
    if (entries.has(entry.id)) {
      throw new RolekitConfigError(
        'duplicate_registration',
        `Adapter registration "${entry.id}" is duplicated.`,
      )
    }
    entries.set(entry.id, entry)
  }
  const registry = Object.freeze({}) as AdapterRegistry
  privateRegistryEntries.set(registry, entries)
  return registry
}

function registryEntries(
  registry: AdapterRegistry,
): ReadonlyMap<string, InternalRegistrationEntry> {
  const entries =
    typeof registry === 'object' && registry !== null
      ? privateRegistryEntries.get(registry)
      : undefined
  if (entries === undefined) {
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter registry is an opaque handle and cannot be cloned or reconstructed.',
    )
  }
  return entries
}

function exactRegistration(
  registry: AdapterRegistry,
  id: string,
): InternalRegistrationEntry | undefined {
  return registryEntries(registry).get(id)
}

interface PrivateAdapterBinding {
  readonly registrationId: string
  readonly analyzed: InternalAnalyzedRegistration
  readonly sourcePath: string
  readonly basePointer: string
  readonly inspectionAdapter: ExecutorAdapter
  readonly inspectionPreparedOptions: PreparedExecutorOptions
}

const privateAdapterBindings = new WeakMap<object, PrivateAdapterBinding>()

function compiledHandle<TValue>(
  value: Readonly<Record<string, unknown>>,
  label: string,
  privateBinding?: PrivateAdapterBinding,
): TValue {
  const snapshot = freezeJsonSnapshot(value, label) as Readonly<Record<string, unknown>>
  const handle = { ...snapshot }
  if (privateBinding !== undefined) {
    const token = Object.freeze({})
    privateAdapterBindings.set(token, privateBinding)
    Object.defineProperty(handle, COMPILED_RUNTIME_TOKEN, {
      configurable: false,
      enumerable: false,
      value: token,
      writable: false,
    })
  }
  return Object.freeze(handle) as unknown as TValue
}

function privateAdapterBinding(
  compiled: CompiledExecutorProfile | CompiledRoleBinding,
): PrivateAdapterBinding | undefined {
  try {
    if (!Object.hasOwn(compiled, COMPILED_RUNTIME_TOKEN)) {
      return undefined
    }
    const token = (compiled as unknown as Record<symbol, unknown>)[COMPILED_RUNTIME_TOKEN]
    return typeof token === 'object' && token !== null
      ? privateAdapterBindings.get(token)
      : undefined
  } catch {
    return undefined
  }
}

function assertNoSensitiveSerialization(
  value: unknown,
  sensitiveValues: readonly string[],
  sourcePath: string,
  pointer: string,
): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new RolekitConfigError('invalid_config', 'Adapter public snapshot is invalid.', {
      sourcePath,
      pointer,
    })
  }
  if (
    serialized.includes(STATIC_INSPECTION_SENTINEL) ||
    sensitiveValues.some((secret) => secret.length > 0 && serialized.includes(secret))
  ) {
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter public snapshot contains a sensitive value.',
      { sourcePath, pointer },
    )
  }
}

async function inspectExecutorProfileEntry(
  profileId: string,
  profileEntry: LoadedExecutorProfileEntry,
  registry: AdapterRegistry,
): Promise<CompiledExecutorProfile> {
  if (profileEntry.config.mode === 'host') {
    const profile = freezeJsonSnapshot(
      {
        ...profileEntry.config,
        capabilities: sortedUnique(profileEntry.config.capabilities),
      },
      `Host profile "${profileId}"`,
    ) as HostExecutorProfileConfig
    const descriptor = hostDescriptor(profile)
    const profileDigest = await digestExecutorProfile({
      schema: 'rolekit/executor-profile@1',
      profileId,
      normalizedProfile: profile,
    })
    return compiledHandle<CompiledExecutorProfile>(
      {
        executorProfileId: profileId,
        executorId: profile.executorId,
        profilePublicOptions: {},
        requiredSecrets: [],
        profileDigest,
        profile,
        capabilitySource: 'host-attested',
        descriptor,
      },
      `Compiled host profile "${profileId}"`,
    )
  }

  const registration = exactRegistration(registry, profileEntry.config.adapter)
  if (registration === undefined) {
    throw new RolekitConfigError(
      'unknown_adapter',
      `No adapter registration is named "${profileEntry.config.adapter}".`,
      { sourcePath: profileEntry.sourcePath, pointer: `${profileEntry.pointer}/adapter` },
    )
  }

  const optionsPointer = `${profileEntry.pointer}/options`
  const configuredOptions = profileEntry.config.options ?? {}
  const analyzed = registration.analyze(configuredOptions, {
    sourcePath: profileEntry.sourcePath,
    basePointer: optionsPointer,
    declaringDirectory: dirname(profileEntry.sourcePath),
  })
  const inspection = adapterBoundary(
    analyzed.inspect,
    analyzed.literalSecretValues,
    profileEntry.sourcePath,
    optionsPointer,
  )
  const inspected = adapterBoundary(
    () => {
      if (inspection.adapter.id !== registration.id) {
        throw new Error('Adapter factory returned an inconsistent adapter identity.')
      }
      assertPreparedOptions(
        inspection.prepared,
        inspection.adapter,
        profileEntry.sourcePath,
        optionsPointer,
      )
      const descriptor = inspection.adapter.inspect(inspection.prepared)
      assertDescriptor(
        descriptor,
        registration.id,
        profileEntry.sourcePath,
        `${profileEntry.pointer}/adapter`,
      )
      const publicPrepared = redactStaticInspectionPreparedOptions(
        inspection.prepared,
        analyzed.publicOptionContext,
      )
      return { descriptor, publicPrepared }
    },
    analyzed.literalSecretValues,
    profileEntry.sourcePath,
    optionsPointer,
  )

  assertNoSensitiveSerialization(
    inspection.prepared.publicOptions,
    analyzed.literalSecretValues,
    profileEntry.sourcePath,
    optionsPointer,
  )
  assertNoSensitiveSerialization(
    inspected.publicPrepared,
    analyzed.literalSecretValues,
    profileEntry.sourcePath,
    optionsPointer,
  )
  const profile = adapterProfile(
    profileEntry.config.adapter,
    analyzed.publicConfig,
    profileEntry.config.options !== undefined,
  )
  const profileDigest = await digestExecutorProfile({
    schema: 'rolekit/executor-profile@1',
    profileId,
    normalizedProfile: profile,
  })
  return compiledHandle<CompiledExecutorProfile>(
    {
      executorProfileId: profileId,
      executorId: registration.id,
      profilePublicOptions: inspection.prepared.publicOptions,
      requiredSecrets: analyzed.requiredSecrets,
      profileDigest,
      profile,
      capabilitySource: 'adapter-verified',
      descriptor: inspected.descriptor,
      inspectionPreparedOptions: inspected.publicPrepared,
    },
    `Compiled adapter profile "${profileId}"`,
    {
      registrationId: registration.id,
      analyzed,
      sourcePath: profileEntry.sourcePath,
      basePointer: optionsPointer,
      inspectionAdapter: inspection.adapter,
      inspectionPreparedOptions: inspection.prepared,
    },
  )
}

export async function inspectExecutorProfile(
  loaded: LoadedRolekitConfig,
  profileId: string,
  registry: AdapterRegistry,
): Promise<CompiledExecutorProfile> {
  const loadedState = privateLoadedRolekitConfigState(loaded)
  const profileEntry = loadedState.executors.get(profileId)
  if (profileEntry === undefined) {
    throw new RolekitConfigError(
      'unknown_executor_profile',
      `No executor profile is named "${profileId}".`,
      {
        sourcePath: loadedState.rootPath,
        pointer: `/executors/${pointerToken(profileId)}`,
      },
    )
  }
  return inspectExecutorProfileEntry(profileId, profileEntry, registry)
}

export async function validateLoadedRolekitConfig(
  loaded: LoadedRolekitConfig,
  registry: AdapterRegistry,
): Promise<void> {
  const loadedState = privateLoadedRolekitConfigState(loaded)
  for (const declaration of loadedState.executorDeclarations) {
    await inspectExecutorProfileEntry(declaration.id, declaration.entry, registry)
  }
  for (const declaration of loadedState.roleDeclarations) {
    await loadResolvedRole(declaration.id, declaration.entry)
  }
  for (const roleEntry of loadedState.roles.values()) {
    if (!loadedState.executors.has(roleEntry.config.executor)) {
      throw new RolekitConfigError(
        'unknown_executor_profile',
        `No executor profile is named "${roleEntry.config.executor}".`,
        {
          sourcePath: roleEntry.sourcePath,
          pointer: `${roleEntry.pointer}/executor`,
        },
      )
    }
  }
}

export async function compileRoleBinding(
  loaded: LoadedRolekitConfig,
  roleId: string,
  registry: AdapterRegistry,
  executorOverride?: string,
): Promise<CompiledRoleBinding> {
  const loadedState = privateLoadedRolekitConfigState(loaded)
  const roleEntry = loadedState.roles.get(roleId)
  if (roleEntry === undefined) {
    throw new RolekitConfigError('unknown_role', `No configured role is named "${roleId}".`, {
      sourcePath: loadedState.rootPath,
      pointer: `/roles/${pointerToken(roleId)}`,
    })
  }
  const role = await loadResolvedRole(roleId, roleEntry)
  const profileId = executorOverride ?? roleEntry.config.executor
  const profileEntry = loadedState.executors.get(profileId)
  if (profileEntry === undefined) {
    if (executorOverride !== undefined) {
      throw new RolekitConfigError(
        'unknown_executor_profile',
        `caller-supplied executor override "${profileId}" does not name a configured profile.`,
      )
    }
    throw new RolekitConfigError(
      'unknown_executor_profile',
      `No executor profile is named "${profileId}".`,
      {
        sourcePath: roleEntry.sourcePath,
        pointer: `${roleEntry.pointer}/executor`,
      },
    )
  }

  const compiledProfile = await inspectExecutorProfileEntry(profileId, profileEntry, registry)
  return compiledHandle<CompiledRoleBinding>(
    {
      role,
      roleSource: roleEntry.specPath,
      promptSources: roleEntry.promptFragmentPaths,
      ...compiledProfile,
    },
    `Compiled role binding "${roleId}"`,
    privateAdapterBinding(compiledProfile),
  )
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

function taskForCompiledRole(compiled: CompiledRoleBinding, value: unknown): TaskPacket {
  let task: TaskPacket
  try {
    task = freezeJsonSnapshot(value, 'Configured task') as TaskPacket
  } catch {
    throw new RolekitError('invalid_contract', 'Task could not be snapshotted as portable JSON.')
  }
  const validation = validateStrictValue(TaskPacketSchema as JsonSchema, task)
  if (!validation.valid) {
    throw new RolekitError('invalid_contract', `Task is invalid: ${validation.errors.join('; ')}`, {
      errors: [...validation.errors],
    })
  }
  if (task.roleId !== compiled.role.id) {
    throw new RolekitError(
      'invalid_contract',
      `Task roleId "${task.roleId}" does not match configured role "${compiled.role.id}".`,
    )
  }
  const inputValidation = validateStrictValue(compiled.role.inputSchema, task.input)
  if (!inputValidation.valid) {
    throw new RolekitError(
      'invalid_contract',
      `Task "${task.taskId}" input does not match role "${compiled.role.id}": ${inputValidation.errors.join('; ')}`,
      { errors: [...inputValidation.errors] },
    )
  }
  const duplicateArtifacts = duplicateValues(
    task.expectedArtifacts.map((artifact) => artifact.name),
  )
  if (duplicateArtifacts.length > 0) {
    throw new RolekitError(
      'invalid_contract',
      `Task "${task.taskId}" repeats expected artifact names: ${duplicateArtifacts.join(', ')}.`,
    )
  }
  return task
}

function validatedAdapterAdmission(
  compiled: Extract<CompiledRoleBinding, { readonly capabilitySource: 'adapter-verified' }>,
  task: TaskPacket,
): ExecutionAdmission {
  const privateBinding = privateAdapterBinding(compiled)
  if (privateBinding === undefined) {
    throw new RolekitConfigError(
      'invalid_config',
      'Compiled adapter binding is an opaque runtime handle and cannot be cloned or reconstructed.',
    )
  }
  const admission = adapterBoundary(
    () =>
      privateBinding.inspectionAdapter.admit(
        compiled.role,
        task,
        compiled.inspectionPreparedOptions,
      ),
    [],
    privateBinding.sourcePath,
    privateBinding.basePointer,
  )
  const validation = validateStrictValue(ExecutionAdmissionSchema as JsonSchema, admission)
  if (!validation.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Adapter static admission is invalid: ${validation.errors.join('; ')}`,
      { sourcePath: privateBinding.sourcePath, pointer: privateBinding.basePointer },
    )
  }
  const publicSafety = validatePublicOptionSafety(
    (admission as ExecutionAdmission).effectivePublicOptions,
    [],
    privateBinding.inspectionAdapter.sensitiveOptionPointers,
    'Static admission public options',
  )
  if (!publicSafety.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Adapter static admission contains unsafe public options: ${publicSafety.errors.join('; ')}`,
      { sourcePath: privateBinding.sourcePath, pointer: privateBinding.basePointer },
    )
  }
  return freezeJsonSnapshot(admission, 'Configured adapter static admission') as ExecutionAdmission
}

function hostAdmission(
  compiled: Extract<CompiledRoleBinding, { readonly capabilitySource: 'host-attested' }>,
  task: TaskPacket,
): ExecutionAdmission {
  const effectiveCapabilities = sortedUnique(compiled.profile.capabilities)
  const requiredCapabilities = mergeCapabilities(
    compiled.role.requiredCapabilities,
    task.requiredCapabilities,
  )
  const missing = missingCapabilities(requiredCapabilities, effectiveCapabilities)
  const common = {
    effectiveCapabilities,
    effectivePublicOptions: {},
    pathEnforcement: compiled.profile.pathEnforcement,
    contextIsolation: compiled.profile.contextIsolation,
  } as const
  return freezeJsonSnapshot(
    missing.length === 0
      ? { allowed: true, ...common }
      : {
          allowed: false,
          ...common,
          blockedError: {
            code: 'capability_mismatch',
            message: `Missing capabilities: ${missing.join(', ')}.`,
            retryable: false,
            details: {
              required: [...requiredCapabilities],
              available: [...effectiveCapabilities],
              missing: [...missing],
            },
          },
        },
    'Configured host static admission',
  ) as ExecutionAdmission
}

export function compileTaskExecutionTarget(
  compiled: CompiledRoleBinding,
  taskValue: unknown,
): ExecutionTargetInput {
  const task = taskForCompiledRole(compiled, taskValue)
  const admission =
    compiled.capabilitySource === 'adapter-verified'
      ? validatedAdapterAdmission(compiled, task)
      : hostAdmission(compiled, task)
  const common = {
    id: compiled.executorId,
    transport: compiled.descriptor.transport,
    profileId: compiled.executorProfileId,
    profileDigest: compiled.profileDigest,
    requiredSecrets: compiled.requiredSecrets,
    admission,
  } as const
  const target: ExecutionTargetInput =
    compiled.capabilitySource === 'adapter-verified'
      ? {
          target: 'adapter',
          capabilitySource: 'adapter-verified',
          adapterProtocol: compiled.descriptor.adapterProtocol,
          adapterVersion: compiled.descriptor.adapterVersion,
          ...common,
          ...(compiled.inspectionPreparedOptions.requestedProvider === undefined
            ? {}
            : { requestedProvider: compiled.inspectionPreparedOptions.requestedProvider }),
          ...(compiled.inspectionPreparedOptions.requestedModel === undefined
            ? {}
            : { requestedModel: compiled.inspectionPreparedOptions.requestedModel }),
        }
      : {
          target: 'host',
          capabilitySource: 'host-attested',
          ...common,
          ...(compiled.profile.requestedProvider === undefined
            ? {}
            : { requestedProvider: compiled.profile.requestedProvider }),
          ...(compiled.profile.requestedModel === undefined
            ? {}
            : { requestedModel: compiled.profile.requestedModel }),
        }
  const validation = validateStrictValue(ExecutionTargetInputSchema as JsonSchema, target)
  if (!validation.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Compiled execution target is invalid: ${validation.errors.join('; ')}`,
    )
  }
  return freezeJsonSnapshot(target, `Execution target for task "${task.taskId}"`)
}

export async function probeExecutorProfile(
  compiled: CompiledExecutorProfile,
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecutorProbe> {
  if (compiled.capabilitySource === 'host-attested') {
    throw new RolekitConfigError(
      'host_execution_required',
      `Profile "${compiled.executorProfileId}" is host-attested and has no adapter executable to probe.`,
    )
  }
  const privateBinding = privateAdapterBinding(compiled)
  if (privateBinding === undefined) {
    throw new RolekitConfigError(
      'invalid_config',
      'Compiled adapter profile is an opaque handle and cannot be cloned or reconstructed.',
    )
  }
  const staticSecrets = [
    ...privateBinding.analyzed.literalSecretValues,
    ...privateBinding.inspectionPreparedOptions.sensitiveValues,
  ]
  let sensitiveValues = staticSecrets
  let candidate: unknown
  try {
    const prepareProbeOptions = privateBinding.inspectionAdapter.prepareProbeOptions
    const hasStaticSecrets =
      privateBinding.analyzed.requiredSecrets.length > 0 ||
      privateBinding.analyzed.literalSecretValues.length > 0
    const prepared =
      prepareProbeOptions === undefined
        ? hasStaticSecrets
          ? undefined
          : privateBinding.inspectionPreparedOptions
        : prepareProbeOptions.call(
            privateBinding.inspectionAdapter,
            privateBinding.inspectionPreparedOptions,
          )
    if (prepared === undefined) {
      candidate = {
        available: false,
        featureChecks: {},
        diagnostic:
          'Adapter does not support credential-free probing for secret-bearing static options.',
      }
    } else {
      assertPreparedOptions(
        prepared,
        privateBinding.inspectionAdapter,
        privateBinding.sourcePath,
        privateBinding.basePointer,
      )
      assertNoSensitiveSerialization(
        prepared,
        privateBinding.analyzed.literalSecretValues,
        privateBinding.sourcePath,
        privateBinding.basePointer,
      )
      sensitiveValues = [...staticSecrets, ...prepared.sensitiveValues]
      candidate = await privateBinding.inspectionAdapter.probe(prepared, {
        cwd,
        ...(signal === undefined ? {} : { signal }),
      })
    }
  } catch (error: unknown) {
    candidate = {
      available: false,
      featureChecks: {},
      diagnostic: safeFailureMessage(error, sensitiveValues),
    }
  }
  const validation = validateStrictValue(ExecutorProbeSchema as JsonSchema, candidate)
  if (!validation.valid) {
    throw new RolekitConfigError(
      'invalid_config',
      `Adapter probe is invalid: ${validation.errors.join('; ')}`,
      { sourcePath: privateBinding.sourcePath, pointer: privateBinding.basePointer },
    )
  }
  return freezeJsonSnapshot(
    candidate,
    `Executor probe "${compiled.executorProfileId}"`,
  ) as ExecutorProbe
}

function safePublicContext(
  value: PublicOptionContext,
  sensitiveValues: readonly string[],
  sourcePath: string,
  pointer: string,
): PublicOptionContext {
  const replacements = value.replacementsByJsonPointer
  if (typeof replacements !== 'object' || replacements === null || Array.isArray(replacements)) {
    throw new RolekitConfigError('invalid_config', 'Public option context is invalid.', {
      sourcePath,
      pointer,
    })
  }
  for (const [replacementPointer, marker] of Object.entries(replacements)) {
    if (!replacementPointer.startsWith('/') || !isPublicSecretMarker(marker)) {
      throw new RolekitConfigError('invalid_config', 'Public option context is invalid.', {
        sourcePath,
        pointer,
      })
    }
  }
  const snapshot = freezeJsonSnapshot(
    value,
    'Resolved public option context',
  ) as PublicOptionContext
  const serialized = JSON.stringify(snapshot)
  if (sensitiveValues.some((secret) => secret.length > 0 && serialized.includes(secret))) {
    throw new RolekitConfigError(
      'invalid_config',
      'Public option context contains a resolved sensitive value.',
      { sourcePath, pointer },
    )
  }
  return snapshot
}

export async function resolveRunBinding(
  compiled: CompiledRoleBinding,
  registry: AdapterRegistry,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ResolvedRunBinding> {
  if (compiled.capabilitySource === 'host-attested') {
    throw new RolekitConfigError(
      'host_execution_required',
      `Profile "${compiled.executorProfileId}" requires execution by its attested host.`,
    )
  }
  const privateBinding = privateAdapterBinding(compiled)
  if (privateBinding === undefined) {
    throw new RolekitConfigError(
      'invalid_config',
      'Compiled adapter binding is an opaque runtime handle and cannot be cloned or reconstructed.',
    )
  }
  const registration = exactRegistration(registry, privateBinding.registrationId)
  if (registration === undefined) {
    throw new RolekitConfigError(
      'unknown_adapter',
      `No adapter registration is named "${privateBinding.registrationId}".`,
    )
  }

  const missing = privateBinding.analyzed.requiredSecrets.filter(
    (name) => environment[name] === undefined,
  )
  if (missing.length > 0) {
    throw new RolekitConfigError(
      'missing_secret',
      `Missing required environment values: ${missing.join(', ')}.`,
      {
        sourcePath: privateBinding.sourcePath,
        pointer: privateBinding.basePointer,
      },
    )
  }
  const suppliedSensitiveValues = privateBinding.analyzed.requiredSecrets
    .map((name) => environment[name])
    .filter((value): value is string => value !== undefined)
  const allSensitiveValues = [
    ...privateBinding.analyzed.literalSecretValues,
    ...suppliedSensitiveValues,
  ]

  const resolution = privateBinding.analyzed.resolve(environment)
  const publicOptionContext = safePublicContext(
    resolution.publicOptionContext,
    allSensitiveValues,
    privateBinding.sourcePath,
    privateBinding.basePointer,
  )
  const adapter = adapterBoundary(
    registration.create,
    allSensitiveValues,
    privateBinding.sourcePath,
    privateBinding.basePointer,
  )
  adapterBoundary(
    () => {
      if (adapter.id !== privateBinding.registrationId) {
        throw new Error('Adapter registration identity changed between compile and run resolution.')
      }
      const prepared = adapter.prepareOptions(resolution.rawOptions, publicOptionContext)
      assertPreparedOptions(
        prepared,
        adapter,
        privateBinding.sourcePath,
        privateBinding.basePointer,
      )
    },
    allSensitiveValues,
    privateBinding.sourcePath,
    privateBinding.basePointer,
  )

  const resolved = {
    ...compiled,
    publicOptionContext,
  } as ResolvedRunBinding
  Object.defineProperties(resolved, {
    adapter: {
      configurable: false,
      enumerable: false,
      value: adapter,
      writable: false,
    },
    adapterOptions: {
      configurable: false,
      enumerable: false,
      value: resolution.rawOptions,
      writable: false,
    },
  })
  return Object.freeze(resolved)
}

import type {
  Capability,
  ContextIsolation,
  ExecutorAdapter,
  ExecutorDescriptorV2,
  JsonObject,
  JsonSchema,
  PreparedExecutorOptions,
  PublicOptionContext,
  RoleSpec,
  Sha256Digest,
} from '../core/types.ts'

export interface EnvironmentSecretRef {
  readonly $env: string
}

export interface RoleConfigEntry {
  readonly spec: string
  readonly promptFragments?: readonly string[]
  readonly executor: string
}

export interface AdapterExecutorProfileConfig {
  readonly mode: 'adapter'
  readonly adapter: string
  readonly options?: JsonObject
}

export interface HostExecutorProfileConfig {
  readonly mode: 'host'
  readonly executorId: string
  readonly transport: 'in-process' | 'remote'
  readonly capabilities: readonly Capability[]
  readonly requestedProvider?: string
  readonly requestedModel?: string
  readonly pathEnforcement: 'advisory' | 'host'
  readonly contextIsolation: ContextIsolation
}

export type ExecutorProfileConfig = AdapterExecutorProfileConfig | HostExecutorProfileConfig

export interface ExecutorProfileDigestInput {
  readonly schema: 'rolekit/executor-profile@1'
  readonly profileId: string
  readonly normalizedProfile: ExecutorProfileConfig
}

export interface RolekitConfig {
  readonly schema: 'rolekit/config@1'
  readonly extends?: readonly string[]
  readonly roles: Readonly<Record<string, RoleConfigEntry>>
  readonly executors: Readonly<Record<string, ExecutorProfileConfig>>
}

declare const adapterRegistrationHandleBrand: unique symbol

/** Opaque registration identity accepted by an AdapterRegistry. */
export interface AdapterRegistrationHandle {
  readonly id: string
  readonly [adapterRegistrationHandleBrand]: true
}

export interface AdapterRegistration<TConfig = JsonObject, TOptions = unknown>
  extends AdapterRegistrationHandle {
  readonly configOptionsSchema: JsonSchema<TConfig>
  readonly create: () => ExecutorAdapter<TOptions>
  readonly inspectConfig: (options: TConfig) => {
    readonly prepared: PreparedExecutorOptions<TOptions>
    readonly requiredSecrets: readonly string[]
  }
  readonly resolveExecutionOptions: (
    options: TConfig,
    environment: Readonly<Record<string, string | undefined>>,
  ) => {
    readonly rawOptions: unknown
    readonly publicOptionContext: PublicOptionContext
  }
}

declare const adapterRegistryBrand: unique symbol

/** Opaque exact-key registry. Registrations are callable only through validated compiler internals. */
export interface AdapterRegistry {
  readonly [adapterRegistryBrand]: true
}

export interface HostExecutorDescriptor {
  readonly schema: 'rolekit/host-executor-descriptor@1'
  readonly id: string
  readonly transport: 'in-process' | 'remote'
  readonly capabilities: readonly Capability[]
  readonly contextIsolation: ContextIsolation
  readonly pathEnforcement: 'advisory' | 'host'
}

export type CompiledTargetDescriptor = ExecutorDescriptorV2 | HostExecutorDescriptor

export interface LoadedRoleConfigEntry {
  readonly config: RoleConfigEntry
  readonly sourcePath: string
  readonly pointer: string
  readonly specPath: string
  readonly promptFragmentPaths: readonly string[]
}

export interface LoadedExecutorProfileEntry {
  readonly config: ExecutorProfileConfig
  readonly sourcePath: string
  readonly pointer: string
}

declare const loadedRolekitConfigBrand: unique symbol

/** Opaque loader handle with a credential-free enumerable snapshot. */
export interface LoadedRolekitConfig {
  readonly rootPath: string
  readonly sourcePaths: readonly string[]
  readonly config: RolekitConfig
  readonly roles: Readonly<Record<string, LoadedRoleConfigEntry>>
  readonly executors: Readonly<Record<string, LoadedExecutorProfileEntry>>
  readonly [loadedRolekitConfigBrand]: true
}

export interface CompiledExecutorProfileBase {
  readonly executorProfileId: string
  readonly executorId: string
  readonly profilePublicOptions: JsonObject
  readonly requiredSecrets: readonly string[]
  readonly profileDigest: Sha256Digest
}

type CompiledExecutorProfileData = CompiledExecutorProfileBase &
  (
    | {
        readonly profile: AdapterExecutorProfileConfig
        readonly capabilitySource: 'adapter-verified'
        readonly descriptor: ExecutorDescriptorV2
        readonly inspectionPreparedOptions: PreparedExecutorOptions
      }
    | {
        readonly profile: HostExecutorProfileConfig
        readonly capabilitySource: 'host-attested'
        readonly descriptor: HostExecutorDescriptor
      }
  )

declare const compiledExecutorProfileBrand: unique symbol

/** Opaque static profile inspection. Adapter runtime state remains non-enumerable. */
export type CompiledExecutorProfile = CompiledExecutorProfileData & {
  readonly [compiledExecutorProfileBrand]: true
}

export interface CompiledRoleBindingBase {
  readonly role: RoleSpec
  readonly roleSource: string
  readonly promptSources: readonly string[]
}

declare const compiledRoleBindingBrand: unique symbol

type CompiledRoleBindingData = CompiledRoleBindingBase & CompiledExecutorProfileData

/** Opaque compile result. Adapter-backed runtime resolution requires the original handle. */
export type CompiledRoleBinding = CompiledRoleBindingData & {
  readonly [compiledRoleBindingBrand]: true
}

export type ResolvedRunBinding = Extract<
  CompiledRoleBinding,
  { readonly capabilitySource: 'adapter-verified' }
> & {
  readonly adapter: ExecutorAdapter
  readonly adapterOptions: unknown
  readonly publicOptionContext: PublicOptionContext
}

export type RolekitConfigErrorCode =
  | 'capability_mismatch'
  | 'config_cycle'
  | 'duplicate_config'
  | 'duplicate_registration'
  | 'host_execution_required'
  | 'invalid_config'
  | 'missing_secret'
  | 'unknown_adapter'
  | 'unknown_executor_profile'
  | 'unknown_role'

export class RolekitConfigError extends Error {
  readonly code: RolekitConfigErrorCode
  readonly sourcePath?: string
  readonly pointer?: string

  constructor(
    code: RolekitConfigErrorCode,
    message: string,
    location: { readonly sourcePath?: string; readonly pointer?: string } = {},
  ) {
    const locationPrefix =
      location.sourcePath === undefined
        ? ''
        : `${location.sourcePath}${location.pointer === undefined ? '' : ` ${location.pointer}`}: `
    super(`${code}: ${locationPrefix}${message}`)
    this.name = 'RolekitConfigError'
    this.code = code
    if (location.sourcePath !== undefined) {
      this.sourcePath = location.sourcePath
    }
    if (location.pointer !== undefined) {
      this.pointer = location.pointer
    }
  }
}

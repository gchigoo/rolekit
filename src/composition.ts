import { CodexCliAdapter, type CodexCliAdapterOptions } from './adapters/codex/index.ts'
import { CursorCliAdapter, type CursorCliAdapterOptions } from './adapters/cursor/index.ts'
import { PiCliAdapter, type PiCliAdapterOptions } from './adapters/pi/index.ts'
import { PiRpcAdapter, type PiRpcAdapterOptions } from './adapters/pi-rpc/index.ts'
import {
  CodexAdapterConfigOptionsSchema,
  CursorAdapterConfigOptionsSchema,
  compileRoleBinding,
  createAdapterRegistry,
  defineAdapterRegistration,
  loadRolekitConfig,
  PiAdapterConfigOptionsSchema,
  PiRpcAdapterConfigOptionsSchema,
  resolveRunBinding,
} from './config/index.ts'
import type {
  AdapterRegistrationHandle,
  AdapterRegistry,
  CompiledRoleBinding,
} from './config/types.ts'
import { Rolekit } from './core/rolekit.ts'
import type { JsonObject, RunResultV2, TaskPacket } from './core/types.ts'

const builtInAdapterRegistrations = [
  defineAdapterRegistration<JsonObject, PiCliAdapterOptions>({
    id: 'pi',
    configOptionsSchema: PiAdapterConfigOptionsSchema,
    create: () => new PiCliAdapter(),
  }),
  defineAdapterRegistration<JsonObject, PiRpcAdapterOptions>({
    id: 'pi-rpc',
    configOptionsSchema: PiRpcAdapterConfigOptionsSchema,
    create: () => new PiRpcAdapter(),
  }),
  defineAdapterRegistration<JsonObject, CursorCliAdapterOptions>({
    id: 'cursor',
    configOptionsSchema: CursorAdapterConfigOptionsSchema,
    create: () => new CursorCliAdapter(),
  }),
  defineAdapterRegistration<JsonObject, CodexCliAdapterOptions>({
    id: 'codex',
    configOptionsSchema: CodexAdapterConfigOptionsSchema,
    create: () => new CodexCliAdapter(),
  }),
] as const

export const BUILT_IN_ADAPTER_REGISTRATIONS: readonly AdapterRegistrationHandle[] = Object.freeze(
  builtInAdapterRegistrations,
)

export function createBuiltInAdapterRegistry(): AdapterRegistry {
  return createAdapterRegistry(BUILT_IN_ADAPTER_REGISTRATIONS)
}

export interface ConfiguredRunInput {
  readonly configPath: string
  readonly roleId: string
  readonly executorProfileId?: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

export interface ConfiguredRunOptions {
  readonly cwd: string
  readonly runId?: string
  readonly signal?: AbortSignal
}

export interface ConfiguredRun {
  readonly binding: CompiledRoleBinding
  readonly executorProfileId: string
  readonly executorId: string
  readonly run: <TInput, TOutput>(
    task: TaskPacket<TInput>,
    options: ConfiguredRunOptions,
  ) => Promise<RunResultV2<TOutput>>
}

export async function createConfiguredRun(input: ConfiguredRunInput): Promise<ConfiguredRun> {
  const registry = createBuiltInAdapterRegistry()
  const loaded = await loadRolekitConfig(input.configPath)
  const binding = await compileRoleBinding(loaded, input.roleId, registry, input.executorProfileId)
  const runtime = await resolveRunBinding(binding, registry, input.environment)
  const rolekit = new Rolekit({ roles: [runtime.role], adapters: [runtime.adapter] })

  return Object.freeze({
    binding,
    executorProfileId: runtime.executorProfileId,
    executorId: runtime.executorId,
    run: <TInput, TOutput>(
      task: TaskPacket<TInput>,
      options: ConfiguredRunOptions,
    ): Promise<RunResultV2<TOutput>> =>
      rolekit.run<TInput, TOutput>(task, {
        executorId: runtime.executorId,
        cwd: options.cwd,
        adapterOptions: runtime.adapterOptions,
        publicOptionContext: runtime.publicOptionContext,
        profile: {
          id: runtime.executorProfileId,
          digest: runtime.profileDigest,
          requiredSecrets: runtime.requiredSecrets,
        },
        ...(options.runId === undefined ? {} : { runId: options.runId }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
  })
}

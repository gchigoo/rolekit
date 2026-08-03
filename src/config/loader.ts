import { readFile, realpath } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import { parseDocument } from 'yaml'

import { freezeJsonSnapshot } from '../core/json.ts'
import type { JsonSchema } from '../core/types.ts'
import { RolekitConfigSchema } from './schemas.ts'
import {
  type AdapterExecutorProfileConfig,
  type ExecutorProfileConfig,
  type LoadedExecutorProfileEntry,
  type LoadedRoleConfigEntry,
  type LoadedRolekitConfig,
  type RoleConfigEntry,
  type RolekitConfig,
  RolekitConfigError,
} from './types.ts'

const SUPPORTED_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])
const configAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
const validateConfig = configAjv.compile(RolekitConfigSchema as JsonSchema) as ValidateFunction

function pointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPointer(pointer: string, value: string): string {
  return `${pointer}/${pointerToken(value)}`
}

function validationPointer(error: ErrorObject): string {
  if (error.keyword === 'additionalProperties') {
    const property = error.params.additionalProperty
    if (typeof property === 'string') {
      return childPointer(error.instancePath, property)
    }
  }
  if (error.keyword === 'required') {
    const property = error.params.missingProperty
    if (typeof property === 'string') {
      return childPointer(error.instancePath, property)
    }
  }
  return error.instancePath.length === 0 ? '/' : error.instancePath
}

function configValidationError(
  sourcePath: string,
  errors: readonly ErrorObject[],
): RolekitConfigError {
  const formatted = errors.map((error) => {
    const pointer = validationPointer(error)
    return `${pointer} ${error.message ?? 'is invalid'}`
  })
  const first = errors[0]
  return new RolekitConfigError(
    'invalid_config',
    `Configuration is invalid: ${formatted.join('; ')}`,
    {
      sourcePath,
      pointer: first === undefined ? '/' : validationPointer(first),
    },
  )
}

function extensionFor(path: string): string {
  return extname(path).toLowerCase()
}

function sourceLocation(text: string, offset: number): string {
  const boundedOffset = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, boundedOffset)
  const lines = before.split('\n')
  return `line ${lines.length} column ${(lines.at(-1)?.length ?? 0) + 1}`
}

function numericErrorOffset(error: unknown): number | undefined {
  try {
    if (typeof error !== 'object' || error === null) {
      return undefined
    }
    const candidate = error as Readonly<Record<string, unknown>>
    if (typeof candidate.pos === 'number' && Number.isSafeInteger(candidate.pos)) {
      return candidate.pos
    }
    if (Array.isArray(candidate.pos)) {
      const first = candidate.pos[0]
      if (typeof first === 'number' && Number.isSafeInteger(first)) {
        return first
      }
    }
    if (error instanceof Error) {
      const match = /(?:position|offset)\s+(\d+)/u.exec(error.message)
      if (match?.[1] !== undefined) {
        return Number(match[1])
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function parseFailure(
  format: 'JSON' | 'YAML',
  path: string,
  text: string,
  error: unknown,
): RolekitConfigError {
  const offset = numericErrorOffset(error) ?? 0
  return new RolekitConfigError(
    'invalid_config',
    `${format} parse failed at ${sourceLocation(text, offset)} (offset ${offset}).`,
    { sourcePath: path, pointer: '/' },
  )
}

export async function readStructuredFile(path: string): Promise<unknown> {
  const extension = extensionFor(path)
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new RolekitConfigError(
      'invalid_config',
      `File extension "${extension || '<none>'}" is unsupported; expected .json, .yaml, or .yml.`,
      { sourcePath: path, pointer: '/' },
    )
  }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? ` (${error.code})`
        : ''
    throw new RolekitConfigError('invalid_config', `Unable to read file${code}.`, {
      sourcePath: path,
      pointer: '/',
    })
  }

  if (extension === '.json') {
    try {
      return JSON.parse(text) as unknown
    } catch (error: unknown) {
      throw parseFailure('JSON', path, text, error)
    }
  }

  const document = parseDocument(text, {
    prettyErrors: false,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    throw parseFailure('YAML', path, text, document.errors[0])
  }
  try {
    return document.toJS()
  } catch (error: unknown) {
    throw parseFailure('YAML', path, text, error)
  }
}

async function canonicalFilePath(
  requestedPath: string,
  location?: { readonly sourcePath: string; readonly pointer: string },
): Promise<string> {
  const absolutePath = resolve(requestedPath)
  if (!SUPPORTED_EXTENSIONS.has(extensionFor(absolutePath))) {
    throw new RolekitConfigError(
      'invalid_config',
      `Config path ${absolutePath} has an unsupported extension; expected .json, .yaml, or .yml.`,
      location ?? { sourcePath: absolutePath, pointer: '/' },
    )
  }
  try {
    return await realpath(absolutePath)
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? ` (${error.code})`
        : ''
    throw new RolekitConfigError(
      'invalid_config',
      `Unable to resolve declared config path ${absolutePath}${code}.`,
      location ?? { sourcePath: absolutePath, pointer: '/' },
    )
  }
}

function assertRolekitConfig(sourcePath: string, value: unknown): asserts value is RolekitConfig {
  if (!validateConfig(value)) {
    throw configValidationError(sourcePath, validateConfig.errors ?? [])
  }
}

interface LoadedRoleDeclaration {
  readonly id: string
  readonly entry: LoadedRoleConfigEntry
}

interface LoadedExecutorDeclaration {
  readonly id: string
  readonly entry: LoadedExecutorProfileEntry
}

interface MutableLoadState {
  readonly firstChains: Map<string, readonly string[]>
  readonly sourcePaths: string[]
  readonly roleDeclarations: LoadedRoleDeclaration[]
  readonly executorDeclarations: LoadedExecutorDeclaration[]
  readonly roles: Map<string, LoadedRoleConfigEntry>
  readonly executors: Map<string, LoadedExecutorProfileEntry>
}

export interface PrivateLoadedRolekitConfigState {
  readonly rootPath: string
  readonly sourcePaths: readonly string[]
  readonly roleDeclarations: readonly LoadedRoleDeclaration[]
  readonly executorDeclarations: readonly LoadedExecutorDeclaration[]
  readonly roles: ReadonlyMap<string, LoadedRoleConfigEntry>
  readonly executors: ReadonlyMap<string, LoadedExecutorProfileEntry>
}

const privateLoadedStates = new WeakMap<object, PrivateLoadedRolekitConfigState>()

/** @internal Compilation-only access to the opaque loader handle. */
export function privateLoadedRolekitConfigState(
  loaded: LoadedRolekitConfig,
): PrivateLoadedRolekitConfigState {
  const state =
    typeof loaded === 'object' && loaded !== null ? privateLoadedStates.get(loaded) : undefined
  if (state === undefined) {
    throw new RolekitConfigError(
      'invalid_config',
      'Loaded configuration is an opaque handle and cannot be cloned or reconstructed.',
    )
  }
  return state
}

function loadedRoleEntry(
  sourcePath: string,
  roleId: string,
  config: RoleConfigEntry,
): LoadedRoleConfigEntry {
  const sourceDirectory = dirname(sourcePath)
  return {
    config,
    sourcePath,
    pointer: `/roles/${pointerToken(roleId)}`,
    specPath: resolve(sourceDirectory, config.spec),
    promptFragmentPaths: (config.promptFragments ?? []).map((path) =>
      resolve(sourceDirectory, path),
    ),
  }
}

function loadedExecutorEntry(
  sourcePath: string,
  profileId: string,
  config: ExecutorProfileConfig,
): LoadedExecutorProfileEntry {
  return {
    config,
    sourcePath,
    pointer: `/executors/${pointerToken(profileId)}`,
  }
}

async function visitConfig(
  requestedPath: string,
  state: MutableLoadState,
  activeChain: readonly string[],
  declaration?: { readonly sourcePath: string; readonly pointer: string },
): Promise<string> {
  const canonicalPath = await canonicalFilePath(requestedPath, declaration)
  const activeIndex = activeChain.indexOf(canonicalPath)
  if (activeIndex >= 0) {
    const cycle = [...activeChain.slice(activeIndex), canonicalPath]
    throw new RolekitConfigError('config_cycle', `Extends cycle: ${cycle.join(' -> ')}`, {
      sourcePath: declaration?.sourcePath ?? canonicalPath,
      pointer: declaration?.pointer ?? '/extends',
    })
  }

  const currentChain = [...activeChain, canonicalPath]
  const firstChain = state.firstChains.get(canonicalPath)
  if (firstChain !== undefined) {
    throw new RolekitConfigError(
      'duplicate_config',
      `Duplicate canonical config path. First chain: ${firstChain.join(' -> ')}; duplicate chain: ${currentChain.join(' -> ')}`,
      {
        sourcePath: declaration?.sourcePath ?? canonicalPath,
        pointer: declaration?.pointer ?? '/extends',
      },
    )
  }
  state.firstChains.set(canonicalPath, currentChain)

  const parsed = await readStructuredFile(canonicalPath)
  assertRolekitConfig(canonicalPath, parsed)

  for (const [index, extendedPath] of (parsed.extends ?? []).entries()) {
    await visitConfig(resolve(dirname(canonicalPath), extendedPath), state, currentChain, {
      sourcePath: canonicalPath,
      pointer: `/extends/${index}`,
    })
  }

  for (const [roleId, role] of Object.entries(parsed.roles)) {
    const entry = loadedRoleEntry(canonicalPath, roleId, role)
    state.roleDeclarations.push({ id: roleId, entry })
    state.roles.set(roleId, entry)
  }
  for (const [profileId, profile] of Object.entries(parsed.executors)) {
    const entry = loadedExecutorEntry(canonicalPath, profileId, profile)
    state.executorDeclarations.push({ id: profileId, entry })
    state.executors.set(profileId, entry)
  }
  state.sourcePaths.push(canonicalPath)
  return canonicalPath
}

function publicExecutorConfig(config: ExecutorProfileConfig): ExecutorProfileConfig {
  if (config.mode === 'host') {
    return config
  }
  const publicConfig: AdapterExecutorProfileConfig = {
    mode: 'adapter',
    adapter: config.adapter,
  }
  return publicConfig
}

function publicExecutorEntry(entry: LoadedExecutorProfileEntry): LoadedExecutorProfileEntry {
  return {
    ...entry,
    config: publicExecutorConfig(entry.config),
  }
}

export async function loadRolekitConfig(path: string): Promise<LoadedRolekitConfig> {
  const state: MutableLoadState = {
    firstChains: new Map(),
    sourcePaths: [],
    roleDeclarations: [],
    executorDeclarations: [],
    roles: new Map(),
    executors: new Map(),
  }
  const rootPath = await visitConfig(path, state, [])
  const publicRoles = Object.fromEntries(state.roles)
  const publicExecutors = Object.fromEntries(
    [...state.executors].map(([id, entry]) => [id, publicExecutorEntry(entry)]),
  )
  const config: RolekitConfig = {
    schema: 'rolekit/config@1',
    roles: Object.fromEntries([...state.roles].map(([id, entry]) => [id, entry.config])),
    executors: Object.fromEntries(
      [...state.executors].map(([id, entry]) => [id, publicExecutorConfig(entry.config)]),
    ),
  }
  const publicSnapshot = freezeJsonSnapshot(
    {
      rootPath,
      sourcePaths: state.sourcePaths,
      config,
      roles: publicRoles,
      executors: publicExecutors,
    },
    'Public loaded RoleKit configuration',
  ) as unknown as LoadedRolekitConfig
  privateLoadedStates.set(publicSnapshot, {
    rootPath,
    sourcePaths: [...state.sourcePaths],
    roleDeclarations: [...state.roleDeclarations],
    executorDeclarations: [...state.executorDeclarations],
    roles: new Map(state.roles),
    executors: new Map(state.executors),
  })
  return publicSnapshot
}

import { win32 } from 'node:path'

import { freezeJsonSnapshot } from '../../core/json.ts'
import type {
  JsonObject,
  PreparedExecutorOptions,
  PublicOptionContext,
  PublicSecretMarker,
} from '../../core/types.ts'

export interface CommonCliProcessOptions {
  readonly command?: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly environment?: Readonly<Record<string, string>>
  readonly inheritAmbientEnvironment?: boolean
}

export interface CliEnvironmentControls {
  /** Credentials may come only from the declared per-run profile unless ambient inheritance is enabled. */
  readonly authenticationEnvironmentKeys?: readonly string[]
  /** Isolation/config-home controls cannot be profile-overridden or ambiently copied in safe mode. */
  readonly configHomeEnvironmentKeys?: readonly string[]
  /** Additional non-sensitive profile keys explicitly declared safe by an adapter. */
  readonly profileEnvironmentKeys?: readonly string[]
}

export interface PreparedCliEnvironment {
  readonly environment: Readonly<Record<string, string>>
  readonly sensitiveValues: readonly string[]
}

export interface PrepareCliEnvironmentOptions {
  readonly inheritAmbientEnvironment?: boolean
  readonly overrides?: Readonly<Record<string, string>>
}

const COMMON_OPTION_KEYS = [
  'command',
  'timeoutMs',
  'maxOutputBytes',
  'environment',
  'inheritAmbientEnvironment',
] as const

const PORTABLE_ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u

const EXPLICIT_LOCALE_KEYS = [
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_ADDRESS',
  'LC_COLLATE',
  'LC_CTYPE',
  'LC_IDENTIFICATION',
  'LC_MEASUREMENT',
  'LC_MESSAGES',
  'LC_MONETARY',
  'LC_NAME',
  'LC_NUMERIC',
  'LC_PAPER',
  'LC_TELEPHONE',
  'LC_TIME',
] as const

const COMMON_BASELINE_KEYS = [
  ...EXPLICIT_LOCALE_KEYS,
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
] as const

const POSIX_BASELINE_KEYS = ['PATH', 'TMPDIR', 'HOME', 'USER', 'LOGNAME'] as const
const WINDOWS_BASELINE_KEYS = [
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
] as const

const BUILT_IN_ISOLATION_KEYS = ['CODEX_HOME', 'PI_CODING_AGENT_DIR'] as const

const PROCESS_CONTROL_KEYS = new Set([
  'ASAN_OPTIONS',
  'AWS_CA_BUNDLE',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AZURE_CONFIG_DIR',
  'BASH_ENV',
  'BASHOPTS',
  'BUNDLE_GEMFILE',
  'CDPATH',
  'CLASSPATH',
  'CURL_CA_BUNDLE',
  'DOTNET_ADDITIONAL_DEPS',
  'DOCKER_CONFIG',
  'DOTNET_STARTUP_HOOKS',
  'ENV',
  'GCONV_PATH',
  'GEM_HOME',
  'GEM_PATH',
  'GNUPGHOME',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'EDITOR',
  'GIT_ASKPASS',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_EXEC_PATH',
  'GIT_PAGER',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'IFS',
  'JAVA_HOME',
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'KUBECONFIG',
  'KSH_ENV',
  'LESSCLOSE',
  'LESSOPEN',
  'LOCPATH',
  'LSAN_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NLSPATH',
  'NPM_CONFIG_GLOBALCONFIG',
  'NPM_CONFIG_NODE_OPTIONS',
  'NPM_CONFIG_PREFIX',
  'NPM_CONFIG_USERCONFIG',
  'PAGER',
  'PERL5LIB',
  'PSMODULEPATH',
  'PERL5OPT',
  'PERLLIB',
  'PROMPT_COMMAND',
  'PS4',
  'PYTHONBREAKPOINT',
  'PYTHONHOME',
  'PYTHONINSPECT',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONUSERBASE',
  'REQUESTS_CA_BUNDLE',
  'RUBYLIB',
  'RUBYOPT',
  'SHELL',
  'SHELLOPTS',
  'SSH_ASKPASS',
  'SSH_AUTH_SOCK',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SSLKEYLOGFILE',
  'TSAN_OPTIONS',
  'UBSAN_OPTIONS',
  'VISUAL',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'ZDOTDIR',
  '_JAVA_OPTIONS',
])

const PROCESS_CONTROL_PREFIXES = ['DYLD_', 'GIT_', 'LD_', 'MALLOC_', 'NPM_CONFIG_'] as const

export function isOptionRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readOptionRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) {
    return {}
  }
  if (!isOptionRecord(value)) {
    throw new TypeError('Adapter options must be an object.')
  }
  return value
}

export function assertSupportedOptionKeys(
  value: Readonly<Record<string, unknown>>,
  adapterKeys: readonly string[],
): void {
  const supportedKeys = new Set<string>([...COMMON_OPTION_KEYS, ...adapterKeys])
  const unsupportedKeys = Object.keys(value)
    .filter((key) => !supportedKeys.has(key))
    .sort()
  if (unsupportedKeys.length > 0) {
    throw new TypeError(`Unsupported adapter options: ${unsupportedKeys.join(', ')}.`)
  }
}

export function optionalStringOption(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new TypeError(`Adapter option "${key}" must be a non-empty string.`)
  }
  return candidate
}

export function optionalBooleanOption(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (typeof candidate !== 'boolean') {
    throw new TypeError(`Adapter option "${key}" must be a boolean.`)
  }
  return candidate
}

export function optionalStringArrayOption(
  value: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (
    !Array.isArray(candidate) ||
    candidate.some((entry) => typeof entry !== 'string' || entry.length === 0) ||
    new Set(candidate).size !== candidate.length
  ) {
    throw new TypeError(`Adapter option "${key}" must be an array of unique non-empty strings.`)
  }
  return [...candidate]
}

export function optionalEnumOption<TValue extends string>(
  value: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly TValue[],
): TValue | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (typeof candidate !== 'string' || !allowed.includes(candidate as TValue)) {
    throw new TypeError(`Adapter option "${key}" must be one of: ${allowed.join(', ')}.`)
  }
  return candidate as TValue
}

function positiveSafeIntegerOption(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const candidate = value[key]
  if (candidate === undefined) {
    return undefined
  }
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`Adapter option "${key}" must be a positive safe integer.`)
  }
  return candidate
}

function assertPortableEnvironmentKey(key: string, source: string): void {
  if (!PORTABLE_ENVIRONMENT_KEY.test(key)) {
    throw new TypeError(`${source} environment key "${key}" is not portable.`)
  }
}

interface EnvironmentControlCategories {
  readonly authentication: ReadonlyMap<string, string>
  readonly configHome: ReadonlyMap<string, string>
  readonly profile: ReadonlyMap<string, string>
}

function environmentKeyMap(keys: readonly string[], source: string): ReadonlyMap<string, string> {
  const mapped = new Map<string, string>()
  for (const key of keys) {
    assertPortableEnvironmentKey(key, source)
    const normalized = key.toUpperCase()
    if (mapped.has(normalized)) {
      throw new TypeError(`${source} environment key "${key}" is duplicated.`)
    }
    mapped.set(normalized, key)
  }
  return mapped
}

function controlledEnvironmentKeys(controls: CliEnvironmentControls): EnvironmentControlCategories {
  return {
    authentication: environmentKeyMap(
      controls.authenticationEnvironmentKeys ?? [],
      'Adapter authentication',
    ),
    configHome: environmentKeyMap(controls.configHomeEnvironmentKeys ?? [], 'Adapter config-home'),
    profile: environmentKeyMap(controls.profileEnvironmentKeys ?? [], 'Adapter profile'),
  }
}

const STATICALLY_RESERVED_ENVIRONMENT_KEYS = new Set(
  [
    'PATH',
    'PATHEXT',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    ...BUILT_IN_ISOLATION_KEYS,
  ].map((key) => key.toUpperCase()),
)

function isProcessControlEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase()
  return (
    STATICALLY_RESERVED_ENVIRONMENT_KEYS.has(normalized) ||
    PROCESS_CONTROL_KEYS.has(normalized) ||
    PROCESS_CONTROL_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  )
}

function validateEnvironmentProfile(
  value: unknown,
  controls: CliEnvironmentControls = {},
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isOptionRecord(value)) {
    throw new TypeError('Adapter option "environment" must map names to strings.')
  }

  const categories = controlledEnvironmentKeys(controls)
  const environment = Object.create(null) as Record<string, string>
  for (const [key, entry] of Object.entries(value)) {
    if (!PORTABLE_ENVIRONMENT_KEY.test(key) || typeof entry !== 'string') {
      throw new TypeError('Adapter option "environment" must map portable names to strings.')
    }
    const normalized = key.toUpperCase()
    if (categories.configHome.has(normalized) || isProcessControlEnvironmentKey(normalized)) {
      throw new TypeError(
        `Adapter environment key "${key}" is reserved for RoleKit process control or adapter isolation.`,
      )
    }

    const authenticationKey = categories.authentication.get(normalized)
    const declaredProfileKey = categories.profile.get(normalized)
    if (
      authenticationKey === undefined &&
      declaredProfileKey === undefined &&
      !normalized.startsWith('ROLEKIT_')
    ) {
      throw new TypeError(
        `Adapter environment key "${key}" is not allowed by the safe profile allowlist or declared adapter controls.`,
      )
    }
    environment[authenticationKey ?? declaredProfileKey ?? key] = entry
  }
  return environment
}

export function parseCommonCliProcessOptions(
  value: Readonly<Record<string, unknown>>,
  controls: CliEnvironmentControls = {},
): CommonCliProcessOptions {
  const command = optionalStringOption(value, 'command')
  const timeoutMs = positiveSafeIntegerOption(value, 'timeoutMs')
  const maxOutputBytes = positiveSafeIntegerOption(value, 'maxOutputBytes')
  const environment = validateEnvironmentProfile(value.environment, controls)
  const inheritAmbientEnvironment = optionalBooleanOption(value, 'inheritAmbientEnvironment')
  return {
    ...(command === undefined ? {} : { command }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
    ...(environment === undefined ? {} : { environment }),
    ...(inheritAmbientEnvironment === undefined ? {} : { inheritAmbientEnvironment }),
  }
}

function decodeJsonPointerToken(token: string): string {
  if (/~(?:[^01]|$)/u.test(token)) {
    throw new TypeError(`Invalid JSON Pointer token "${token}".`)
  }
  return token.replace(/~1/gu, '/').replace(/~0/gu, '~')
}

function publicSecretMarker(
  value: unknown,
  pointer: string,
  sensitiveValues: readonly string[],
): PublicSecretMarker {
  if (!isOptionRecord(value) || value.redacted !== true) {
    throw new TypeError(`Public option replacement "${pointer}" must be a redacted marker.`)
  }
  const keys = Object.keys(value).sort()
  let marker: PublicSecretMarker
  if (value.source === 'literal' && keys.length === 2 && keys[0] === 'redacted') {
    marker = { source: 'literal', redacted: true }
  } else if (
    value.source === 'env' &&
    keys.length === 3 &&
    keys[0] === 'name' &&
    keys[1] === 'redacted' &&
    keys[2] === 'source' &&
    typeof value.name === 'string' &&
    value.name.length > 0
  ) {
    marker = { source: 'env', name: value.name, redacted: true }
  } else {
    throw new TypeError(`Public option replacement "${pointer}" is not a valid secret marker.`)
  }

  const secrets = [...new Set(sensitiveValues)].filter((entry) => entry.length > 0)
  if (
    Object.entries(marker).some(([key, entry]) =>
      secrets.some(
        (secret) => key.includes(secret) || (typeof entry === 'string' && entry.includes(secret)),
      ),
    )
  ) {
    throw new TypeError(
      `Public option replacement "${pointer}" marker contains a configured sensitive literal.`,
    )
  }
  return marker
}

function publicEnvironmentSnapshot(
  environment: Readonly<Record<string, string>> | undefined,
  publicContext: PublicOptionContext | undefined,
): Readonly<Record<string, PublicSecretMarker>> | undefined {
  const replacements = publicContext?.replacementsByJsonPointer ?? {}
  if (!isOptionRecord(replacements)) {
    throw new TypeError('Public option replacements must be an object keyed by JSON Pointer.')
  }

  const markers = Object.create(null) as Record<string, PublicSecretMarker>
  const sensitiveValues = Object.values(environment ?? {})
  for (const key of Object.keys(environment ?? {})) {
    markers[key] = { source: 'literal', redacted: true }
  }
  for (const [pointer, markerValue] of Object.entries(replacements)) {
    const tokens = pointer.split('/')
    if (tokens[0] !== '' || tokens.length !== 3 || tokens[1] !== 'environment') {
      throw new TypeError(
        `Public option replacement pointer "${pointer}" does not target a declared sensitive field.`,
      )
    }
    const key = decodeJsonPointerToken(tokens[2] ?? '')
    if (environment?.[key] === undefined) {
      throw new TypeError(
        `Public option replacement pointer "${pointer}" does not target a configured environment value.`,
      )
    }
    markers[key] = publicSecretMarker(markerValue, pointer, sensitiveValues)
  }
  return environment === undefined ? undefined : markers
}

export function prepareExecutorOptions<TOptions extends CommonCliProcessOptions>(
  executionOptions: TOptions,
  publicContext?: PublicOptionContext,
  requested?: { readonly provider?: string; readonly model?: string },
): PreparedExecutorOptions<TOptions> {
  const publicEnvironment = publicEnvironmentSnapshot(executionOptions.environment, publicContext)
  const publicOptions = {
    ...executionOptions,
    ...(publicEnvironment === undefined ? {} : { environment: publicEnvironment }),
  }
  const sensitiveValues = [...new Set(Object.values(executionOptions.environment ?? {}))]
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
  return freezeJsonSnapshot(
    {
      executionOptions,
      publicOptions,
      sensitiveValues,
      ...(requested?.provider === undefined ? {} : { requestedProvider: requested.provider }),
      ...(requested?.model === undefined ? {} : { requestedModel: requested.model }),
    },
    'Prepared executor options',
  ) as unknown as PreparedExecutorOptions<TOptions>
}

function copyEnvironmentKey(target: Record<string, string>, key: string): void {
  const value = process.env[key]
  if (value !== undefined) {
    target[key] = value
  }
}

function copyWindowsEnvironmentKey(
  target: Record<string, string>,
  targetKey: string,
  aliases: readonly string[] = [targetKey],
): void {
  for (const key of aliases) {
    const value = process.env[key]
    if (value !== undefined) {
      target[targetKey] = value
      return
    }
  }
}

function isSensitiveEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase()
  return (
    normalized.includes('API_KEY') ||
    normalized === 'TOKEN' ||
    normalized.endsWith('_TOKEN') ||
    normalized === 'SECRET' ||
    normalized.endsWith('_SECRET') ||
    normalized === 'PASSWORD' ||
    normalized.endsWith('_PASSWORD') ||
    normalized.includes('CREDENTIAL') ||
    normalized === 'AUTHORIZATION'
  )
}

/**
 * Builds the complete executor environment. Ambient inheritance is disabled by
 * default; enabling it is an explicit insecure option. Adapter-owned overrides
 * are applied last so isolation homes cannot be replaced by caller options.
 */
export function prepareCliEnvironment(
  profileValue: Readonly<Record<string, string>> | undefined,
  controls: CliEnvironmentControls = {},
  options: PrepareCliEnvironmentOptions = {},
): PreparedCliEnvironment {
  controlledEnvironmentKeys(controls)
  const profile = validateEnvironmentProfile(profileValue, controls)
  const environment = Object.create(null) as Record<string, string>

  if (options.inheritAmbientEnvironment === true) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        environment[key] = value
      }
    }
  } else {
    for (const key of COMMON_BASELINE_KEYS) {
      copyEnvironmentKey(environment, key)
    }
    if (process.platform === 'win32') {
      copyWindowsEnvironmentKey(environment, 'Path', ['Path', 'PATH'])
      copyWindowsEnvironmentKey(environment, 'SystemRoot', ['SystemRoot', 'SYSTEMROOT'])
      copyWindowsEnvironmentKey(environment, 'ComSpec', ['ComSpec', 'COMSPEC'])
      for (const key of WINDOWS_BASELINE_KEYS) {
        if (key !== 'Path' && key !== 'SystemRoot' && key !== 'ComSpec') {
          copyWindowsEnvironmentKey(environment, key)
        }
      }
    } else {
      for (const key of POSIX_BASELINE_KEYS) {
        copyEnvironmentKey(environment, key)
      }
    }
  }

  Object.assign(environment, profile, options.overrides)

  const authenticationKeys = new Set(
    (controls.authenticationEnvironmentKeys ?? []).map((key) => key.toUpperCase()),
  )
  const sensitiveValues = Object.entries(environment)
    .filter(
      ([key, value]) =>
        value.length > 0 &&
        (authenticationKeys.has(key.toUpperCase()) || isSensitiveEnvironmentKey(key)),
    )
    .map(([, value]) => value)

  return {
    environment,
    sensitiveValues: [...new Set(sensitiveValues)].sort(
      (left, right) => right.length - left.length,
    ),
  }
}

export function isolatedUserEnvironment(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): Readonly<Record<string, string>> {
  const normalizedDirectory = platform === 'win32' ? win32.normalize(directory) : directory
  const environment: Record<string, string> = {
    HOME: normalizedDirectory,
    USERPROFILE: normalizedDirectory,
    APPDATA: normalizedDirectory,
    LOCALAPPDATA: normalizedDirectory,
  }
  if (platform === 'win32') {
    const root = win32.parse(normalizedDirectory).root
    const homeDrive = root.replace(/[\\/]$/u, '')
    environment.HOMEDRIVE = homeDrive
    environment.HOMEPATH = normalizedDirectory.slice(homeDrive.length) || '\\'
  }
  return environment
}

export function commonPublicOptions(options: CommonCliProcessOptions): JsonObject {
  return options as JsonObject
}

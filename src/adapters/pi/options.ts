import type { Capability, PreparedExecutorOptions, PublicOptionContext } from '../../core/types.ts'
import {
  assertSupportedOptionKeys,
  type CommonCliProcessOptions,
  optionalBooleanOption,
  optionalEnumOption,
  optionalStringArrayOption,
  optionalStringOption,
  parseCommonCliProcessOptions,
  prepareExecutorOptions,
  readOptionRecord,
} from '../cli/options.ts'

export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number]

export interface PiCliAdapterOptions extends CommonCliProcessOptions {
  readonly provider?: string
  readonly model?: string
  readonly thinking?: PiThinkingLevel
  readonly tools?: readonly string[]
  readonly excludeTools?: readonly string[]
  readonly extensions?: readonly string[]
  readonly skills?: readonly string[]
  readonly promptTemplates?: readonly string[]
  readonly inheritContextFiles?: boolean
  readonly inheritUserAgentDirectory?: boolean
  readonly discoverProjectResources?: boolean
  readonly offline?: boolean
}

export const PI_AUTHENTICATION_ENVIRONMENT_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'XAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const

export const PI_TOOL_CAPABILITIES: Readonly<Record<string, Capability>> = {
  read: 'repository.read',
  grep: 'repository.read',
  find: 'repository.read',
  ls: 'repository.read',
  edit: 'repository.write',
  write: 'repository.write',
  bash: 'shell',
}

const PI_OPTION_KEYS = [
  'provider',
  'model',
  'thinking',
  'tools',
  'excludeTools',
  'extensions',
  'skills',
  'promptTemplates',
  'inheritContextFiles',
  'inheritUserAgentDirectory',
  'discoverProjectResources',
  'offline',
] as const

function validateKnownTools(tools: readonly string[] | undefined, key: string): void {
  const unknown = tools?.filter((tool) => PI_TOOL_CAPABILITIES[tool] === undefined) ?? []
  if (unknown.length > 0) {
    throw new TypeError(`Adapter option "${key}" contains unknown Pi tools: ${unknown.join(', ')}.`)
  }
}

export function parsePiCliAdapterOptions(value: unknown): PiCliAdapterOptions {
  const record = readOptionRecord(value)
  assertSupportedOptionKeys(record, PI_OPTION_KEYS)
  const common = parseCommonCliProcessOptions(record, {
    authenticationEnvironmentKeys: PI_AUTHENTICATION_ENVIRONMENT_KEYS,
    configHomeEnvironmentKeys: ['PI_CODING_AGENT_DIR'],
  })
  const provider = optionalStringOption(record, 'provider')
  const model = optionalStringOption(record, 'model')
  const thinking = optionalEnumOption(record, 'thinking', PI_THINKING_LEVELS)
  const tools = optionalStringArrayOption(record, 'tools')
  const excludeTools = optionalStringArrayOption(record, 'excludeTools')
  const extensions = optionalStringArrayOption(record, 'extensions')
  const skills = optionalStringArrayOption(record, 'skills')
  const promptTemplates = optionalStringArrayOption(record, 'promptTemplates')
  const inheritContextFiles = optionalBooleanOption(record, 'inheritContextFiles')
  const inheritUserAgentDirectory = optionalBooleanOption(record, 'inheritUserAgentDirectory')
  const discoverProjectResources = optionalBooleanOption(record, 'discoverProjectResources')
  const offline = optionalBooleanOption(record, 'offline')

  validateKnownTools(tools, 'tools')
  validateKnownTools(excludeTools, 'excludeTools')
  if (
    discoverProjectResources === true &&
    [extensions, skills, promptTemplates].some((paths) => (paths?.length ?? 0) > 0)
  ) {
    throw new TypeError(
      'Pi option "discoverProjectResources" cannot be combined with exact extensions, skills, or promptTemplates paths.',
    )
  }

  return {
    ...common,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(tools === undefined ? {} : { tools }),
    ...(excludeTools === undefined ? {} : { excludeTools }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(skills === undefined ? {} : { skills }),
    ...(promptTemplates === undefined ? {} : { promptTemplates }),
    ...(inheritContextFiles === undefined ? {} : { inheritContextFiles }),
    ...(inheritUserAgentDirectory === undefined ? {} : { inheritUserAgentDirectory }),
    ...(discoverProjectResources === undefined ? {} : { discoverProjectResources }),
    ...(offline === undefined ? {} : { offline }),
  }
}

export function preparePiCliAdapterOptions(
  value: unknown,
  publicContext?: PublicOptionContext,
): PreparedExecutorOptions<PiCliAdapterOptions> {
  const options = parsePiCliAdapterOptions(value)
  return prepareExecutorOptions(options, publicContext, {
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
  })
}

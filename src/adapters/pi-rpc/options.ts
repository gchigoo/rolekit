import type { PreparedExecutorOptions, PublicOptionContext } from '../../core/types.ts'
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
import {
  PI_AUTHENTICATION_ENVIRONMENT_KEYS,
  PI_THINKING_LEVELS,
  PI_TOOL_CAPABILITIES,
  type PiThinkingLevel,
} from '../pi/options.ts'

export interface PiRpcAdapterOptions extends CommonCliProcessOptions {
  readonly provider?: string
  readonly model?: string
  readonly thinking?: PiThinkingLevel
  readonly tools?: readonly string[]
  readonly extensions?: readonly string[]
  readonly skills?: readonly string[]
  readonly promptTemplates?: readonly string[]
  readonly inheritContextFiles?: boolean
  readonly inheritUserAgentDirectory?: boolean
  readonly discoverProjectResources?: boolean
  readonly offline?: boolean
}

const PI_RPC_OPTION_KEYS = [
  'provider',
  'model',
  'thinking',
  'tools',
  'extensions',
  'skills',
  'promptTemplates',
  'inheritContextFiles',
  'inheritUserAgentDirectory',
  'discoverProjectResources',
  'offline',
] as const

function validateKnownTools(tools: readonly string[] | undefined): void {
  const unknown = tools?.filter((tool) => PI_TOOL_CAPABILITIES[tool] === undefined) ?? []
  if (unknown.length > 0) {
    throw new TypeError(`Adapter option "tools" contains unknown Pi tools: ${unknown.join(', ')}.`)
  }
}

export function parsePiRpcAdapterOptions(value: unknown): PiRpcAdapterOptions {
  const record = readOptionRecord(value)
  assertSupportedOptionKeys(record, PI_RPC_OPTION_KEYS)
  const common = parseCommonCliProcessOptions(record, {
    authenticationEnvironmentKeys: PI_AUTHENTICATION_ENVIRONMENT_KEYS,
    configHomeEnvironmentKeys: ['PI_CODING_AGENT_DIR'],
  })
  const provider = optionalStringOption(record, 'provider')
  const model = optionalStringOption(record, 'model')
  const thinking = optionalEnumOption(record, 'thinking', PI_THINKING_LEVELS)
  const tools = optionalStringArrayOption(record, 'tools')
  const extensions = optionalStringArrayOption(record, 'extensions')
  const skills = optionalStringArrayOption(record, 'skills')
  const promptTemplates = optionalStringArrayOption(record, 'promptTemplates')
  const inheritContextFiles = optionalBooleanOption(record, 'inheritContextFiles')
  const inheritUserAgentDirectory = optionalBooleanOption(record, 'inheritUserAgentDirectory')
  const discoverProjectResources = optionalBooleanOption(record, 'discoverProjectResources')
  const offline = optionalBooleanOption(record, 'offline')

  validateKnownTools(tools)
  if (
    discoverProjectResources === true &&
    [extensions, skills, promptTemplates].some((paths) => (paths?.length ?? 0) > 0)
  ) {
    throw new TypeError(
      'Pi RPC option "discoverProjectResources" cannot be combined with exact extensions, skills, or promptTemplates paths.',
    )
  }

  return {
    ...common,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(tools === undefined ? {} : { tools }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(skills === undefined ? {} : { skills }),
    ...(promptTemplates === undefined ? {} : { promptTemplates }),
    ...(inheritContextFiles === undefined ? {} : { inheritContextFiles }),
    ...(inheritUserAgentDirectory === undefined ? {} : { inheritUserAgentDirectory }),
    ...(discoverProjectResources === undefined ? {} : { discoverProjectResources }),
    ...(offline === undefined ? {} : { offline }),
  }
}

export function preparePiRpcAdapterOptions(
  value: unknown,
  publicContext?: PublicOptionContext,
): PreparedExecutorOptions<PiRpcAdapterOptions> {
  const options = parsePiRpcAdapterOptions(value)
  return prepareExecutorOptions(options, publicContext, {
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
  })
}

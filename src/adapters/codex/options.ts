import type { PreparedExecutorOptions, PublicOptionContext } from '../../core/types.ts'
import {
  assertSupportedOptionKeys,
  type CommonCliProcessOptions,
  optionalBooleanOption,
  optionalEnumOption,
  optionalStringOption,
  parseCommonCliProcessOptions,
  prepareExecutorOptions,
  readOptionRecord,
} from '../cli/options.ts'

export const CODEX_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

export interface CodexCliAdapterOptions extends CommonCliProcessOptions {
  readonly model?: string
  readonly profile?: string
  readonly reasoningEffort?: CodexReasoningEffort
  readonly webSearch?: boolean
  readonly inheritUserConfig?: boolean
  readonly inheritProjectInstructions?: boolean
  readonly inheritExecPolicyRules?: boolean
}

export const CODEX_AUTHENTICATION_ENVIRONMENT_KEYS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'AZURE_OPENAI_API_KEY',
] as const

const CODEX_OPTION_KEYS = [
  'model',
  'profile',
  'reasoningEffort',
  'webSearch',
  'inheritUserConfig',
  'inheritProjectInstructions',
  'inheritExecPolicyRules',
] as const

export function parseCodexCliAdapterOptions(value: unknown): CodexCliAdapterOptions {
  const record = readOptionRecord(value)
  assertSupportedOptionKeys(record, CODEX_OPTION_KEYS)
  const common = parseCommonCliProcessOptions(record, {
    authenticationEnvironmentKeys: CODEX_AUTHENTICATION_ENVIRONMENT_KEYS,
    configHomeEnvironmentKeys: ['CODEX_HOME'],
  })
  const model = optionalStringOption(record, 'model')
  const profile = optionalStringOption(record, 'profile')
  const reasoningEffort = optionalEnumOption(record, 'reasoningEffort', CODEX_REASONING_EFFORTS)
  const webSearch = optionalBooleanOption(record, 'webSearch')
  const inheritUserConfig = optionalBooleanOption(record, 'inheritUserConfig')
  const inheritProjectInstructions = optionalBooleanOption(record, 'inheritProjectInstructions')
  const inheritExecPolicyRules = optionalBooleanOption(record, 'inheritExecPolicyRules')

  if (profile !== undefined && inheritUserConfig !== true) {
    throw new TypeError(
      'Codex option "profile" requires "inheritUserConfig: true" because profiles are loaded from user config.',
    )
  }

  return {
    ...common,
    ...(model === undefined ? {} : { model }),
    ...(profile === undefined ? {} : { profile }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(webSearch === undefined ? {} : { webSearch }),
    ...(inheritUserConfig === undefined ? {} : { inheritUserConfig }),
    ...(inheritProjectInstructions === undefined ? {} : { inheritProjectInstructions }),
    ...(inheritExecPolicyRules === undefined ? {} : { inheritExecPolicyRules }),
  }
}

export function prepareCodexCliAdapterOptions(
  value: unknown,
  publicContext?: PublicOptionContext,
): PreparedExecutorOptions<CodexCliAdapterOptions> {
  const options = parseCodexCliAdapterOptions(value)
  return prepareExecutorOptions(options, publicContext, {
    ...(options.model === undefined ? {} : { model: options.model }),
  })
}

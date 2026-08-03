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

export const CURSOR_SANDBOX_MODES = ['enabled', 'disabled'] as const

export type CursorSandboxMode = (typeof CURSOR_SANDBOX_MODES)[number]

export interface CursorCliAdapterOptions extends CommonCliProcessOptions {
  readonly model?: string
  readonly sandbox?: CursorSandboxMode
  readonly approveMcps?: boolean
}

export const CURSOR_AUTHENTICATION_ENVIRONMENT_KEYS = ['CURSOR_API_KEY'] as const

const CURSOR_OPTION_KEYS = ['model', 'sandbox', 'approveMcps'] as const

export function parseCursorCliAdapterOptions(value: unknown): CursorCliAdapterOptions {
  const record = readOptionRecord(value)
  assertSupportedOptionKeys(record, CURSOR_OPTION_KEYS)
  const common = parseCommonCliProcessOptions(record, {
    authenticationEnvironmentKeys: CURSOR_AUTHENTICATION_ENVIRONMENT_KEYS,
  })
  const model = optionalStringOption(record, 'model')
  const sandbox = optionalEnumOption(record, 'sandbox', CURSOR_SANDBOX_MODES)
  const approveMcps = optionalBooleanOption(record, 'approveMcps')
  return {
    ...common,
    ...(model === undefined ? {} : { model }),
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(approveMcps === undefined ? {} : { approveMcps }),
  }
}

export function prepareCursorCliAdapterOptions(
  value: unknown,
  publicContext?: PublicOptionContext,
): PreparedExecutorOptions<CursorCliAdapterOptions> {
  const options = parseCursorCliAdapterOptions(value)
  return prepareExecutorOptions(options, publicContext, {
    ...(options.model === undefined ? {} : { model: options.model }),
  })
}

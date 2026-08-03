export { CliAdapterBase } from './base.ts'
export {
  CliAbortedError,
  CliAdapterError,
  CliAuthenticationError,
  CliConfigurationError,
  type CliExecutionError,
  CliExitError,
  CliIoError,
  CliOutputLimitError,
  CliProtocolError,
  CliSpawnError,
  CliTimeoutError,
  isCliExecutionError,
} from './errors.ts'
export type {
  CliEnvironmentControls,
  CommonCliProcessOptions,
  PrepareCliEnvironmentOptions,
  PreparedCliEnvironment,
} from './options.ts'
export {
  assertSupportedOptionKeys,
  optionalBooleanOption,
  optionalEnumOption,
  optionalStringArrayOption,
  optionalStringOption,
  parseCommonCliProcessOptions,
  prepareCliEnvironment,
  prepareExecutorOptions,
  readOptionRecord,
} from './options.ts'
export type {
  CliProcessOptions,
  CliProcessResult,
  ResolvedExecutable,
} from './process.ts'
export { ExecutableNotFoundError, resolveExecutable, runCliProcess } from './process.ts'
export type { RedactionContext } from './redaction.ts'
export {
  redactCommand,
  redactionContextForArgs,
  redactText,
} from './redaction.ts'
export { terminateProcessTree } from './termination.ts'
export type {
  CliCompatibilityReport,
  CreateCliCompatibilityReportInput,
  ParsedCliVersion,
} from './version.ts'
export {
  cliVersionAtLeast,
  createCliCompatibilityReport,
  parseCliVersion,
} from './version.ts'

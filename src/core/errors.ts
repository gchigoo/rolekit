import type { JsonObject } from './types.ts'

export type RolekitErrorCode =
  | 'duplicate_adapter'
  | 'duplicate_role'
  | 'duplicate_run'
  | 'invalid_contract'
  | 'invalid_schema'
  | 'unknown_adapter'
  | 'unknown_role'
  | 'unsupported_output_schema'

export class RolekitError extends Error {
  readonly code: RolekitErrorCode
  readonly details?: JsonObject

  constructor(code: RolekitErrorCode, message: string, details?: JsonObject) {
    super(message)
    this.name = 'RolekitError'
    this.code = code
    if (details !== undefined) {
      this.details = details
    }
  }
}

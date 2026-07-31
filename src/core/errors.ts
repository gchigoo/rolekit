import type { JsonObject } from './types.ts'

export type RolekitErrorCode =
  | 'duplicate_adapter'
  | 'duplicate_role'
  | 'invalid_contract'
  | 'invalid_schema'
  | 'unknown_adapter'
  | 'unknown_role'

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

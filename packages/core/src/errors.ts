import type { ValidationIssue } from './types.ts'

/**
 * Base error for RoleKit runtime failures.
 */
export class RolekitError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'RolekitError'
    this.code = code
  }
}

/**
 * Thrown when schema (structural or semantic) validation fails.
 */
export class SchemaValidationError extends RolekitError {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[], message = 'Schema validation failed') {
    super(message, 'validation_error')
    this.name = 'SchemaValidationError'
    this.issues = issues
  }
}

import { Ajv2020, type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { RolekitError } from './errors.ts'
import type { JsonSchema } from './types.ts'

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
})

const validators = new WeakMap<object, ValidateFunction>()

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

function formatError(error: ErrorObject): string {
  const path = error.instancePath.length > 0 ? error.instancePath : '/'
  return `${path} ${error.message ?? 'is invalid'}`
}

function compile(schema: JsonSchema): ValidateFunction {
  const cached = validators.get(schema)
  if (cached !== undefined) {
    return cached
  }

  try {
    const validator = ajv.compile(schema as AnySchema)
    validators.set(schema, validator)
    return validator
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RolekitError('invalid_schema', `Invalid JSON Schema: ${message}`)
  }
}

export function validateValue(schema: JsonSchema, value: unknown): ValidationResult {
  const validator = compile(schema)
  const valid = validator(value)
  return {
    valid,
    errors: valid ? [] : (validator.errors ?? []).map(formatError),
  }
}

export function assertValid(schema: JsonSchema, value: unknown, label: string): void {
  const result = validateValue(schema, value)
  if (!result.valid) {
    throw new RolekitError('invalid_contract', `${label} is invalid: ${result.errors.join('; ')}`, {
      errors: [...result.errors],
    })
  }
}

export function assertCompilableSchema(schema: JsonSchema, label: string): void {
  try {
    compile(schema)
  } catch (error: unknown) {
    if (error instanceof RolekitError) {
      throw new RolekitError('invalid_schema', `${label}: ${error.message}`)
    }
    throw error
  }
}

import { Ajv2020, type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { RolekitError } from './errors.ts'
import { cloneJsonValue, compileStrictJsonSchema, freezeJsonSnapshot } from './json.ts'
import type {
  JsonObject,
  JsonSchema,
  JsonValue,
  PreparedExecutorOptions,
  PublicSecretMarker,
} from './types.ts'

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
})

const validators = new WeakMap<object, ValidateFunction>()

const strictValidators = new WeakMap<object, ValidateFunction>()

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

function compileStrict(schema: JsonSchema): ValidateFunction {
  const cached = strictValidators.get(schema)
  if (cached !== undefined) {
    return cached
  }

  const validator = compileStrictJsonSchema(schema)
  strictValidators.set(schema, validator)
  return validator
}

export function validateValue(schema: JsonSchema, value: unknown): ValidationResult {
  const validator = compile(schema)
  const valid = validator(value)
  return {
    valid,
    errors: valid ? [] : (validator.errors ?? []).map(formatError),
  }
}

export function validateStrictValue<T>(schema: JsonSchema<T>, value: unknown): ValidationResult {
  let snapshot: unknown
  try {
    snapshot = cloneJsonValue(value, 'Value')
  } catch (error: unknown) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
  const validator = compileStrict(schema)
  const valid = validator(snapshot)
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

function jsonPointer(path: string, key: string): string {
  return `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeMarker(value: JsonValue): boolean {
  return isJsonObject(value) && value.redacted === true && Object.hasOwn(value, 'source')
}

function markerAt(value: JsonValue): PublicSecretMarker | undefined {
  if (!isJsonObject(value) || value.redacted !== true) {
    return undefined
  }
  const keys = Object.keys(value).sort()
  if (
    value.source === 'literal' &&
    keys.length === 2 &&
    keys[0] === 'redacted' &&
    keys[1] === 'source'
  ) {
    return { source: 'literal', redacted: true }
  }
  if (
    value.source === 'env' &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    keys.length === 3 &&
    keys[0] === 'name' &&
    keys[1] === 'redacted' &&
    keys[2] === 'source'
  ) {
    return { source: 'env', name: value.name, redacted: true }
  }
  return undefined
}

function sensitivePointerErrors(value: unknown): {
  readonly errors: readonly string[]
  readonly pointers: readonly string[]
} {
  if (value === undefined) {
    return { errors: [], pointers: [] }
  }
  if (!Array.isArray(value)) {
    return {
      errors: ['adapter sensitiveOptionPointers must be an array of JSON Pointers'],
      pointers: [],
    }
  }
  const errors: string[] = []
  const pointers: string[] = []
  const seen = new Set<string>()
  for (const pointer of value) {
    if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?:[^01]|$)/u.test(pointer)) {
      errors.push('adapter sensitiveOptionPointers contains an invalid JSON Pointer')
      continue
    }
    if (seen.has(pointer)) {
      errors.push(`adapter sensitiveOptionPointers repeats ${pointer}`)
      continue
    }
    seen.add(pointer)
    pointers.push(pointer)
  }
  return { errors, pointers }
}

function pointerIsDeclared(pointer: string, declarations: readonly string[]): boolean {
  return declarations.some(
    (declaration) => pointer === declaration || pointer.startsWith(`${declaration}/`),
  )
}

export function redactSensitiveText(text: string, sensitiveValues: readonly string[]): string {
  let redacted = text
  for (const sensitiveValue of [...new Set(sensitiveValues)].sort(
    (left, right) => right.length - left.length,
  )) {
    if (sensitiveValue.length > 0) {
      redacted = redacted.split(sensitiveValue).join('[REDACTED]')
    }
  }
  return redacted
}

function redactJsonValue(value: JsonValue, sensitiveValues: readonly string[]): JsonValue {
  if (typeof value === 'string') {
    return redactSensitiveText(value, sensitiveValues)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(entry, sensitiveValues))
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      redactSensitiveText(key, sensitiveValues),
      redactJsonValue(entry, sensitiveValues),
    ]),
  )
}

export function redactSensitiveJsonValue<T>(value: T, sensitiveValues: readonly string[]): T {
  if (sensitiveValues.every((entry) => entry.length === 0)) {
    return value
  }
  try {
    const snapshot = cloneJsonValue(value, 'Adapter result') as unknown as JsonValue
    return freezeJsonSnapshot(
      redactJsonValue(snapshot, sensitiveValues),
      'Redacted adapter result',
    ) as T
  } catch {
    return value
  }
}

export function preparedSensitiveValues(value: unknown): readonly string[] {
  try {
    if (!isJsonObject(value) || !Array.isArray(value.sensitiveValues)) {
      return []
    }
    return value.sensitiveValues.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    )
  } catch {
    return []
  }
}

export function validatePublicOptionSafety(
  value: unknown,
  sensitiveValues: readonly string[],
  sensitiveOptionPointers: unknown,
  label: string,
): ValidationResult {
  let snapshot: JsonValue
  try {
    snapshot = cloneJsonValue(value, label) as unknown as JsonValue
  } catch (error: unknown) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : `${label} is not portable JSON`],
    }
  }

  const declarationValidation = sensitivePointerErrors(sensitiveOptionPointers)
  const errors = [...declarationValidation.errors]
  const secrets = [...new Set(sensitiveValues)].filter((entry) => entry.length > 0)
  const visit = (candidate: JsonValue, pointer: string): void => {
    if (typeof candidate === 'string') {
      if (secrets.some((secret) => candidate.includes(secret))) {
        errors.push(`${label}${pointer || '/'} contains a declared sensitive literal`)
      }
      return
    }
    if (candidate === null || typeof candidate !== 'object') {
      return
    }
    const marker = markerAt(candidate)
    if (looksLikeMarker(candidate)) {
      if (marker === undefined) {
        errors.push(`${label}${pointer || '/'} contains an invalid public secret marker`)
      } else {
        if (!pointerIsDeclared(pointer, declarationValidation.pointers)) {
          errors.push(
            `${label}${pointer || '/'} contains a public secret marker outside an adapter-declared sensitive pointer`,
          )
        }
        for (const [key, entry] of Object.entries(candidate)) {
          const childPointer = jsonPointer(pointer, key)
          if (secrets.some((secret) => key.includes(secret))) {
            errors.push(`${label}${childPointer} contains a declared sensitive literal in a key`)
          }
          visit(entry, childPointer)
        }
        return
      }
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => {
        visit(entry, jsonPointer(pointer, String(index)))
      })
      return
    }
    for (const [key, entry] of Object.entries(candidate)) {
      const childPointer = jsonPointer(pointer, key)
      if (secrets.some((secret) => key.includes(secret))) {
        errors.push(`${label}${childPointer} contains a declared sensitive literal in a key`)
      }
      visit(entry, childPointer)
    }
  }
  visit(snapshot, '')
  return { valid: errors.length === 0, errors }
}

function frozenSnapshotErrors(
  value: unknown,
  path: string,
  visited: Set<object>,
): readonly string[] {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return []
  }
  visited.add(value)
  const errors: string[] = []
  if (!Object.isFrozen(value)) {
    errors.push(`${path || '/'} must be frozen`)
  }
  for (const [key, entry] of Object.entries(value)) {
    errors.push(...frozenSnapshotErrors(entry, jsonPointer(path, key), visited))
  }
  return errors
}

export interface PreparedExecutorOptionsValidation extends ValidationResult {
  readonly prepared?: PreparedExecutorOptions
}

export function validatePreparedExecutorOptions(
  value: unknown,
  sensitiveOptionPointers: unknown,
): PreparedExecutorOptionsValidation {
  let snapshot: JsonValue
  try {
    snapshot = cloneJsonValue(value, 'Prepared executor options') as unknown as JsonValue
  } catch (error: unknown) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Prepared executor options are invalid'],
    }
  }

  const errors: string[] = []
  if (!isJsonObject(snapshot)) {
    return {
      valid: false,
      errors: ['Prepared executor options must be a JSON object'],
    }
  }
  if (!Object.hasOwn(snapshot, 'executionOptions')) {
    errors.push('Prepared executor options must include executionOptions')
  }
  if (!isJsonObject(snapshot.publicOptions)) {
    errors.push('Prepared executor options publicOptions must be a JSON object')
  }
  if (
    !Array.isArray(snapshot.sensitiveValues) ||
    snapshot.sensitiveValues.some((entry) => typeof entry !== 'string')
  ) {
    errors.push('Prepared executor options sensitiveValues must be an array of strings')
  }
  if (snapshot.requestedProvider !== undefined && typeof snapshot.requestedProvider !== 'string') {
    errors.push('Prepared executor options requestedProvider must be a string')
  }
  if (snapshot.requestedModel !== undefined && typeof snapshot.requestedModel !== 'string') {
    errors.push('Prepared executor options requestedModel must be a string')
  }
  try {
    errors.push(...frozenSnapshotErrors(value, '', new Set<object>()))
  } catch {
    errors.push('Prepared executor options frozen state could not be inspected')
  }

  const sensitiveValues = Array.isArray(snapshot.sensitiveValues)
    ? snapshot.sensitiveValues.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (isJsonObject(snapshot.publicOptions)) {
    const safety = validatePublicOptionSafety(
      snapshot.publicOptions,
      sensitiveValues,
      sensitiveOptionPointers,
      'Prepared public options',
    )
    errors.push(...safety.errors)
  } else {
    errors.push(...sensitivePointerErrors(sensitiveOptionPointers).errors)
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return {
    valid: true,
    errors: [],
    prepared: freezeJsonSnapshot(
      snapshot,
      'Validated prepared executor options',
    ) as unknown as PreparedExecutorOptions,
  }
}

import { Hint, Kind, OptionalKind, ReadonlyKind, TransformKind } from '@sinclair/typebox'
import { Ajv2020, type AnySchema, type ValidateFunction } from 'ajv/dist/2020.js'
import uriResolverImport from 'ajv/dist/runtime/uri.js'
import addFormatsImport, { type FormatsPlugin } from 'ajv-formats'

import { RolekitError, type RolekitErrorCode } from './errors.ts'
import type { JsonObject, JsonSchema, JsonValue } from './types.ts'

export type PortableJsonSchema = JsonObject

const recognizedTypeBoxAnnotations = new Set<symbol>([
  Hint,
  Kind,
  OptionalKind,
  ReadonlyKind,
  TransformKind,
])

const schemaAjv = new Ajv2020({
  addUsedSchema: false,
  allErrors: true,
  strict: false,
})
const addFormats = addFormatsImport as unknown as FormatsPlugin
addFormats(schemaAjv)

interface UriResolver {
  normalize(uri: string): string
  resolve(base: string, reference: string): string
}

const uriResolverCandidate = uriResolverImport as unknown as UriResolver & {
  readonly default?: UriResolver
}
const uriResolver = uriResolverCandidate.default ?? uriResolverCandidate

const schemaMapKeywords = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])

const schemaArrayKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

const schemaValueKeywords = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

const SchemaNormalizationIdBase = 'https://rolekit.dev/internal/schema-normalization'

interface CloneOptions {
  readonly code: RolekitErrorCode
  readonly allowTypeBoxAnnotations: boolean
  readonly label: string
}

function fail(options: CloneOptions, path: string, reason: string): never {
  throw new RolekitError(options.code, `${options.label}${path} ${reason}.`)
}

function childPath(path: string, key: string): string {
  return `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function cloneValue(
  value: unknown,
  options: CloneOptions,
  path: string,
  ancestors: Set<object>,
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(options, path, 'contains a non-finite number')
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') {
    fail(options, path, `contains non-JSON ${typeof value} data`)
  }

  if (ancestors.has(value)) {
    fail(options, path, 'contains a cycle')
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail(options, path, 'is a non-plain array')
      }
      const allowedKeys = new Set<string>(['length'])
      const clone: JsonValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        allowedKeys.add(key)
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined) {
          fail(options, childPath(path, key), 'is a sparse array slot')
        }
        if (!('value' in descriptor) || !descriptor.enumerable) {
          fail(options, childPath(path, key), 'is not an enumerable data property')
        }
        clone.push(cloneValue(descriptor.value, options, childPath(path, key), ancestors))
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol') {
          fail(options, path, 'contains symbol-keyed state')
        }
        if (!allowedKeys.has(key)) {
          fail(options, childPath(path, key), 'contains unexpected array state')
        }
      }
      return clone
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      fail(options, path, 'is not a plain object')
    }

    const clone: Record<string, JsonValue> = {}
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined) {
        fail(options, path, 'contains unreadable own state')
      }
      if (typeof key === 'symbol') {
        if (!options.allowTypeBoxAnnotations || !recognizedTypeBoxAnnotations.has(key)) {
          fail(options, path, 'contains unrecognized symbol-keyed state')
        }
        if (!('value' in descriptor) || !descriptor.enumerable) {
          fail(options, path, 'contains an invalid TypeBox annotation')
        }
        continue
      }
      const propertyPath = childPath(path, key)
      if (!('value' in descriptor)) {
        fail(options, propertyPath, 'is an accessor property')
      }
      if (!descriptor.enumerable) {
        fail(options, propertyPath, 'is unexpected non-enumerable state')
      }
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneValue(descriptor.value, options, propertyPath, ancestors),
        writable: true,
      })
    }
    return clone
  } finally {
    ancestors.delete(value)
  }
}

function cloneWithOptions(value: unknown, options: CloneOptions): JsonValue {
  return cloneValue(value, options, '', new Set<object>())
}

function freezeRecursively(value: JsonValue): void {
  if (value === null || typeof value !== 'object') {
    return
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    freezeRecursively(child)
  }
  Object.freeze(value)
}

function encodeCanonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonical).join(',')}]`
  }
  const object = value as JsonObject
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encodeCanonical(object[key] as JsonValue)}`)
    .join(',')}}`
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value)
}

function visitSchemaChildren(
  schema: Readonly<Record<string, JsonValue>>,
  visitor: (child: JsonValue) => void,
): void {
  for (const [key, value] of Object.entries(schema)) {
    if (schemaMapKeywords.has(key) && value !== null && typeof value === 'object') {
      if (!isJsonArray(value)) {
        for (const child of Object.values(value)) {
          visitor(child)
        }
      }
      continue
    }
    if (schemaArrayKeywords.has(key) && isJsonArray(value)) {
      for (const child of value) {
        visitor(child)
      }
      continue
    }
    if (schemaValueKeywords.has(key)) {
      if (isJsonArray(value)) {
        for (const child of value) {
          visitor(child)
        }
      } else {
        visitor(value)
      }
      continue
    }
    if (
      key === 'dependencies' &&
      value !== null &&
      typeof value === 'object' &&
      !isJsonArray(value)
    ) {
      for (const child of Object.values(value)) {
        if (!isJsonArray(child)) {
          visitor(child)
        }
      }
    }
  }
}

function transformSchemaChildren(
  schema: Readonly<Record<string, JsonValue>>,
  transform: (child: JsonValue) => JsonValue,
): JsonObject {
  const transformed: Record<string, JsonValue> = { ...schema }
  for (const [key, value] of Object.entries(schema)) {
    if ((key === '$ref' || key === '$dynamicRef') && value === '') {
      transformed[key] = '#'
      continue
    }
    if (
      schemaMapKeywords.has(key) &&
      value !== null &&
      typeof value === 'object' &&
      !isJsonArray(value)
    ) {
      transformed[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, transform(child)]),
      )
      continue
    }
    if (schemaArrayKeywords.has(key) && isJsonArray(value)) {
      transformed[key] = value.map(transform)
      continue
    }
    if (schemaValueKeywords.has(key)) {
      transformed[key] = isJsonArray(value) ? value.map(transform) : transform(value)
      continue
    }
    if (
      key === 'dependencies' &&
      value !== null &&
      typeof value === 'object' &&
      !isJsonArray(value)
    ) {
      transformed[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          isJsonArray(child) ? child : transform(child),
        ]),
      )
    }
  }
  return transformed
}

function schemaCompilationSnapshot(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object' || isJsonArray(value)) {
    return value
  }
  return transformSchemaChildren(value, schemaCompilationSnapshot)
}

function stripEmptyFragment(uri: string): string {
  return uri.endsWith('#') ? uri.slice(0, -1) : uri
}

function canonicalSchemaUri(reference: string, activeBase: string): string {
  return stripEmptyFragment(uriResolver.normalize(uriResolver.resolve(activeBase, reference)))
}

function collectNestedResourceIds(
  value: JsonValue,
  activeBase: string,
  ids: Set<string>,
  root: boolean,
): void {
  if (value === null || typeof value !== 'object' || isJsonArray(value)) {
    return
  }

  let resourceBase = activeBase
  if (typeof value.$id === 'string' && value.$id !== '' && value.$id !== '#') {
    resourceBase = canonicalSchemaUri(value.$id, activeBase)
    if (!root) {
      ids.add(resourceBase)
    }
  }
  visitSchemaChildren(value, (child) => collectNestedResourceIds(child, resourceBase, ids, false))
}

function schemaFingerprint(schema: JsonObject): string {
  const canonical = encodeCanonical(schema)
  let hash = 0x6c62272e07bb014262b821756295c58dn
  const prime = 0x0000000001000000000000000000013bn
  for (let index = 0; index < canonical.length; index += 1) {
    const codeUnit = canonical.charCodeAt(index)
    hash ^= BigInt(codeUnit & 0xff)
    hash = BigInt.asUintN(128, hash * prime)
    hash ^= BigInt(codeUnit >>> 8)
    hash = BigInt.asUintN(128, hash * prime)
  }
  return hash.toString(16).padStart(32, '0')
}

function collisionFreeRetrievalId(schema: JsonObject): string {
  const base = `${SchemaNormalizationIdBase}/${schemaFingerprint(schema)}`
  let candidate = base
  let suffix = 1
  while (true) {
    const nestedResourceIds = new Set<string>()
    collectNestedResourceIds(schema, candidate, nestedResourceIds, true)
    if (!nestedResourceIds.has(candidate)) {
      return candidate
    }
    candidate = `${base}-${suffix}`
    suffix += 1
  }
}

function schemaCompilationRoot(schema: JsonObject): JsonObject {
  const snapshot = schemaCompilationSnapshot(schema) as JsonObject
  return typeof snapshot.$id === 'string' && snapshot.$id !== '' && snapshot.$id !== '#'
    ? snapshot
    : {
        ...snapshot,
        $id: collisionFreeRetrievalId(snapshot),
      }
}

function normalizedJsonSchema(schema: JsonSchema, label: string): JsonObject {
  const normalized = cloneWithOptions(schema, {
    code: 'invalid_schema',
    allowTypeBoxAnnotations: true,
    label,
  })
  if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new RolekitError('invalid_schema', `${label} must be a JSON object.`)
  }
  return normalized as JsonObject
}

function compilationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** @internal Compile the same detached representation used by normalization. */
export function compileStrictJsonSchema(schema: JsonSchema): ValidateFunction {
  const normalized = normalizedJsonSchema(schema, 'JSON Schema')
  try {
    return schemaAjv.compile(schemaCompilationRoot(normalized) as AnySchema)
  } catch (error: unknown) {
    throw new RolekitError('invalid_schema', `Invalid JSON Schema: ${compilationError(error)}`)
  }
}

export function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  cloneWithOptions(value, {
    code: 'invalid_contract',
    allowTypeBoxAnnotations: false,
    label,
  })
}

export function cloneJsonValue<T>(value: T, label: string): T {
  return cloneWithOptions(value, {
    code: 'invalid_contract',
    allowTypeBoxAnnotations: false,
    label,
  }) as T
}

export function freezeJsonSnapshot<T>(value: T, label: string): Readonly<T> {
  const clone = cloneJsonValue(value, label) as unknown as JsonValue
  freezeRecursively(clone)
  return clone as Readonly<T>
}

export function canonicalJson(value: unknown, label = 'Value'): string {
  return encodeCanonical(cloneJsonValue(value, label) as JsonValue)
}

export function normalizeJsonSchema(schema: JsonSchema, label: string): PortableJsonSchema {
  const normalized = normalizedJsonSchema(schema, label)
  try {
    schemaAjv.compile(schemaCompilationRoot(normalized) as AnySchema)
  } catch (error: unknown) {
    throw new RolekitError(
      'invalid_schema',
      `${label}: Invalid JSON Schema: ${compilationError(error)}`,
    )
  }
  return normalized
}

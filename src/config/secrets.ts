import { isAbsolute, resolve } from 'node:path'

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { freezeJsonSnapshot } from '../core/json.ts'
import type {
  JsonObject,
  JsonSchema,
  JsonValue,
  PreparedExecutorOptions,
  PublicOptionContext,
  PublicSecretMarker,
} from '../core/types.ts'
import { PATH_CONFIG_ANNOTATION, SECRET_CONFIG_ANNOTATION } from './schemas.ts'
import { RolekitConfigError } from './types.ts'

const STATIC_INSPECTION_SENTINEL = 'rolekit-non-secret-static-placeholder'
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const INTERPOLATION = /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/u
const schemaAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
const validatorCache = new WeakMap<object, ValidateFunction>()

const UNSUPPORTED_CLASSIFICATION_KEYWORDS = [
  'contains',
  'dependentSchemas',
  'if',
  'not',
  'then',
  'else',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const

function pointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPointer(pointer: string, value: string): string {
  return `${pointer}/${pointerToken(value)}`
}

function absolutePointer(basePointer: string, relativePointer: string): string {
  if (relativePointer.length === 0 || relativePointer === '/') {
    return basePointer
  }
  return `${basePointer}${relativePointer}`
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaObject(schema: unknown): Readonly<Record<string, unknown>> {
  return isObject(schema) ? schema : {}
}

function validatorFor(schema: JsonSchema): ValidateFunction {
  const object = schema as object
  const cached = validatorCache.get(object)
  if (cached !== undefined) {
    return cached
  }
  let validator: ValidateFunction
  try {
    validator = schemaAjv.compile(schema)
  } catch {
    throw new RolekitConfigError('invalid_config', 'Adapter config schema is invalid.')
  }
  validatorCache.set(object, validator)
  return validator
}

function errorRelativePointer(error: ErrorObject): string {
  if (error.keyword === 'additionalProperties') {
    const property = error.params.additionalProperty
    if (typeof property === 'string') {
      return childPointer(error.instancePath, property)
    }
  }
  if (error.keyword === 'required') {
    const property = error.params.missingProperty
    if (typeof property === 'string') {
      return childPointer(error.instancePath, property)
    }
  }
  return error.instancePath.length === 0 ? '/' : error.instancePath
}

function validateAdapterConfig(
  schema: JsonSchema,
  value: unknown,
  sourcePath: string,
  basePointer: string,
): void {
  const validator = validatorFor(schema)
  if (validator(value)) {
    return
  }
  const errors = validator.errors ?? []
  const formatted = errors.map((error) => {
    const pointer = absolutePointer(basePointer, errorRelativePointer(error))
    return `${pointer} ${error.message ?? 'is invalid'}`
  })
  const first = errors[0]
  throw new RolekitConfigError(
    'invalid_config',
    `Adapter options are invalid: ${formatted.join('; ')}`,
    {
      sourcePath,
      pointer:
        first === undefined
          ? basePointer
          : absolutePointer(basePointer, errorRelativePointer(first)),
    },
  )
}

function localSchemaReference(
  reference: string,
  rootSchema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | boolean | undefined {
  if (!reference.startsWith('#/')) {
    return undefined
  }
  let current: unknown = rootSchema
  for (const encodedToken of reference.slice(2).split('/')) {
    if (!isObject(current)) {
      return undefined
    }
    const token = encodedToken.replaceAll('~1', '/').replaceAll('~0', '~')
    current = current[token]
  }
  return typeof current === 'boolean' || isObject(current) ? current : undefined
}

function classificationError(
  state: TransformState,
  pointer: string,
  message: string,
): RolekitConfigError {
  return new RolekitConfigError('invalid_config', message, configurationLocation(state, pointer))
}

function cloneMaterializedSchemaValue(
  value: unknown,
  rootSchema: Readonly<Record<string, unknown>>,
  referenceStack: ReadonlySet<string>,
): unknown {
  if (typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneMaterializedSchemaValue(entry, rootSchema, referenceStack))
  }
  if (!isObject(value)) {
    return value
  }
  return materializeSchema(value, rootSchema, referenceStack)
}

function materializeSchemaMap(
  value: unknown,
  rootSchema: Readonly<Record<string, unknown>>,
  referenceStack: ReadonlySet<string>,
): unknown {
  if (!isObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      cloneMaterializedSchemaValue(entry, rootSchema, referenceStack),
    ]),
  )
}

function materializeSchema(
  schema: Readonly<Record<string, unknown>>,
  rootSchema: Readonly<Record<string, unknown>>,
  referenceStack: ReadonlySet<string> = new Set(),
): Readonly<Record<string, unknown>> | boolean {
  const reference = schema.$ref
  if (typeof reference === 'string') {
    if (referenceStack.has(reference)) {
      throw new RolekitConfigError(
        'invalid_config',
        'Adapter config schema uses a recursive reference that cannot be classified safely.',
      )
    }
    const referenced = localSchemaReference(reference, rootSchema)
    if (referenced === undefined) {
      throw new RolekitConfigError(
        'invalid_config',
        'Adapter config schema contains an unsupported or unresolved reference.',
      )
    }
    const nextStack = new Set(referenceStack)
    nextStack.add(reference)
    const materializedReference =
      typeof referenced === 'boolean'
        ? referenced
        : materializeSchema(referenced, rootSchema, nextStack)
    const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'))
    if (Object.keys(siblings).length === 0) {
      return materializedReference
    }
    const materializedSiblings = materializeSchema(siblings, rootSchema, referenceStack)
    return { allOf: [materializedReference, materializedSiblings] }
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === 'properties' ||
      key === 'patternProperties' ||
      key === '$defs' ||
      key === 'definitions' ||
      key === 'dependentSchemas'
    ) {
      result[key] = materializeSchemaMap(value, rootSchema, referenceStack)
      continue
    }
    if (
      key === 'additionalProperties' ||
      key === 'items' ||
      key === 'contains' ||
      key === 'not' ||
      key === 'if' ||
      key === 'then' ||
      key === 'else' ||
      key === 'propertyNames' ||
      key === 'unevaluatedItems' ||
      key === 'unevaluatedProperties'
    ) {
      result[key] = cloneMaterializedSchemaValue(value, rootSchema, referenceStack)
      continue
    }
    if (key === 'prefixItems' || key === 'allOf' || key === 'anyOf' || key === 'oneOf') {
      result[key] = Array.isArray(value)
        ? value.map((entry) => cloneMaterializedSchemaValue(entry, rootSchema, referenceStack))
        : value
      continue
    }
    result[key] = value
  }
  return result
}

function branchApplies(
  branch: Readonly<Record<string, unknown>>,
  value: unknown,
  rootSchema: Readonly<Record<string, unknown>>,
): boolean {
  let materialized: Readonly<Record<string, unknown>> | boolean
  try {
    materialized = materializeSchema(branch, rootSchema)
  } catch (error: unknown) {
    if (error instanceof RolekitConfigError) {
      throw error
    }
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter config schema cannot be classified safely.',
    )
  }
  try {
    return schemaAjv.compile(materialized as JsonSchema)(value) as boolean
  } catch {
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter config schema cannot be classified safely.',
    )
  }
}

function environmentRef(value: unknown): string | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== '$env') {
    return undefined
  }
  const name = value.$env
  return typeof name === 'string' && ENVIRONMENT_NAME.test(name) ? name : undefined
}

function markerForEnv(name: string): PublicSecretMarker {
  return { source: 'env', name, redacted: true }
}

function markerForLiteral(): PublicSecretMarker {
  return { source: 'literal', redacted: true }
}

interface TransformState {
  readonly sourcePath: string
  readonly basePointer: string
  readonly declaringDirectory?: string
  readonly rootSchema: Readonly<Record<string, unknown>>
  readonly replacements: Record<string, PublicSecretMarker>
  readonly requiredSecrets: Set<string>
  readonly literalSecretValues: string[]
}

interface TransformedValue {
  readonly normalized: JsonValue
  readonly inspection: JsonValue
  readonly publicValue: JsonValue
}

function configurationLocation(state: TransformState, pointer: string) {
  return {
    sourcePath: state.sourcePath,
    pointer: absolutePointer(state.basePointer, pointer),
  }
}

function applicableSchemas(
  schema: Readonly<Record<string, unknown>> | boolean,
  value: unknown,
  pointer: string,
  state: TransformState,
  referenceStack: ReadonlySet<string> = new Set(),
): readonly Readonly<Record<string, unknown>>[] {
  if (schema === true) {
    return [{}]
  }
  if (schema === false) {
    throw classificationError(
      state,
      pointer,
      'Adapter config schema classification reached an inapplicable false schema.',
    )
  }

  const reference = schema.$ref
  if (typeof reference === 'string') {
    if (referenceStack.has(reference)) {
      throw classificationError(
        state,
        pointer,
        'Adapter config schema uses a recursive reference that cannot be classified safely.',
      )
    }
    const referenced = localSchemaReference(reference, state.rootSchema)
    if (referenced === undefined) {
      throw classificationError(
        state,
        pointer,
        'Adapter config schema contains an unsupported or unresolved reference.',
      )
    }
    const nextStack = new Set(referenceStack)
    nextStack.add(reference)
    const siblingSchema = Object.fromEntries(
      Object.entries(schema).filter(([key]) => key !== '$ref'),
    )
    return [
      ...applicableSchemas(referenced, value, pointer, state, nextStack),
      ...(Object.keys(siblingSchema).length === 0
        ? []
        : applicableSchemas(siblingSchema, value, pointer, state, referenceStack)),
    ]
  }

  for (const keyword of UNSUPPORTED_CLASSIFICATION_KEYWORDS) {
    if (Object.hasOwn(schema, keyword)) {
      throw classificationError(
        state,
        pointer,
        `Adapter config schema keyword "${keyword}" cannot be classified safely.`,
      )
    }
  }

  const base = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== 'allOf' && key !== 'anyOf' && key !== 'oneOf'),
  )
  const result: Readonly<Record<string, unknown>>[] = [base]

  if (Object.hasOwn(schema, 'allOf')) {
    if (!Array.isArray(schema.allOf)) {
      throw classificationError(state, pointer, 'Adapter config schema allOf is invalid.')
    }
    for (const branch of schema.allOf) {
      if (typeof branch !== 'boolean' && !isObject(branch)) {
        throw classificationError(state, pointer, 'Adapter config schema allOf is invalid.')
      }
      result.push(...applicableSchemas(branch, value, pointer, state, referenceStack))
    }
  }

  for (const keyword of ['oneOf', 'anyOf'] as const) {
    if (!Object.hasOwn(schema, keyword)) {
      continue
    }
    const branches = schema[keyword]
    if (!Array.isArray(branches)) {
      throw classificationError(state, pointer, `Adapter config schema ${keyword} is invalid.`)
    }
    const applicable = branches.filter((branch) => {
      if (typeof branch === 'boolean') {
        return branch
      }
      if (!isObject(branch)) {
        throw classificationError(state, pointer, `Adapter config schema ${keyword} is invalid.`)
      }
      return branchApplies(branch, value, state.rootSchema)
    })
    if (applicable.length !== 1) {
      throw classificationError(
        state,
        pointer,
        `Secret classification is ambiguous because ${applicable.length} ${keyword} branches apply.`,
      )
    }
    const selected = applicable[0]
    if (selected === undefined) {
      throw classificationError(state, pointer, 'Adapter config schema classification failed.')
    }
    result.push(...applicableSchemas(selected, value, pointer, state, referenceStack))
  }

  return result
}

function effectiveSchemas(
  schemas: readonly (Readonly<Record<string, unknown>> | boolean)[],
  value: unknown,
  pointer: string,
  state: TransformState,
): readonly Readonly<Record<string, unknown>>[] {
  return schemas.flatMap((schema) => applicableSchemas(schema, value, pointer, state))
}

function transformSecret(value: unknown, pointer: string, state: TransformState): TransformedValue {
  const name = environmentRef(value)
  if (name !== undefined) {
    const marker = markerForEnv(name)
    state.requiredSecrets.add(name)
    state.replacements[pointer] = marker
    return {
      normalized: { $env: name },
      inspection: STATIC_INSPECTION_SENTINEL,
      publicValue: marker,
    }
  }
  if (typeof value === 'string') {
    if (INTERPOLATION.test(value)) {
      throw new RolekitConfigError(
        'invalid_config',
        'String interpolation is not accepted; use an explicit { "$env": "NAME" } reference.',
        configurationLocation(state, pointer),
      )
    }
    const marker = markerForLiteral()
    state.literalSecretValues.push(value)
    state.replacements[pointer] = marker
    return {
      normalized: value,
      inspection: STATIC_INSPECTION_SENTINEL,
      publicValue: marker,
    }
  }
  throw new RolekitConfigError(
    'invalid_config',
    'Secret-capable fields accept only a literal string or { "$env": "NAME" }.',
    configurationLocation(state, pointer),
  )
}

function objectChildSchemas(
  schemas: readonly Readonly<Record<string, unknown>>[],
  key: string,
  pointer: string,
  state: TransformState,
): readonly (Readonly<Record<string, unknown>> | boolean)[] {
  const childSchemas: (Readonly<Record<string, unknown>> | boolean)[] = []
  for (const schema of schemas) {
    const properties = schemaObject(schema.properties)
    let matched = false
    if (Object.hasOwn(properties, key)) {
      const propertySchema = properties[key]
      if (typeof propertySchema !== 'boolean' && !isObject(propertySchema)) {
        throw classificationError(state, pointer, 'Adapter config property schema is invalid.')
      }
      childSchemas.push(propertySchema)
      matched = true
    }

    const patterns = schemaObject(schema.patternProperties)
    for (const [pattern, patternSchema] of Object.entries(patterns)) {
      let matches: boolean
      try {
        matches = new RegExp(pattern, 'u').test(key)
      } catch {
        throw classificationError(state, pointer, 'Adapter config pattern schema is invalid.')
      }
      if (!matches) {
        continue
      }
      if (typeof patternSchema !== 'boolean' && !isObject(patternSchema)) {
        throw classificationError(state, pointer, 'Adapter config pattern schema is invalid.')
      }
      childSchemas.push(patternSchema)
      matched = true
    }

    if (!matched && Object.hasOwn(schema, 'additionalProperties')) {
      const additional = schema.additionalProperties
      if (typeof additional !== 'boolean' && !isObject(additional)) {
        throw classificationError(
          state,
          pointer,
          'Adapter config additionalProperties schema is invalid.',
        )
      }
      childSchemas.push(additional)
    }
  }
  return childSchemas.length === 0 ? [{}] : childSchemas
}

function arrayChildSchemas(
  schemas: readonly Readonly<Record<string, unknown>>[],
  index: number,
  pointer: string,
  state: TransformState,
): readonly (Readonly<Record<string, unknown>> | boolean)[] {
  const childSchemas: (Readonly<Record<string, unknown>> | boolean)[] = []
  for (const schema of schemas) {
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : []
    if (index < prefixItems.length) {
      const prefixSchema = prefixItems[index]
      if (typeof prefixSchema !== 'boolean' && !isObject(prefixSchema)) {
        throw classificationError(state, pointer, 'Adapter config prefixItems schema is invalid.')
      }
      childSchemas.push(prefixSchema)
      continue
    }

    const items = schema.items
    if (Array.isArray(items)) {
      const itemSchema = items[index]
      if (itemSchema !== undefined) {
        if (typeof itemSchema !== 'boolean' && !isObject(itemSchema)) {
          throw classificationError(state, pointer, 'Adapter config items schema is invalid.')
        }
        childSchemas.push(itemSchema)
      }
      continue
    }
    if (typeof items === 'boolean' || isObject(items)) {
      childSchemas.push(items)
    }
  }
  return childSchemas.length === 0 ? [{}] : childSchemas
}

function transformValue(
  value: unknown,
  schemas: readonly (Readonly<Record<string, unknown>> | boolean)[],
  pointer: string,
  state: TransformState,
): TransformedValue {
  const selectedSchemas = effectiveSchemas(schemas, value, pointer, state)
  if (selectedSchemas.some((schema) => schema[SECRET_CONFIG_ANNOTATION] === true)) {
    return transformSecret(value, pointer, state)
  }

  if (typeof value === 'string') {
    if (INTERPOLATION.test(value)) {
      throw new RolekitConfigError(
        'invalid_config',
        'String interpolation is not accepted in adapter configuration.',
        configurationLocation(state, pointer),
      )
    }
    const isPath = selectedSchemas.some((schema) => schema[PATH_CONFIG_ANNOTATION] === true)
    const path =
      isPath && state.declaringDirectory !== undefined && !isAbsolute(value)
        ? resolve(state.declaringDirectory, value)
        : value
    return { normalized: path, inspection: path, publicValue: path }
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return { normalized: value, inspection: value, publicValue: value }
  }

  if (Array.isArray(value)) {
    const entries = value.map((entry, index) => {
      const entryPointer = childPointer(pointer, String(index))
      return transformValue(
        entry,
        arrayChildSchemas(selectedSchemas, index, entryPointer, state),
        entryPointer,
        state,
      )
    })
    return {
      normalized: entries.map((entry) => entry.normalized),
      inspection: entries.map((entry) => entry.inspection),
      publicValue: entries.map((entry) => entry.publicValue),
    }
  }

  if (!isObject(value)) {
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter configuration must contain only portable JSON values.',
      configurationLocation(state, pointer),
    )
  }

  if (Object.hasOwn(value, '$env')) {
    throw new RolekitConfigError(
      'invalid_config',
      'Environment secret references are not allowed outside schema-declared secret fields.',
      configurationLocation(state, pointer),
    )
  }

  const normalized: Record<string, JsonValue> = Object.create(null)
  const inspection: Record<string, JsonValue> = Object.create(null)
  const publicValue: Record<string, JsonValue> = Object.create(null)
  for (const [key, entry] of Object.entries(value)) {
    const entryPointer = childPointer(pointer, key)
    const transformed = transformValue(
      entry,
      objectChildSchemas(selectedSchemas, key, entryPointer, state),
      entryPointer,
      state,
    )
    normalized[key] = transformed.normalized
    inspection[key] = transformed.inspection
    publicValue[key] = transformed.publicValue
  }
  return { normalized, inspection, publicValue }
}

export interface AnalyzedAdapterConfig<TConfig = unknown> {
  readonly normalizedConfig: TConfig
  readonly inspectionConfig: TConfig
  readonly publicConfig: JsonObject
  readonly publicOptionContext: PublicOptionContext
  readonly requiredSecrets: readonly string[]
  readonly literalSecretValues: readonly string[]
}

export function analyzeAdapterConfig<TConfig>(
  value: unknown,
  schema: JsonSchema<TConfig>,
  options: {
    readonly sourcePath: string
    readonly basePointer: string
    readonly declaringDirectory?: string
  },
): AnalyzedAdapterConfig<TConfig> {
  validateAdapterConfig(schema, value, options.sourcePath, options.basePointer)
  const rootSchema = schemaObject(schema)
  const state: TransformState = {
    sourcePath: options.sourcePath,
    basePointer: options.basePointer,
    ...(options.declaringDirectory === undefined
      ? {}
      : { declaringDirectory: options.declaringDirectory }),
    rootSchema,
    replacements: Object.create(null),
    requiredSecrets: new Set(),
    literalSecretValues: [],
  }
  const transformed = transformValue(value, [rootSchema], '', state)
  if (!isObject(transformed.normalized) || !isObject(transformed.publicValue)) {
    throw new RolekitConfigError('invalid_config', 'Adapter options must be an object.', {
      sourcePath: options.sourcePath,
      pointer: options.basePointer,
    })
  }
  const normalizedConfig = freezeJsonSnapshot(
    transformed.normalized,
    'Normalized adapter configuration',
  ) as unknown as TConfig
  const inspectionConfig = freezeJsonSnapshot(
    transformed.inspection,
    'Static inspection adapter configuration',
  ) as unknown as TConfig
  const publicConfig = freezeJsonSnapshot(
    transformed.publicValue,
    'Public adapter configuration',
  ) as JsonObject
  const publicOptionContext = freezeJsonSnapshot(
    { replacementsByJsonPointer: state.replacements },
    'Public option context',
  ) as PublicOptionContext
  return {
    normalizedConfig,
    inspectionConfig,
    publicConfig,
    publicOptionContext,
    requiredSecrets: [...state.requiredSecrets].sort(),
    literalSecretValues: [...state.literalSecretValues],
  }
}

function redactInspectionValue(value: unknown): JsonValue {
  if (value === STATIC_INSPECTION_SENTINEL) {
    return markerForLiteral()
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(redactInspectionValue)
  }
  if (!isObject(value)) {
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter static inspection returned a non-portable prepared value.',
    )
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactInspectionValue(entry)]),
  )
}

function setPublicMarkerAtPointer(
  value: JsonValue,
  pointer: string,
  marker: PublicSecretMarker,
): void {
  if (!pointer.startsWith('/')) {
    return
  }
  const tokens = pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current: unknown = value
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(token)
      current = Number.isSafeInteger(index) ? current[index] : undefined
    } else if (isObject(current)) {
      current = current[token]
    } else {
      return
    }
  }
  const leaf = tokens.at(-1)
  if (leaf === undefined) {
    return
  }
  if (Array.isArray(current)) {
    const index = Number(leaf)
    if (Number.isSafeInteger(index) && index >= 0 && index < current.length) {
      current[index] = marker
    }
  } else if (isObject(current) && Object.hasOwn(current, leaf)) {
    ;(current as Record<string, unknown>)[leaf] = marker
  }
}

/** @internal Produces the secret-free prepared snapshot stored in a compiled binding. */
export function redactStaticInspectionPreparedOptions(
  prepared: PreparedExecutorOptions,
  publicContext: PublicOptionContext,
): PreparedExecutorOptions {
  if (
    prepared.requestedProvider === STATIC_INSPECTION_SENTINEL ||
    prepared.requestedModel === STATIC_INSPECTION_SENTINEL
  ) {
    throw new RolekitConfigError(
      'invalid_config',
      'Adapter static inspection exposed a secret through requested identity fields.',
    )
  }
  const executionOptions = redactInspectionValue(prepared.executionOptions)
  for (const [pointer, marker] of Object.entries(publicContext.replacementsByJsonPointer)) {
    setPublicMarkerAtPointer(executionOptions, pointer, marker)
  }
  return freezeJsonSnapshot(
    {
      executionOptions,
      publicOptions: redactInspectionValue(prepared.publicOptions),
      sensitiveValues: [],
      ...(prepared.requestedProvider === undefined
        ? {}
        : { requestedProvider: prepared.requestedProvider }),
      ...(prepared.requestedModel === undefined ? {} : { requestedModel: prepared.requestedModel }),
    },
    'Public static inspection prepared options',
  ) as unknown as PreparedExecutorOptions
}

export function resolveAdapterConfigSecrets<TConfig>(
  value: unknown,
  schema: JsonSchema<TConfig>,
  environment: Readonly<Record<string, string | undefined>>,
  options: { readonly sourcePath: string; readonly basePointer: string },
): {
  readonly rawOptions: TConfig
  readonly publicOptionContext: PublicOptionContext
  readonly requiredSecrets: readonly string[]
  readonly literalSecretValues: readonly string[]
} {
  const analyzed = analyzeAdapterConfig(value, schema, options)
  const missing = analyzed.requiredSecrets.filter((name) => environment[name] === undefined)
  if (missing.length > 0) {
    throw new RolekitConfigError(
      'missing_secret',
      `Missing required environment values: ${missing.join(', ')}.`,
      { sourcePath: options.sourcePath, pointer: options.basePointer },
    )
  }

  function resolveValue(candidate: unknown): JsonValue {
    const name = environmentRef(candidate)
    if (name !== undefined) {
      return environment[name] as string
    }
    if (candidate === null || typeof candidate !== 'object') {
      return candidate as JsonValue
    }
    if (Array.isArray(candidate)) {
      return candidate.map(resolveValue)
    }
    return Object.fromEntries(
      Object.entries(candidate).map(([key, entry]) => [key, resolveValue(entry)]),
    )
  }

  return {
    rawOptions: freezeJsonSnapshot(
      resolveValue(analyzed.normalizedConfig),
      'Resolved adapter options',
    ) as unknown as TConfig,
    publicOptionContext: analyzed.publicOptionContext,
    requiredSecrets: analyzed.requiredSecrets,
    literalSecretValues: analyzed.literalSecretValues,
  }
}

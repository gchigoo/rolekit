import { RolekitError } from '../../core/errors.ts'
import {
  canonicalJson,
  cloneJsonValue,
  normalizeJsonSchema,
  type PortableJsonSchema,
} from '../../core/json.ts'
import type {
  EvidenceKind,
  EvidenceRef,
  ExecutionError,
  ExecutorArtifact,
  ExecutorResponse,
  JsonObject,
  JsonSchema,
  JsonValue,
  RunStatus,
} from '../../core/types.ts'
import { RUN_STATUSES } from '../../core/types.ts'

export interface CodexWireArtifact {
  readonly name: string
  readonly kind: string
  readonly uri: string | null
  readonly contentJson: string | null
  readonly mediaType: string | null
}

export interface CodexWireEvidence {
  readonly kind: 'command' | 'file' | 'url' | 'note'
  readonly value: string
  readonly description: string | null
}

export interface CodexWireError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly detailsJson: string | null
}

interface SchemaViolation {
  readonly path: string
  readonly reason: string
}

interface LocalReference {
  readonly path: string
  readonly value: string
}

interface SchemaDefinition {
  readonly path: string
  readonly value: Readonly<Record<string, unknown>>
}

const MAX_OBJECT_DEPTH = 5
const MAX_OBJECT_PROPERTIES = 100
const MAX_ENUM_VALUES = 500
const MAX_LARGE_STRING_ENUM_CHARACTERS = 7_500
const LARGE_STRING_ENUM_THRESHOLD = 250

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$defs',
  '$ref',
  'additionalProperties',
  'anyOf',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'title',
  'type',
])

const SUPPORTED_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
])

const EVIDENCE_KINDS = new Set<EvidenceKind>(['command', 'file', 'url', 'note'])
const RUN_STATUS_SET = new Set<RunStatus>(RUN_STATUSES)

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(path: string, key: string): string {
  return `${path}/${pointerSegment(key)}`
}

function displayPath(path: string): string {
  return path.length === 0 ? '/' : path
}

function resolveLocalReference(
  root: Readonly<Record<string, unknown>>,
  reference: string,
): { readonly path: string; readonly value: unknown } | undefined {
  if (reference === '#') {
    return { path: '', value: root }
  }
  if (!reference.startsWith('#/')) {
    return undefined
  }

  let current: unknown = root
  let path = ''
  for (const encoded of reference.slice(2).split('/')) {
    if (/~(?:[^01]|$)/u.test(encoded)) {
      return undefined
    }
    const decoded = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    path = childPath(path, decoded)
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(decoded)) {
        return undefined
      }
      const index = Number(decoded)
      if (!Number.isSafeInteger(index) || index >= current.length) {
        return undefined
      }
      current = current[index]
      continue
    }
    if (!isRecord(current) || !Object.hasOwn(current, decoded)) {
      return undefined
    }
    current = current[decoded]
  }
  return { path, value: current }
}

function schemaProfileViolations(schema: PortableJsonSchema): readonly SchemaViolation[] {
  const violations: SchemaViolation[] = []
  const violationKeys = new Set<string>()
  const references: LocalReference[] = []
  const definitions: SchemaDefinition[] = []
  const schemaNodePaths = new Map<object, string>()
  let propertyCount = 0
  let enumValueCount = 0

  const addViolation = (path: string, reason: string): void => {
    const displayedPath = displayPath(path)
    const key = `${displayedPath}\0${reason}`
    if (!violationKeys.has(key)) {
      violationKeys.add(key)
      violations.push({ path: displayedPath, reason })
    }
  }

  const visit = (value: unknown, path: string, root: boolean): void => {
    if (!isRecord(value)) {
      addViolation(path, 'must be a JSON Schema object')
      return
    }
    schemaNodePaths.set(value, path)

    for (const key of Object.keys(value)) {
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        addViolation(childPath(path, key), 'uses an unsupported structured-output keyword')
      }
    }

    for (const annotation of ['title', 'description'] as const) {
      if (value[annotation] !== undefined && typeof value[annotation] !== 'string') {
        addViolation(childPath(path, annotation), 'must be a string')
      }
    }

    const reference = value.$ref
    const anyOf = value.anyOf
    const type = value.type
    const enumValues = value.enum
    const structuralKeywords = [
      reference === undefined ? undefined : '$ref',
      anyOf === undefined ? undefined : 'anyOf',
      type === undefined ? undefined : 'type',
      enumValues === undefined ? undefined : 'enum',
    ].filter((entry): entry is string => entry !== undefined)

    if (structuralKeywords.length === 0) {
      addViolation(path, 'must declare type, enum, anyOf, or $ref')
    }
    if (reference !== undefined && structuralKeywords.length > 1) {
      addViolation(childPath(path, '$ref'), 'cannot be combined with another schema form')
    }
    if (anyOf !== undefined && structuralKeywords.some((keyword) => keyword !== 'anyOf')) {
      addViolation(childPath(path, 'anyOf'), 'cannot be combined with another schema form')
    }

    if (reference !== undefined) {
      const referencePath = childPath(path, '$ref')
      if (typeof reference !== 'string') {
        addViolation(referencePath, 'must be a string')
      } else if (reference !== '#' && !reference.startsWith('#/')) {
        addViolation(referencePath, 'must be a local JSON Pointer reference')
      } else {
        references.push({ path: referencePath, value: reference })
      }
    }

    if (root) {
      if (anyOf !== undefined) {
        addViolation(childPath(path, 'anyOf'), 'is not supported at the root')
      }
      if (type !== 'object') {
        addViolation(childPath(path, 'type'), 'must be object at the root')
      }
    }

    if (type !== undefined && (typeof type !== 'string' || !SUPPORTED_TYPES.has(type))) {
      addViolation(
        childPath(path, 'type'),
        'must be one supported primitive, array, or object type',
      )
    }

    if (enumValues !== undefined) {
      if (!Array.isArray(enumValues) || enumValues.length === 0) {
        addViolation(childPath(path, 'enum'), 'must be a non-empty array')
      } else {
        enumValueCount += enumValues.length
        if (enumValueCount > MAX_ENUM_VALUES) {
          addViolation(
            childPath(path, 'enum'),
            `exceeds the ${MAX_ENUM_VALUES} total enum-value limit`,
          )
        }
        const canonicalValues = new Set<string>()
        for (let index = 0; index < enumValues.length; index += 1) {
          const enumValue = enumValues[index]
          if (
            enumValue !== null &&
            typeof enumValue !== 'string' &&
            typeof enumValue !== 'number' &&
            typeof enumValue !== 'boolean'
          ) {
            addViolation(
              childPath(childPath(path, 'enum'), String(index)),
              'must be a primitive JSON value',
            )
            continue
          }
          canonicalValues.add(canonicalJson(enumValue, 'Codex enum value'))
        }
        if (canonicalValues.size !== enumValues.length) {
          addViolation(childPath(path, 'enum'), 'must not contain duplicate values')
        }
        if (
          enumValues.length > LARGE_STRING_ENUM_THRESHOLD &&
          enumValues.every((entry) => typeof entry === 'string')
        ) {
          const characterCount = enumValues.reduce(
            (total, entry) => total + (entry as string).length,
            0,
          )
          if (characterCount > MAX_LARGE_STRING_ENUM_CHARACTERS) {
            addViolation(
              childPath(path, 'enum'),
              `exceeds the ${MAX_LARGE_STRING_ENUM_CHARACTERS}-character large-enum limit`,
            )
          }
        }
      }
    }

    if (anyOf !== undefined) {
      if (!Array.isArray(anyOf) || anyOf.length === 0) {
        addViolation(childPath(path, 'anyOf'), 'must be a non-empty array')
      } else {
        for (let index = 0; index < anyOf.length; index += 1) {
          visit(anyOf[index], childPath(childPath(path, 'anyOf'), String(index)), false)
        }
      }
    }

    const definitionMap = value.$defs
    if (definitionMap !== undefined) {
      const definitionsPath = childPath(path, '$defs')
      if (!isRecord(definitionMap)) {
        addViolation(definitionsPath, 'must be an object of schema definitions')
      } else {
        for (const [name, definition] of Object.entries(definitionMap)) {
          const definitionPath = childPath(definitionsPath, name)
          if (isRecord(definition)) {
            definitions.push({ path: definitionPath, value: definition })
          }
          visit(definition, definitionPath, false)
        }
      }
    }

    if (type === 'object') {
      const properties = value.properties
      const required = value.required
      if (!isRecord(properties)) {
        addViolation(childPath(path, 'properties'), 'must be an object')
      } else {
        const propertyNames = Object.keys(properties)
        propertyCount += propertyNames.length
        if (propertyCount > MAX_OBJECT_PROPERTIES) {
          addViolation(
            childPath(path, 'properties'),
            `exceeds the ${MAX_OBJECT_PROPERTIES} total object-property limit`,
          )
        }
        for (const [name, propertySchema] of Object.entries(properties)) {
          visit(propertySchema, childPath(childPath(path, 'properties'), name), false)
        }

        if (!Array.isArray(required) || required.some((entry) => typeof entry !== 'string')) {
          addViolation(childPath(path, 'required'), 'must list every object property')
        } else {
          const requiredNames = required as readonly string[]
          if (
            new Set(requiredNames).size !== requiredNames.length ||
            requiredNames.length !== propertyNames.length ||
            propertyNames.some((name) => !requiredNames.includes(name))
          ) {
            addViolation(
              childPath(path, 'required'),
              'must list every object property exactly once',
            )
          }
        }
      }
      if (value.additionalProperties !== false) {
        addViolation(childPath(path, 'additionalProperties'), 'must be false for every object')
      }
    } else {
      for (const keyword of ['properties', 'required', 'additionalProperties'] as const) {
        if (value[keyword] !== undefined) {
          addViolation(childPath(path, keyword), 'is only supported on object schemas')
        }
      }
    }

    if (type === 'array') {
      if (!isRecord(value.items)) {
        addViolation(childPath(path, 'items'), 'must be one schema object')
      } else {
        visit(value.items, childPath(path, 'items'), false)
      }
    } else if (value.items !== undefined) {
      addViolation(childPath(path, 'items'), 'is only supported on array schemas')
    }
  }

  visit(schema, '', true)

  for (const reference of references) {
    const target = resolveLocalReference(schema, reference.value)
    if (
      target === undefined ||
      !isRecord(target.value) ||
      schemaNodePaths.get(target.value) !== target.path
    ) {
      addViolation(reference.path, 'does not resolve to a local schema object')
    }
  }

  const visitDepth = (
    value: unknown,
    path: string,
    objectDepth: number,
    activeReferences: Set<object>,
  ): void => {
    if (!isRecord(value)) {
      return
    }

    if (typeof value.$ref === 'string') {
      const target = resolveLocalReference(schema, value.$ref)
      if (
        target === undefined ||
        !isRecord(target.value) ||
        schemaNodePaths.get(target.value) !== target.path
      ) {
        return
      }
      if (activeReferences.has(target.value)) {
        addViolation(childPath(path, '$ref'), 'forms a recursive reference with unbounded depth')
        return
      }
      const nextReferences = new Set(activeReferences)
      nextReferences.add(target.value)
      visitDepth(target.value, target.path, objectDepth, nextReferences)
      return
    }

    if (Array.isArray(value.anyOf)) {
      for (let index = 0; index < value.anyOf.length; index += 1) {
        visitDepth(
          value.anyOf[index],
          childPath(childPath(path, 'anyOf'), String(index)),
          objectDepth,
          activeReferences,
        )
      }
    }

    let nextDepth = objectDepth
    if (value.type === 'object') {
      nextDepth += 1
      if (nextDepth > MAX_OBJECT_DEPTH) {
        addViolation(
          childPath(path, 'type'),
          `exceeds the supported object nesting depth of ${MAX_OBJECT_DEPTH}`,
        )
        return
      }
      if (isRecord(value.properties)) {
        for (const [name, propertySchema] of Object.entries(value.properties)) {
          visitDepth(
            propertySchema,
            childPath(childPath(path, 'properties'), name),
            nextDepth,
            activeReferences,
          )
        }
      }
    } else if (value.type === 'array') {
      visitDepth(value.items, childPath(path, 'items'), nextDepth, activeReferences)
    }
  }

  visitDepth(schema, '', 0, new Set<object>([schema]))
  for (const definition of definitions) {
    visitDepth(definition.value, definition.path, 0, new Set<object>([definition.value]))
  }
  return violations
}

function rawReferenceViolations(value: unknown): readonly SchemaViolation[] {
  const violations: SchemaViolation[] = []
  const root = isRecord(value) ? value : undefined
  const visit = (candidate: unknown, path: string): void => {
    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        visit(candidate[index], childPath(path, String(index)))
      }
      return
    }
    if (!isRecord(candidate)) {
      return
    }
    for (const [key, entry] of Object.entries(candidate)) {
      const entryPath = childPath(path, key)
      if (key === '$ref' && typeof entry === 'string') {
        if (entry !== '#' && !entry.startsWith('#/')) {
          violations.push({
            path: displayPath(entryPath),
            reason: 'must be a local JSON Pointer reference',
          })
        } else if (root !== undefined && resolveLocalReference(root, entry) === undefined) {
          violations.push({
            path: displayPath(entryPath),
            reason: 'does not resolve as a strict local JSON Pointer',
          })
        }
      }
      visit(entry, entryPath)
    }
  }
  visit(value, '')
  return violations
}

function throwSchemaViolations(violations: readonly SchemaViolation[]): never {
  throw new RolekitError(
    'unsupported_output_schema',
    `Codex output schema is outside the supported strict structured-output profile: ${violations
      .map((violation) => `${violation.path} ${violation.reason}`)
      .join('; ')}.`,
    {
      violations: violations.map((violation) => ({
        path: violation.path,
        reason: violation.reason,
      })),
    },
  )
}

export function assertCodexOutputSchemaCompatible(schema: JsonSchema): void {
  const rawReferences = rawReferenceViolations(schema)
  if (rawReferences.length > 0) {
    throwSchemaViolations(rawReferences)
  }

  const normalized = normalizeJsonSchema(schema, 'Codex output schema')
  const violations = schemaProfileViolations(normalized)
  if (violations.length > 0) {
    throwSchemaViolations(violations)
  }
}

function rebaseLocalReferences(value: JsonValue, rootLocation: string): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rebaseLocalReferences(entry, rootLocation))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === '$ref' && typeof entry === 'string') {
        if (entry === '#') {
          return [key, rootLocation]
        }
        if (entry.startsWith('#/')) {
          return [key, `${rootLocation}${entry.slice(1)}`]
        }
      }
      return [key, rebaseLocalReferences(entry, rootLocation)]
    }),
  )
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: 'null' }] }
}

const CodexWireArtifactSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    kind: { type: 'string' },
    uri: nullable({ type: 'string' }),
    contentJson: nullable({ type: 'string' }),
    mediaType: nullable({ type: 'string' }),
  },
  required: ['name', 'kind', 'uri', 'contentJson', 'mediaType'],
}

const CodexWireEvidenceSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['command', 'file', 'url', 'note'] },
    value: { type: 'string' },
    description: nullable({ type: 'string' }),
  },
  required: ['kind', 'value', 'description'],
}

const CodexWireErrorSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    retryable: { type: 'boolean' },
    detailsJson: nullable({ type: 'string' }),
  },
  required: ['code', 'message', 'retryable', 'detailsJson'],
}

export function createCodexWireResponseSchema(outputSchema: JsonSchema): JsonSchema {
  assertCodexOutputSchemaCompatible(outputSchema)
  const normalizedOutput = normalizeJsonSchema(outputSchema, 'Codex role output schema')
  const roleOutputLocation = '#/$defs/roleOutput'
  const embeddedOutput = rebaseLocalReferences(normalizedOutput, roleOutputLocation)
  if (!isRecord(embeddedOutput)) {
    throw new Error('Codex role output schema embedding did not produce an object.')
  }

  const wireSchema = normalizeJsonSchema(
    {
      $defs: {
        roleOutput: embeddedOutput,
      },
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: [...RUN_STATUSES] },
        summary: { type: 'string' },
        output: nullable({ $ref: roleOutputLocation }),
        artifacts: { type: 'array', items: CodexWireArtifactSchema },
        evidence: { type: 'array', items: CodexWireEvidenceSchema },
        error: nullable(CodexWireErrorSchema),
      },
      required: ['status', 'summary', 'output', 'artifacts', 'evidence', 'error'],
    },
    'Codex wire response schema',
  )
  assertCodexOutputSchemaCompatible(wireSchema)
  return wireSchema
}

function failWire(path: string, reason: string): never {
  throw new Error(`Codex wire response ${displayPath(path)} ${reason}.`)
}

function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    failWire(path, 'must be an object')
  }
  return value
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  path: string,
  expected: readonly string[],
): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    failWire(path, `must contain exactly these required fields: ${expected.join(', ')}`)
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    failWire(path, 'must be a string')
  }
  return value
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null
  }
  return requireString(value, path)
}

function parsePortableJson(value: string, path: string): JsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    failWire(path, 'must contain valid JSON text')
  }

  try {
    return cloneJsonValue(parsed, `Codex wire response ${displayPath(path)}`) as JsonValue
  } catch {
    failWire(path, 'must contain portable JSON text')
  }
}

function parseWireArtifact(value: unknown, index: number): ExecutorArtifact {
  const path = `/artifacts/${index}`
  const record = requireRecord(value, path)
  requireExactKeys(record, path, ['name', 'kind', 'uri', 'contentJson', 'mediaType'])
  const uri = nullableString(record.uri, `${path}/uri`)
  const contentJson = nullableString(record.contentJson, `${path}/contentJson`)
  const mediaType = nullableString(record.mediaType, `${path}/mediaType`)
  if (uri === null && contentJson === null) {
    failWire(path, 'must include uri or contentJson')
  }
  const base = {
    name: requireString(record.name, `${path}/name`),
    kind: requireString(record.kind, `${path}/kind`),
    ...(mediaType === null ? {} : { mediaType }),
  }
  return contentJson === null
    ? { ...base, uri: uri as string }
    : {
        ...base,
        ...(uri === null ? {} : { uri }),
        content: parsePortableJson(contentJson, `${path}/contentJson`),
      }
}

function parseWireEvidence(value: unknown, index: number): EvidenceRef {
  const path = `/evidence/${index}`
  const record = requireRecord(value, path)
  requireExactKeys(record, path, ['kind', 'value', 'description'])
  const kind = requireString(record.kind, `${path}/kind`)
  if (!EVIDENCE_KINDS.has(kind as EvidenceKind)) {
    failWire(`${path}/kind`, 'must be command, file, url, or note')
  }
  const description = nullableString(record.description, `${path}/description`)
  return {
    kind: kind as EvidenceKind,
    value: requireString(record.value, `${path}/value`),
    ...(description === null ? {} : { description }),
  }
}

function parseWireError(value: unknown): ExecutionError | undefined {
  if (value === null) {
    return undefined
  }
  const path = '/error'
  const record = requireRecord(value, path)
  requireExactKeys(record, path, ['code', 'message', 'retryable', 'detailsJson'])
  if (typeof record.retryable !== 'boolean') {
    failWire(`${path}/retryable`, 'must be a boolean')
  }
  const detailsJson = nullableString(record.detailsJson, `${path}/detailsJson`)
  let details: JsonObject | undefined
  if (detailsJson !== null) {
    const parsed = parsePortableJson(detailsJson, `${path}/detailsJson`)
    if (!isRecord(parsed)) {
      failWire(`${path}/detailsJson`, 'must encode a JSON object')
    }
    details = parsed as JsonObject
  }
  return {
    code: requireString(record.code, `${path}/code`),
    message: requireString(record.message, `${path}/message`),
    retryable: record.retryable,
    ...(details === undefined ? {} : { details }),
  }
}

export function parseCodexWireResponse(value: unknown): ExecutorResponse {
  const record = requireRecord(value, '')
  requireExactKeys(record, '', ['status', 'summary', 'output', 'artifacts', 'evidence', 'error'])
  const status = requireString(record.status, '/status')
  if (!RUN_STATUS_SET.has(status as RunStatus)) {
    failWire('/status', `must be one of ${RUN_STATUSES.join(', ')}`)
  }
  if (!Array.isArray(record.artifacts)) {
    failWire('/artifacts', 'must be an array')
  }
  if (!Array.isArray(record.evidence)) {
    failWire('/evidence', 'must be an array')
  }

  const output =
    record.output === null
      ? undefined
      : cloneJsonValue(record.output, 'Codex wire response /output')
  const error = parseWireError(record.error)
  return {
    status: status as RunStatus,
    summary: requireString(record.summary, '/summary'),
    ...(output === undefined ? {} : { output }),
    artifacts: record.artifacts.map(parseWireArtifact),
    evidence: record.evidence.map(parseWireEvidence),
    ...(error === undefined ? {} : { error }),
  } as unknown as ExecutorResponse
}

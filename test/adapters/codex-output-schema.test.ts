import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Type } from '@sinclair/typebox'

import {
  assertCodexOutputSchemaCompatible,
  createCodexWireResponseSchema,
  parseCodexWireResponse,
} from '../../src/adapters/codex/output-schema.ts'
import { RolekitError } from '../../src/core/errors.ts'
import type { JsonSchema } from '../../src/core/types.ts'

describe('Codex structured output schema', () => {
  it('creates a single root object without root anyOf', () => {
    const schema = createCodexWireResponseSchema(
      Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }),
    )
    assert.equal(schema.type, 'object')
    assert.equal(Object.hasOwn(schema, 'anyOf'), false)
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual(
      new Set(schema.required as string[]),
      new Set(Object.keys(schema.properties as object)),
    )
  })

  it('rejects role output schemas outside the supported structured-output subset', () => {
    const optionalProperty = Type.Object(
      { maybe: Type.Optional(Type.String()) },
      { additionalProperties: false },
    )
    assert.throws(() => assertCodexOutputSchemaCompatible(optionalProperty), /required/u)
  })

  it('uses the strict nullable wire fields and excludes model-reported usage and identity', () => {
    const schema = createCodexWireResponseSchema(
      Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }),
    )
    const properties = schema.properties as Readonly<Record<string, JsonSchema>>

    assert.deepEqual(Object.keys(properties), [
      'status',
      'summary',
      'output',
      'artifacts',
      'evidence',
      'error',
    ])
    for (const excluded of ['usage', 'provider', 'model', 'version']) {
      assert.equal(Object.hasOwn(properties, excluded), false, excluded)
    }
    const outputAnyOf = properties.output?.anyOf as readonly JsonSchema[]
    assert.equal(outputAnyOf.length, 2)
    assert.match(outputAnyOf[0]?.$ref as string, /^#/u)
    assert.deepEqual(outputAnyOf[1], { type: 'null' })
  })

  it('accepts local definitions, local references, enums, arrays, and nested anyOf', () => {
    const supported: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        item: { $ref: '#/$defs/item' },
        choice: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        tags: {
          type: 'array',
          items: { type: 'string', enum: ['one', 'two'] },
        },
      },
      required: ['item', 'choice', 'tags'],
      $defs: {
        item: {
          type: 'object',
          additionalProperties: false,
          properties: { value: { type: 'integer' } },
          required: ['value'],
        },
      },
    }

    assert.doesNotThrow(() => assertCodexOutputSchemaCompatible(supported))
    assert.doesNotThrow(() => createCodexWireResponseSchema(supported))
  })

  it('rejects malformed local JSON Pointer escapes and array indices', () => {
    for (const reference of [
      '#/$defs/bad~2escape',
      '#/$defs/options/anyOf/01',
      '#/$defs/options/anyOf/1e0',
      '#/$defs/options/anyOf/',
    ]) {
      const schema: JsonSchema = {
        type: 'object',
        additionalProperties: false,
        properties: { value: { $ref: reference } },
        required: ['value'],
        $defs: {
          'bad~2escape': { type: 'string' },
          options: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
        },
      }

      assert.throws(
        () => assertCodexOutputSchemaCompatible(schema),
        /\/properties\/value\/\$ref/u,
        reference,
      )
    }
  })

  it('rejects local references to non-schema containers', () => {
    for (const reference of [
      '#/properties',
      '#/required',
      '#/$defs',
      '#/properties/nested/properties',
      '#/properties/choice/anyOf',
    ]) {
      const schema: JsonSchema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: { $ref: reference },
          nested: {
            type: 'object',
            additionalProperties: false,
            properties: { leaf: { type: 'string' } },
            required: ['leaf'],
          },
          choice: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['value', 'nested', 'choice'],
        $defs: { leaf: { type: 'string' } },
      }

      assert.throws(
        () => assertCodexOutputSchemaCompatible(schema),
        /\/properties\/value\/\$ref/u,
        reference,
      )
    }
  })

  it('reports exact paths for unsupported keywords, remote references, and non-strict objects', () => {
    for (const [schema, path] of [
      [
        {
          type: 'object',
          additionalProperties: false,
          properties: { value: { allOf: [{ type: 'string' }] } },
          required: ['value'],
        },
        '/properties/value/allOf',
      ],
      [
        {
          type: 'object',
          additionalProperties: false,
          properties: { value: { $ref: 'https://example.com/value.schema.json' } },
          required: ['value'],
        },
        '/properties/value/$ref',
      ],
      [
        {
          type: 'object',
          additionalProperties: true,
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
        '/additionalProperties',
      ],
    ] as const) {
      assert.throws(
        () => assertCodexOutputSchemaCompatible(schema),
        (error: unknown) => {
          assert.ok(error instanceof RolekitError)
          assert.equal(error.code, 'unsupported_output_schema')
          assert.ok(error.message.includes(path), error.message)
          return true
        },
      )
    }
  })

  it('enforces the documented property and nesting limits conservatively', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`field${index}`, { type: 'string' }]),
    )
    assert.throws(
      () =>
        assertCodexOutputSchemaCompatible({
          type: 'object',
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        }),
      /100|properties/u,
    )

    let nested: JsonSchema = { type: 'string' }
    for (let depth = 0; depth < 6; depth += 1) {
      nested = {
        type: 'object',
        additionalProperties: false,
        properties: { value: nested },
        required: ['value'],
      }
    }
    assert.throws(() => assertCodexOutputSchemaCompatible(nested), /depth|nesting/u)
  })

  it('validates depth and recursion in every unreferenced definition before emitting it', () => {
    let deepDefinition: JsonSchema = { type: 'string' }
    for (let depth = 0; depth < 6; depth += 1) {
      deepDefinition = {
        type: 'object',
        additionalProperties: false,
        properties: { value: deepDefinition },
        required: ['value'],
      }
    }
    const unreferencedDeep: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
      $defs: { deep: deepDefinition },
    }
    const unreferencedRecursive: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
      $defs: { loop: { $ref: '#/$defs/loop' } },
    }

    for (const validate of [
      assertCodexOutputSchemaCompatible,
      createCodexWireResponseSchema,
    ] as const) {
      assert.throws(() => validate(unreferencedDeep), /\/\$defs\/deep.*depth|nesting/u)
      assert.throws(() => validate(unreferencedRecursive), /\/\$defs\/loop\/\$ref.*recursive/u)
    }
  })

  it('parses completed wire responses and decodes artifact JSON text', () => {
    const response = parseCodexWireResponse({
      status: 'completed',
      summary: 'Completed.',
      output: { ok: true },
      artifacts: [
        {
          name: 'report',
          kind: 'json',
          uri: null,
          contentJson: '{"count":1}',
          mediaType: 'application/json',
        },
      ],
      evidence: [{ kind: 'note', value: 'fixture', description: null }],
      error: null,
    })

    assert.deepEqual(response, {
      status: 'completed',
      summary: 'Completed.',
      output: { ok: true },
      artifacts: [
        {
          name: 'report',
          kind: 'json',
          content: { count: 1 },
          mediaType: 'application/json',
        },
      ],
      evidence: [{ kind: 'note', value: 'fixture' }],
    })
  })

  it('parses non-completed wire errors and decodes details JSON text', () => {
    const response = parseCodexWireResponse({
      status: 'blocked',
      summary: 'Blocked.',
      output: null,
      artifacts: [],
      evidence: [{ kind: 'file', value: 'policy.json', description: 'Policy source' }],
      error: {
        code: 'policy_blocked',
        message: 'Policy blocked execution.',
        retryable: false,
        detailsJson: '{"reason":"policy"}',
      },
    })

    assert.deepEqual(response, {
      status: 'blocked',
      summary: 'Blocked.',
      artifacts: [],
      evidence: [{ kind: 'file', value: 'policy.json', description: 'Policy source' }],
      error: {
        code: 'policy_blocked',
        message: 'Policy blocked execution.',
        retryable: false,
        details: { reason: 'policy' },
      },
    })
  })

  it('accepts portable JSON text regardless of ordering, whitespace, escapes, or number form', () => {
    const completed = parseCodexWireResponse({
      status: 'completed',
      summary: 'Completed.',
      output: { ok: true },
      artifacts: [
        {
          name: 'report',
          kind: 'json',
          uri: null,
          contentJson: '{\n  "z": 1e0,\n  "a": "\\u0061"\n}',
          mediaType: null,
        },
      ],
      evidence: [],
      error: null,
    })
    assert.deepEqual(completed.artifacts[0]?.content, { z: 1, a: 'a' })

    const blocked = parseCodexWireResponse({
      status: 'blocked',
      summary: 'Blocked.',
      output: null,
      artifacts: [],
      evidence: [],
      error: {
        code: 'blocked',
        message: 'Blocked.',
        retryable: false,
        detailsJson: ' { "z": -0, "a": "\\u0062" } ',
      },
    })
    assert.deepEqual(blocked.error?.details, { z: 0, a: 'b' })
  })

  it('rejects malformed encoded JSON after Codex exits', () => {
    assert.throws(
      () =>
        parseCodexWireResponse({
          status: 'completed',
          summary: 'Completed.',
          output: { ok: true },
          artifacts: [
            {
              name: 'report',
              kind: 'json',
              uri: null,
              contentJson: 'not-json',
              mediaType: null,
            },
          ],
          evidence: [],
          error: null,
        }),
      /contentJson|JSON/u,
    )
  })
})

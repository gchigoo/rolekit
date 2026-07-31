import type { TSchema } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { schemaRegistry } from './schema-registry.ts'
import type { ValidationIssue, ValidationResult } from './types.ts'

const compilers = new Map<string, ReturnType<typeof TypeCompiler.Compile>>()

/**
 * Returns a cached TypeCompiler for the given schema kind.
 */
function getCompiler(kind: string, schema: TSchema) {
  let compiler = compilers.get(kind)
  if (!compiler) {
    compiler = TypeCompiler.Compile(schema)
    compilers.set(kind, compiler)
  }
  return compiler
}

/**
 * Type guard for KnowledgeEntry validate payload.
 */
function isKnowledgePayload(data: unknown): data is { frontmatter: unknown; body: string } {
  if (data === null || typeof data !== 'object') {
    return false
  }
  const record = data as Record<string, unknown>
  return 'frontmatter' in record && typeof record.body === 'string'
}

/**
 * Validates a parsed artifact against a registered schema kind.
 * Structural failure short-circuits; semantic rules run only after structure passes.
 */
export function validateArtifact(kind: string, data: unknown): ValidationResult {
  if (typeof kind !== 'string' || kind.length === 0 || !schemaRegistry.has(kind)) {
    return {
      valid: false,
      code: 'unknown_schema',
      issues: [
        {
          layer: 'structural',
          path: '/schema',
          message: kind ? `unknown schema kind: ${kind}` : 'missing schema kind',
        },
      ],
    }
  }

  const entry = schemaRegistry.get(kind)
  if (!entry) {
    return {
      valid: false,
      code: 'unknown_schema',
      issues: [
        {
          layer: 'structural',
          path: '/schema',
          message: `unknown schema kind: ${kind}`,
        },
      ],
    }
  }

  let structuralTarget: unknown = data
  let pathPrefix = ''

  if (entry.knowledgePayload) {
    if (!isKnowledgePayload(data)) {
      return {
        valid: false,
        code: 'validation_error',
        issues: [
          {
            layer: 'structural',
            path: '/',
            message: 'KnowledgeEntry payload must be { frontmatter, body }',
          },
        ],
      }
    }
    structuralTarget = data.frontmatter
    pathPrefix = '/frontmatter'
  }

  const compiler = getCompiler(kind, entry.schema)
  if (!compiler.Check(structuralTarget)) {
    const issues: ValidationIssue[] = []
    for (const error of compiler.Errors(structuralTarget)) {
      const path = error.path && error.path.length > 0 ? error.path : '/'
      issues.push({
        layer: 'structural',
        path: pathPrefix && path !== '/' ? `${pathPrefix}${path}` : pathPrefix || path,
        message: error.message,
      })
    }
    return { valid: false, code: 'validation_error', issues }
  }

  const semanticIssues = entry.semanticRules(data)
  if (semanticIssues.length > 0) {
    return {
      valid: false,
      code: 'validation_error',
      issues: semanticIssues.map((issue) => ({
        layer: 'semantic' as const,
        path: issue.path,
        message: issue.message,
      })),
    }
  }

  return { valid: true }
}

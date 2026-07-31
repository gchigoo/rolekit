import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { ResultStatusSchema } from './shared.ts'

/**
 * ResultEnvelope schema — roadmap 4.2.
 */
export const ResultEnvelopeSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/result-envelope@1'),
    task_id: Type.String({ minLength: 1 }),
    status: ResultStatusSchema,
    summary: Type.String(),
    changed_files: Type.Array(Type.String()),
    verification: Type.Array(
      Type.Object({
        command: Type.String(),
        exit_code: Type.Number(),
      }),
    ),
    scope_violations: Type.Array(Type.String()),
    decisions: Type.Array(Type.String()),
    assumptions: Type.Array(Type.String()),
    evidence: Type.Array(Type.String()),
    risks: Type.Array(Type.String()),
    unresolved: Type.Array(Type.String()),
    recommended_next_action: Type.String(),
  },
  { $id: 'rolekit/result-envelope@1', additionalProperties: false },
)

export type ResultEnvelope = Static<typeof ResultEnvelopeSchema>

/**
 * Semantic rules for ResultEnvelope (D7.2).
 */
export function semanticRules(data: ResultEnvelope): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  if (data.status !== 'completed' && data.unresolved.length === 0) {
    issues.push({
      path: '/unresolved',
      message: 'status other than completed requires non-empty unresolved',
    })
  }
  if (data.scope_violations.length > 0 && data.status === 'completed') {
    issues.push({
      path: '/status',
      message: 'non-empty scope_violations requires status other than completed',
    })
  }
  return issues
}

import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { noSemanticRules, ResultStatusSchema } from './shared.ts'

/**
 * ExecutorReport schema — roadmap 4.3.
 * Envelope minus verification/scope_violations, with its own schema literal.
 */
export const ExecutorReportSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/executor-report@1'),
    task_id: Type.String({ minLength: 1 }),
    status: ResultStatusSchema,
    summary: Type.String(),
    changed_files: Type.Array(Type.String()),
    decisions: Type.Array(Type.String()),
    assumptions: Type.Array(Type.String()),
    evidence: Type.Array(Type.String()),
    risks: Type.Array(Type.String()),
    unresolved: Type.Array(Type.String()),
    recommended_next_action: Type.String(),
  },
  { $id: 'rolekit/executor-report@1', additionalProperties: false },
)

export type ExecutorReport = Static<typeof ExecutorReportSchema>

/** ExecutorReport has no D7 semantic rules (D8). */
export const semanticRules: (data: ExecutorReport) => SemanticIssue[] = noSemanticRules

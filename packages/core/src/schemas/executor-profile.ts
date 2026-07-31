import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { noSemanticRules } from './shared.ts'

/**
 * ExecutorProfile schema — roadmap 4.7.
 * adapter is a non-empty string with NO enum (runner registry validates names).
 */
export const ExecutorProfileSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/executor-profile@1'),
    name: Type.String({ minLength: 1 }),
    adapter: Type.String({ minLength: 1 }),
    model: Type.Optional(Type.String()),
    settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'rolekit/executor-profile@1', additionalProperties: false },
)

export type ExecutorProfile = Static<typeof ExecutorProfileSchema>

/** ExecutorProfile has no D7 semantic rules (D8); empty adapter is structural. */
export const semanticRules: (data: ExecutorProfile) => SemanticIssue[] = noSemanticRules

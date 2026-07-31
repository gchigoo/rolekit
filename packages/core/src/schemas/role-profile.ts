import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { noSemanticRules } from './shared.ts'

/**
 * RoleProfile schema — roadmap 4.7.
 */
export const RoleProfileSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/role-profile@1'),
    name: Type.String({ minLength: 1 }),
    capabilities: Type.Array(Type.String()),
    boundaries: Type.Array(Type.String()),
    deliverables: Type.Array(Type.String()),
    verification: Type.Array(Type.String()),
    prompt_fragments: Type.Array(Type.String()),
  },
  { $id: 'rolekit/role-profile@1', additionalProperties: false },
)

export type RoleProfile = Static<typeof RoleProfileSchema>

/** RoleProfile has no D7 semantic rules (D8). */
export const semanticRules: (data: RoleProfile) => SemanticIssue[] = noSemanticRules

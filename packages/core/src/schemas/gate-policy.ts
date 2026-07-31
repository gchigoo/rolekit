import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { GateActionSchema, noSemanticRules } from './shared.ts'

/**
 * GatePolicy schema — roadmap 4.6.
 */
export const GatePolicySchema = Type.Object(
  {
    schema: Type.Literal('rolekit/gate-policy@1'),
    default_action: Type.Union([Type.Literal('ignore'), Type.Literal('observe')]),
    triggers: Type.Object(
      {
        'new-dependency': GateActionSchema,
        migration: GateActionSchema,
        'public-api-change': GateActionSchema,
        delete: GateActionSchema,
        'scope-violation': GateActionSchema,
        'ambiguous-requirement': GateActionSchema,
        'design-artifact': GateActionSchema,
        'final-acceptance': GateActionSchema,
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'rolekit/gate-policy@1', additionalProperties: false },
)

export type GatePolicy = Static<typeof GatePolicySchema>

/** GatePolicy has no D7 semantic rules (D8). */
export const semanticRules: (data: GatePolicy) => SemanticIssue[] = noSemanticRules

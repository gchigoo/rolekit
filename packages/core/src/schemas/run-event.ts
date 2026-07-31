import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import {
  EscalationActionSchema,
  GateActionSchema,
  noSemanticRules,
  ResultStatusSchema,
} from './shared.ts'

const RunEventBase = {
  schema: Type.Literal('rolekit/run-event@1'),
  ts: Type.String({ minLength: 1 }),
  run_id: Type.String({ minLength: 1 }),
}

/**
 * RunEvent discriminated union on `type` — roadmap 4.4 (7 variants).
 */
export const RunEventSchema = Type.Union(
  [
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('started'),
        payload: Type.Object({
          task_id: Type.String({ minLength: 1 }),
          adapter: Type.String({ minLength: 1 }),
          worktree: Type.String({ minLength: 1 }),
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('tool_call'),
        payload: Type.Object({
          name: Type.String({ minLength: 1 }),
          args_digest: Type.String({ minLength: 1 }),
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('message'),
        payload: Type.Object({
          role: Type.Union([Type.Literal('worker'), Type.Literal('system')]),
          text: Type.String(),
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('gate'),
        payload: Type.Object({
          gate: Type.String({ minLength: 1 }),
          action: GateActionSchema,
          decision: Type.Union([
            Type.Literal('auto-pass'),
            Type.Literal('human-required'),
            Type.Literal('blocked'),
          ]),
          evidence: Type.String(),
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('verification'),
        payload: Type.Object({
          command: Type.String({ minLength: 1 }),
          exit_code: Type.Number(),
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('escalation'),
        payload: Type.Object({
          rule: Type.Union([
            Type.Literal('on_scope_change'),
            Type.Literal('on_new_dependency'),
            Type.Literal('on_ambiguous_requirement'),
          ]),
          action: EscalationActionSchema,
          detail: Type.String(),
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...RunEventBase,
        type: Type.Literal('finished'),
        payload: Type.Object({
          status: ResultStatusSchema,
          reason: Type.Union([Type.String(), Type.Null()]),
        }),
      },
      { additionalProperties: false },
    ),
  ],
  { $id: 'rolekit/run-event@1' },
)

export type RunEvent = Static<typeof RunEventSchema>

/** RunEvent has no D7 semantic rules (D8). */
export const semanticRules: (data: RunEvent) => SemanticIssue[] = noSemanticRules

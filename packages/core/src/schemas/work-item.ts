import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { GateActionSchema } from './shared.ts'

const GateOriginSchema = Type.Union([
  Type.Literal('designing'),
  Type.Literal('executing'),
  Type.Literal('verifying'),
])

const WorkItemStatusSchema = Type.Union([
  Type.Literal('planned'),
  Type.Literal('designing'),
  Type.Literal('awaiting-gate'),
  Type.Literal('executing'),
  Type.Literal('verifying'),
  Type.Literal('done'),
  Type.Literal('dropped'),
  Type.Literal('blocked'),
])

/**
 * WorkItem schema — roadmap 4.9 (kind includes goal; gate nullable).
 */
export const WorkItemSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/work-item@1'),
    id: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal('feature'),
      Type.Literal('issue'),
      Type.Literal('refactor'),
      Type.Literal('research'),
      Type.Literal('goal'),
    ]),
    title: Type.String({ minLength: 1 }),
    status: WorkItemStatusSchema,
    gate: Type.Union([
      Type.Object(
        {
          trigger: Type.String({ minLength: 1 }),
          origin: GateOriginSchema,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    gate_log: Type.Array(
      Type.Object(
        {
          trigger: Type.String({ minLength: 1 }),
          action: GateActionSchema,
          decision: Type.Union([
            Type.Literal('auto-pass'),
            Type.Literal('approved'),
            Type.Literal('rejected'),
            Type.Literal('blocked'),
          ]),
          ts: Type.String({ minLength: 1 }),
          recovery_runs_count: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    lane: Type.Union([
      Type.Literal('direct'),
      Type.Literal('delegated'),
      Type.Literal('coordinated'),
      Type.Null(),
    ]),
    lane_reason: Type.Union([Type.String(), Type.Null()]),
    lane_overrides: Type.Array(
      Type.Object(
        {
          by: Type.String({ minLength: 1 }),
          from: Type.String({ minLength: 1 }),
          to: Type.String({ minLength: 1 }),
          reason: Type.String(),
          ts: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    depends_on: Type.Array(Type.String()),
    runs: Type.Array(Type.String()),
    created: Type.String({ minLength: 1 }),
    updated: Type.String({ minLength: 1 }),
  },
  { $id: 'rolekit/work-item@1', additionalProperties: false },
)

export type WorkItem = Static<typeof WorkItemSchema>

/**
 * Semantic rules for WorkItem (D7.1): status=awaiting-gate iff gate non-null.
 */
export function semanticRules(data: WorkItem): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  const awaiting = data.status === 'awaiting-gate'
  const hasGate = data.gate !== null
  if (awaiting && !hasGate) {
    issues.push({
      path: '/gate',
      message: 'status=awaiting-gate requires non-null gate',
    })
  }
  if (!awaiting && hasGate) {
    issues.push({
      path: '/gate',
      message: 'gate must be null when status is not awaiting-gate',
    })
  }
  data.gate_log.forEach((entry, index) => {
    const isRecoveryMarker =
      entry.trigger === 'recovery-cycle' &&
      entry.action === 'observe' &&
      entry.decision === 'auto-pass'
    const hasRecoveryCount = entry.recovery_runs_count !== undefined
    if (isRecoveryMarker && !hasRecoveryCount) {
      issues.push({
        path: `/gate_log/${index}/recovery_runs_count`,
        message: 'recovery-cycle observe auto-pass requires recovery_runs_count',
      })
    }
    if (!isRecoveryMarker && hasRecoveryCount) {
      issues.push({
        path: `/gate_log/${index}/recovery_runs_count`,
        message: 'recovery_runs_count is only allowed on recovery-cycle observe auto-pass',
      })
    }
  })
  return issues
}

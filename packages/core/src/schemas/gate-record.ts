import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'

const GateRecordActionSchema = Type.Union([
  Type.Literal('observe'),
  Type.Literal('confirm'),
  Type.Literal('block'),
])

const GateRecordDecisionSchema = Type.Union([
  Type.Literal('auto-pass'),
  Type.Literal('human-required'),
  Type.Literal('blocked'),
])

const GateResolutionSchema = Type.Object(
  {
    result: Type.Union([
      Type.Literal('approved'),
      Type.Literal('rejected'),
      Type.Literal('cancelled'),
    ]),
    by: Type.String({ minLength: 1 }),
    reason: Type.Optional(Type.String()),
    ts: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

/**
 * Single gate decision record (ignore never persisted).
 */
export const GateRecordSchema = Type.Object(
  {
    trigger: Type.String({ minLength: 1 }),
    action: GateRecordActionSchema,
    decision: GateRecordDecisionSchema,
    hit_paths: Type.Optional(Type.Array(Type.String())),
    evidence: Type.Optional(Type.String()),
    resolution: Type.Optional(GateResolutionSchema),
    ts: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

/**
 * Root gates.json wrapper — rolekit/gate-record@1.
 */
export const GateRecordFileSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/gate-record@1'),
    records: Type.Array(GateRecordSchema),
  },
  { $id: 'rolekit/gate-record@1', additionalProperties: false },
)

export type GateRecord = Static<typeof GateRecordSchema>
export type GateRecordFile = Static<typeof GateRecordFileSchema>
export type GateResolution = Static<typeof GateResolutionSchema>

/**
 * Semantic rules for gate-record root file.
 */
export function semanticRules(data: GateRecordFile): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  data.records.forEach((record, index) => {
    const base = `/records/${index}`
    if (record.action === 'observe' && record.decision !== 'auto-pass') {
      issues.push({
        path: `${base}/decision`,
        message: 'observe records must use decision auto-pass',
      })
    }
    if (record.action === 'block' && record.decision !== 'blocked') {
      issues.push({
        path: `${base}/decision`,
        message: 'block records must use decision blocked',
      })
    }
    if (record.action === 'confirm' && record.decision !== 'human-required') {
      issues.push({
        path: `${base}/decision`,
        message: 'confirm records must use decision human-required',
      })
    }
    if ((record.action === 'observe' || record.action === 'block') && record.resolution) {
      issues.push({
        path: `${base}/resolution`,
        message: 'observe/block records must not carry resolution',
      })
    }
    if (record.action === 'confirm' && record.resolution) {
      const allowed = new Set(['approved', 'rejected', 'cancelled'])
      if (!allowed.has(record.resolution.result)) {
        issues.push({
          path: `${base}/resolution/result`,
          message: 'confirm resolution.result must be approved|rejected|cancelled',
        })
      }
    }
  })
  return issues
}

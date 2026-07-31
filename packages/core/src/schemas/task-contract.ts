import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'
import { EscalationActionSchema, isValidGlobish } from './shared.ts'

/**
 * TaskContract schema — roadmap 4.1.
 */
export const TaskContractSchema = Type.Object(
  {
    schema: Type.Literal('rolekit/task-contract@1'),
    id: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal('implementation'),
      Type.Literal('research'),
      Type.Literal('review'),
      Type.Literal('fix'),
    ]),
    role: Type.String({ minLength: 1 }),
    executor: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
    context: Type.Object({
      required_files: Type.Array(Type.String()),
      docs: Type.Array(Type.String()),
    }),
    scope: Type.Object({
      writable: Type.Array(Type.String()),
      forbidden: Type.Array(Type.String()),
    }),
    constraints: Type.Array(Type.String()),
    deliverables: Type.Array(Type.String()),
    acceptance: Type.Object({
      commands: Type.Array(
        Type.Object({
          run: Type.String({ minLength: 1 }),
          expect_exit: Type.Number(),
        }),
      ),
      assertions: Type.Array(Type.String()),
    }),
    execution: Type.Object({
      worktree: Type.Union([Type.Literal('isolated'), Type.Literal('in-place')]),
      max_tool_calls: Type.Number(),
      network: Type.Union([Type.Literal('deny'), Type.Literal('allow')]),
      timeout_minutes: Type.Number(),
    }),
    escalation: Type.Object({
      on_scope_change: EscalationActionSchema,
      on_new_dependency: EscalationActionSchema,
      on_ambiguous_requirement: EscalationActionSchema,
    }),
  },
  { $id: 'rolekit/task-contract@1', additionalProperties: false },
)

export type TaskContract = Static<typeof TaskContractSchema>

/**
 * Semantic rules for TaskContract (D7.3).
 */
export function semanticRules(data: TaskContract): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  if (data.acceptance.commands.length < 1) {
    issues.push({
      path: '/acceptance/commands',
      message: 'acceptance.commands must contain at least one command',
    })
  }
  data.scope.writable.forEach((pattern, index) => {
    if (!isValidGlobish(pattern)) {
      issues.push({
        path: `/scope/writable/${index}`,
        message: `scope.writable[${index}] is not a valid glob-ish string`,
      })
    }
  })
  data.scope.forbidden.forEach((pattern, index) => {
    if (!isValidGlobish(pattern)) {
      issues.push({
        path: `/scope/forbidden/${index}`,
        message: `scope.forbidden[${index}] is not a valid glob-ish string`,
      })
    }
  })
  return issues
}

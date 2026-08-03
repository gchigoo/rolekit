import {
  createExecutionContract,
  type ExecutionContract,
  type SnapshotRoleSpec,
  type SnapshotTaskPacket,
} from '../../core/index.ts'
import { createExecutorPayloadSchema } from '../../core/schemas.ts'
import type { RoleSpec, TaskPacket } from '../../core/types.ts'

export interface MarkdownExecutionPromptOptions {
  readonly includeFinalResponseSchema: boolean
}

function escapeJsonForPrompt(serialized: string): string {
  return serialized.replace(/[<>&]/gu, (character) => {
    switch (character) {
      case '<':
        return '\\u003c'
      case '>':
        return '\\u003e'
      case '&':
        return '\\u0026'
      default:
        return character
    }
  })
}

export function stringifyPromptJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) {
    throw new TypeError('The execution contract contains a value that cannot be serialized.')
  }
  return escapeJsonForPrompt(serialized)
}

function createPromptContract(role: RoleSpec, task: TaskPacket): ExecutionContract {
  return createExecutionContract(
    role as unknown as SnapshotRoleSpec,
    task as unknown as SnapshotTaskPacket,
  )
}

function block(title: string, value: unknown): string {
  return `## ${title}\n${stringifyPromptJson(value)}`
}

export function renderMarkdownExecutionPrompt(
  contract: ExecutionContract,
  options: MarkdownExecutionPromptOptions,
): string {
  const sections = [
    '# RoleKit execution contract',
    'Execute exactly one task using the supplied role. Respect the task constraints and allowed paths.',
    block('Role', contract.role),
    block('Required capabilities', contract.requiredCapabilities),
    block('Task', contract.task),
    block('Role output JSON Schema', contract.outputContract.roleOutputSchema),
    ...(options.includeFinalResponseSchema
      ? [
          block(
            'Final response JSON Schema',
            createExecutorPayloadSchema(contract.outputContract.roleOutputSchema),
          ),
        ]
      : []),
    [
      '## Final response rules',
      ...contract.outputContract.finalResponseRules.map((rule) => `- ${rule}`),
    ].join('\n'),
  ]
  return `${sections.join('\n\n')}\n`
}

export function buildNeutralExecutionPrompt(role: RoleSpec, task: TaskPacket): string {
  return renderMarkdownExecutionPrompt(createPromptContract(role, task), {
    includeFinalResponseSchema: true,
  })
}

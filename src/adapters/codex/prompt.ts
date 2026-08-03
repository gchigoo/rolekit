import { createExecutionContract } from '../../core/execution-contract.ts'
import type {
  RoleSpec,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TaskPacket,
} from '../../core/types.ts'
import { renderMarkdownExecutionPrompt } from '../cli/prompt.ts'

const CODEX_NATIVE_OUTPUT_RULES = [
  'The `output` field must be null unless status is `completed`.',
  'The `error` field must be null when status is `completed`.',
  '`contentJson` and `detailsJson` contain valid portable JSON text rather than nested arbitrary data.',
  'All fields in the native structured-output schema are required; use null for inapplicable nullable fields.',
] as const

export function buildCodexExecutionPrompt(role: RoleSpec, task: TaskPacket): string {
  const prompt = renderMarkdownExecutionPrompt(
    createExecutionContract(
      role as unknown as SnapshotRoleSpec,
      task as unknown as SnapshotTaskPacket,
    ),
    {
      includeFinalResponseSchema: false,
    },
  )
  return `${prompt}\n## Codex native structured output rules\n${CODEX_NATIVE_OUTPUT_RULES.map((rule) => `- ${rule}`).join('\n')}\n`
}

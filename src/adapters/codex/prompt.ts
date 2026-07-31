import type { RoleSpec, TaskPacket } from '../../core/types.ts'
import { createExecutionPromptContract, renderMarkdownExecutionPrompt } from '../cli/prompt.ts'

export function buildCodexExecutionPrompt(role: RoleSpec, task: TaskPacket): string {
  return renderMarkdownExecutionPrompt(createExecutionPromptContract(role, task), {
    includeFinalResponseSchema: false,
  })
}

import { createExecutorPayloadSchema } from '../../core/schemas.ts'
import type { RoleSpec, TaskPacket } from '../../core/types.ts'

function block(title: string, value: unknown): string {
  return `## ${title}\n${JSON.stringify(value, null, 2)}`
}

export function buildExecutionPrompt(role: RoleSpec, task: TaskPacket): string {
  const sections = [
    '# RoleKit execution contract',
    'Execute exactly one task using the supplied role. Respect the task constraints and allowed paths.',
    `## Role\nID: ${role.id}\nDescription: ${role.description}`,
    `## Role instructions\n${role.instructions ?? 'No additional role instructions.'}`,
    block('Required capabilities', [
      ...new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])]),
    ]),
    block('Task', {
      taskId: task.taskId,
      ...(task.parentTaskId === undefined ? {} : { parentTaskId: task.parentTaskId }),
      objective: task.objective,
      input: task.input,
      context: task.context,
      constraints: task.constraints,
      acceptanceCriteria: task.acceptanceCriteria,
      ...(task.allowedPaths === undefined ? {} : { allowedPaths: task.allowedPaths }),
      expectedArtifacts: task.expectedArtifacts,
      ...(task.metadata === undefined ? {} : { metadata: task.metadata }),
    }),
    block('Role output JSON Schema', role.outputSchema),
    block('Final response JSON Schema', createExecutorPayloadSchema(role.outputSchema)),
    [
      '## Final response rules',
      '- Return exactly one JSON object as the final response.',
      '- Do not wrap the JSON object in Markdown fences.',
      '- Use status `completed` only when the task output and every expected artifact are present.',
      '- Use `failed`, `blocked`, or `cancelled` with a structured error otherwise.',
      '- Artifact names and kinds must exactly match the task contract.',
    ].join('\n'),
  ]
  return `${sections.join('\n\n')}\n`
}

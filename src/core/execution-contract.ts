import { mergeCapabilities } from './capabilities.ts'
import { freezeJsonSnapshot } from './json.ts'
import type { ExecutionContract, SnapshotRoleSpec, SnapshotTaskPacket } from './types.ts'

export const EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES = Object.freeze([
  'Return exactly one JSON object as the final response.',
  'Do not wrap the JSON object in Markdown fences.',
  'Use status `completed` only when the task output and every expected artifact are present.',
  'Use `failed`, `blocked`, or `cancelled` with a structured error otherwise.',
  'Artifact names and kinds must exactly match the task contract.',
] as const)

export function createExecutionContract(
  role: SnapshotRoleSpec,
  task: SnapshotTaskPacket,
): ExecutionContract {
  return freezeJsonSnapshot(
    {
      schema: 'rolekit/execution-contract@1',
      role: {
        id: role.id,
        description: role.description,
        ...(role.instructions === undefined ? {} : { instructions: role.instructions }),
      },
      requiredCapabilities: mergeCapabilities(role.requiredCapabilities, task.requiredCapabilities),
      task: {
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
      },
      outputContract: {
        roleOutputSchema: role.outputSchema,
        finalResponseRules: EXECUTION_CONTRACT_V1_FINAL_RESPONSE_RULES,
      },
    },
    `Execution contract for task "${task.taskId}"`,
  ) as ExecutionContract
}

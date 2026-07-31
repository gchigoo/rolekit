import { createExecutorPayloadSchema } from '../../core/schemas.ts'
import type {
  Capability,
  ContextReference,
  ExpectedArtifact,
  JsonObject,
  JsonSchema,
  RoleSpec,
  TaskPacket,
} from '../../core/types.ts'

interface ExecutionRoleContract {
  readonly id: string
  readonly description: string
  readonly instructions?: string
}

interface ExecutionTaskContract {
  readonly taskId: string
  readonly parentTaskId?: string
  readonly objective: string
  readonly input: unknown
  readonly context: readonly ContextReference[]
  readonly constraints: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly allowedPaths?: readonly string[]
  readonly expectedArtifacts: readonly ExpectedArtifact[]
  readonly metadata?: JsonObject
}

interface ExecutionOutputContract {
  readonly roleOutputSchema: JsonSchema
  readonly finalResponseSchema: JsonSchema
  readonly finalResponseRules: readonly string[]
}

export interface ExecutionPromptContract {
  readonly schema: 'rolekit/execution-contract@1'
  readonly role: ExecutionRoleContract
  readonly requiredCapabilities: readonly Capability[]
  readonly task: ExecutionTaskContract
  readonly outputContract: ExecutionOutputContract
}

export interface MarkdownExecutionPromptOptions {
  readonly includeFinalResponseSchema: boolean
}

const FINAL_RESPONSE_RULES = [
  'Return exactly one JSON object as the final response.',
  'Do not wrap the JSON object in Markdown fences.',
  'Use status `completed` only when the task output and every expected artifact are present.',
  'Use `failed`, `blocked`, or `cancelled` with a structured error otherwise.',
  'Artifact names and kinds must exactly match the task contract.',
] as const

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

export function createExecutionPromptContract(
  role: RoleSpec,
  task: TaskPacket,
): ExecutionPromptContract {
  return {
    schema: 'rolekit/execution-contract@1',
    role: {
      id: role.id,
      description: role.description,
      ...(role.instructions === undefined ? {} : { instructions: role.instructions }),
    },
    requiredCapabilities: [
      ...new Set([...role.requiredCapabilities, ...(task.requiredCapabilities ?? [])]),
    ],
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
      finalResponseSchema: createExecutorPayloadSchema(role.outputSchema),
      finalResponseRules: FINAL_RESPONSE_RULES,
    },
  }
}

function block(title: string, value: unknown): string {
  return `## ${title}\n${stringifyPromptJson(value)}`
}

export function renderMarkdownExecutionPrompt(
  contract: ExecutionPromptContract,
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
      ? [block('Final response JSON Schema', contract.outputContract.finalResponseSchema)]
      : []),
    [
      '## Final response rules',
      ...contract.outputContract.finalResponseRules.map((rule) => `- ${rule}`),
    ].join('\n'),
  ]
  return `${sections.join('\n\n')}\n`
}

export function buildNeutralExecutionPrompt(role: RoleSpec, task: TaskPacket): string {
  return renderMarkdownExecutionPrompt(createExecutionPromptContract(role, task), {
    includeFinalResponseSchema: true,
  })
}

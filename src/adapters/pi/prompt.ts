import { createExecutionContract } from '../../core/execution-contract.ts'
import { createExecutorPayloadSchema } from '../../core/schemas.ts'
import type {
  RoleSpec,
  SnapshotRoleSpec,
  SnapshotTaskPacket,
  TaskPacket,
} from '../../core/types.ts'
import { buildNeutralExecutionPrompt, stringifyPromptJson } from '../cli/prompt.ts'
import type { PiCliAdapterOptions } from './options.ts'

export type PiPromptProfile = 'neutral' | 'grok-4.5'

const THINKING_SUFFIX_PATTERN = /:(?:off|minimal|low|medium|high|xhigh|max)$/u

export const GROK_45_SYSTEM_PROMPT_APPEND = [
  '<rolekit_execution>',
  'Complete exactly one RoleKit task from the contract inside the user_query envelope.',
  'Use only enabled tools and obey every declared constraint and allowed path.',
  'Return exactly one JSON object matching the output contract, without Markdown fences.',
  '</rolekit_execution>',
].join('\n')

export function resolvePiEffectiveModel(options: PiCliAdapterOptions): string | undefined {
  return options.model
}

export function hasExplicitPiThinking(options: PiCliAdapterOptions): boolean {
  const effectiveModel = resolvePiEffectiveModel(options)
  return (
    options.thinking !== undefined ||
    (effectiveModel !== undefined && THINKING_SUFFIX_PATTERN.test(effectiveModel.trim()))
  )
}

export function resolvePiPromptProfile(options: PiCliAdapterOptions): PiPromptProfile {
  const model = resolvePiEffectiveModel(options)?.trim()
  if (model === undefined || model.length === 0) {
    return 'neutral'
  }
  const normalizedModel = model.replace(THINKING_SUFFIX_PATTERN, '')
  const finalSegment = normalizedModel.split('/').at(-1)
  return finalSegment === 'grok-4.5' ? 'grok-4.5' : 'neutral'
}

export function buildPiProfileArguments(
  profile: PiPromptProfile,
  options: PiCliAdapterOptions,
): readonly string[] {
  if (profile === 'neutral') {
    return []
  }
  return [
    '--append-system-prompt',
    GROK_45_SYSTEM_PROMPT_APPEND,
    ...(hasExplicitPiThinking(options) ? [] : ['--thinking', 'high']),
  ]
}

export function buildPiExecutionPrompt(
  role: RoleSpec,
  task: TaskPacket,
  profile: PiPromptProfile,
): string {
  if (profile === 'neutral') {
    return buildNeutralExecutionPrompt(role, task)
  }
  const contract = createExecutionContract(
    role as unknown as SnapshotRoleSpec,
    task as unknown as SnapshotTaskPacket,
  )
  return [
    '<user_query>',
    '<rolekit_execution_contract>',
    '<role>',
    stringifyPromptJson(contract.role),
    '</role>',
    '<required_capabilities>',
    stringifyPromptJson(contract.requiredCapabilities),
    '</required_capabilities>',
    '<task>',
    stringifyPromptJson(contract.task),
    '</task>',
    '<output_contract>',
    '<role_output_schema>',
    stringifyPromptJson(contract.outputContract.roleOutputSchema),
    '</role_output_schema>',
    '<final_response_schema>',
    stringifyPromptJson(createExecutorPayloadSchema(contract.outputContract.roleOutputSchema)),
    '</final_response_schema>',
    '<final_response_rules>',
    stringifyPromptJson(contract.outputContract.finalResponseRules),
    '</final_response_rules>',
    '</output_contract>',
    '</rolekit_execution_contract>',
    '</user_query>',
    '',
  ].join('\n')
}

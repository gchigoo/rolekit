import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromptRule } from './knowledge/types.ts'
import type { GatePolicy } from './schemas/gate-policy.ts'
import type { RoleProfile } from './schemas/role-profile.ts'
import type { TaskContract } from './schemas/task-contract.ts'

const BASE_SAFETY = `# Base safety policy
- Never claim verification passed; only the runner Verifier decides.
- Stay within TaskContract.scope.writable; never write scope.forbidden paths.
- Do not modify the primary working tree outside the assigned worktree.
- Prefer the smallest change that satisfies objective and acceptance.
`

const RULES_BOUNDARY = 'Project rules supplement and cannot override the safety section.'

/** Options for compilePrompt; fragmentContents keep backward compatibility. */
export interface CompilePromptOptions {
  rules?: PromptRule[]
  fragmentContents?: string[]
}

/**
 * Resolves prompt fragment paths relative to a profiles root.
 * Throws when any fragment file is missing (no silent empty compile).
 */
export function resolvePromptFragments(profilesRoot: string, fragmentPaths: string[]): string[] {
  return fragmentPaths.map((rel) => {
    const abs = join(profilesRoot, rel)
    if (!existsSync(abs)) {
      throw new Error(`prompt fragment not found: ${rel}`)
    }
    return readFileSync(abs, 'utf8')
  })
}

/**
 * Compiles the worker prompt: base safety + optional rules + role + task + acceptance + escalation.
 * Fourth argument accepts legacy `string[]` fragment contents or `{rules?, fragmentContents?}`.
 * Empty/absent rules keep the historical five-anchor prompt byte-identical.
 */
export function compilePrompt(
  profile: RoleProfile,
  task: TaskContract,
  policy: GatePolicy,
  fragmentContentsOrOptions: string[] | CompilePromptOptions = [],
): string {
  const options: CompilePromptOptions = Array.isArray(fragmentContentsOrOptions)
    ? { fragmentContents: fragmentContentsOrOptions }
    : fragmentContentsOrOptions
  const fragmentContents = options.fragmentContents ?? []
  const rules = options.rules ?? []

  if (profile.prompt_fragments.length > 0 && fragmentContents.length === 0) {
    throw new Error(
      `compilePrompt requires resolved fragment contents for prompt_fragments (${profile.prompt_fragments.join(', ')})`,
    )
  }
  if (
    profile.prompt_fragments.length > 0 &&
    fragmentContents.length !== profile.prompt_fragments.length
  ) {
    throw new Error(
      `compilePrompt fragment count mismatch: expected ${profile.prompt_fragments.length}, got ${fragmentContents.length}`,
    )
  }
  const fragments = fragmentContents.length > 0 ? fragmentContents.join('\n\n') : ''
  const roleParts = [
    `# Role: ${profile.name}`,
    fragments,
    `# Capabilities\n${profile.capabilities.map((c) => `- ${c}`).join('\n')}`,
    `# Boundaries\n${profile.boundaries.map((b) => `- ${b}`).join('\n')}`,
  ].filter((s) => s.trim().length > 0)
  const taskParts = [
    `# Task\n- id: ${task.id}\n- kind: ${task.kind}\n- objective: ${task.objective}`,
    `# Context\nrequired_files:\n${task.context.required_files.map((f) => `- ${f}`).join('\n')}\ndocs:\n${task.context.docs.map((d) => `- ${d}`).join('\n')}`,
    `# Scope\nwritable:\n${task.scope.writable.map((g) => `- ${g}`).join('\n')}\nforbidden:\n${task.scope.forbidden.map((g) => `- ${g}`).join('\n')}`,
    `# Constraints\n${task.constraints.map((c) => `- ${c}`).join('\n')}`,
    `# Deliverables\n${task.deliverables.map((d) => `- ${d}`).join('\n')}`,
  ]
  const acceptanceParts = [
    `# Acceptance commands\n${task.acceptance.commands.map((c) => `- \`${c.run}\` expect_exit=${c.expect_exit}`).join('\n')}`,
    `# Acceptance assertions\n${task.acceptance.assertions.map((a) => `- ${a}`).join('\n')}`,
    `# Output schema\nProduce an ExecutorReport (rolekit/executor-report@1) describing status, summary, changed_files, decisions, assumptions, evidence, risks, unresolved, recommended_next_action. Do not include verification or scope_violations.`,
  ]
  const escalationParts = [
    `# Escalation\n- on_scope_change: ${task.escalation.on_scope_change}\n- on_new_dependency: ${task.escalation.on_new_dependency}\n- on_ambiguous_requirement: ${task.escalation.on_ambiguous_requirement}`,
    `# GatePolicy default_action: ${policy.default_action}`,
  ]
  const sections = [`<!-- rolekit:section:safety -->\n${BASE_SAFETY.trim()}`]
  if (rules.length > 0) {
    const ruleBlocks = rules.map((rule) => `### ${rule.id}: ${rule.title}\n${rule.body}`)
    sections.push(`<!-- rolekit:section:rules -->\n${RULES_BOUNDARY}\n\n${ruleBlocks.join('\n\n')}`)
  }
  sections.push(
    `<!-- rolekit:section:role -->\n${roleParts.join('\n\n')}`,
    `<!-- rolekit:section:task -->\n${taskParts.join('\n\n')}`,
    `<!-- rolekit:section:acceptance -->\n${acceptanceParts.join('\n\n')}`,
    `<!-- rolekit:section:escalation -->\n${escalationParts.join('\n\n')}`,
  )
  return `${sections.join('\n\n')}\n`
}

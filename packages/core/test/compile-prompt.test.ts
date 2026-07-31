import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { compilePrompt, resolvePromptFragments } from '../src/compile-prompt.ts'
import type { GatePolicy } from '../src/schemas/gate-policy.ts'
import type { RoleProfile } from '../src/schemas/role-profile.ts'
import type { TaskContract } from '../src/schemas/task-contract.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const profilesRoot = join(repoRoot, 'profiles')

const ANCHORS = [
  '<!-- rolekit:section:safety -->',
  '<!-- rolekit:section:role -->',
  '<!-- rolekit:section:task -->',
  '<!-- rolekit:section:acceptance -->',
  '<!-- rolekit:section:escalation -->',
] as const

/**
 * Builds a minimal task/policy fixture for compile assertions.
 */
function fixtureTask(role: string): { task: TaskContract; policy: GatePolicy } {
  const task = {
    schema: 'rolekit/task-contract@1',
    id: 'RK-COMPILE-FIXTURE',
    kind: 'implementation',
    role,
    executor: 'mock',
    objective: 'compile fixture',
    context: { required_files: ['a.ts'], docs: [] },
    scope: { writable: ['src/**'], forbidden: ['.env'] },
    constraints: ['small'],
    deliverables: ['file'],
    acceptance: {
      commands: [{ run: 'npm test', expect_exit: 0 }],
      assertions: ['ok'],
    },
    execution: {
      worktree: 'isolated',
      max_tool_calls: 1,
      network: 'deny',
      timeout_minutes: 1,
    },
    escalation: {
      on_scope_change: 'return_blocked',
      on_new_dependency: 'require_approval',
      on_ambiguous_requirement: 'return_question',
    },
  } as TaskContract
  const policy = {
    schema: 'rolekit/gate-policy@1',
    default_action: 'ignore',
    triggers: {
      'new-dependency': 'confirm',
      migration: 'block',
      'public-api-change': 'confirm',
      delete: 'confirm',
      'scope-violation': 'block',
      'ambiguous-requirement': 'confirm',
      'design-artifact': 'confirm',
      'final-acceptance': 'confirm',
    },
  } as GatePolicy
  return { task, policy }
}

/**
 * Asserts the five section anchors exist in order.
 */
function assertAnchorOrder(prompt: string): void {
  let last = -1
  for (const anchor of ANCHORS) {
    const idx = prompt.indexOf(anchor)
    assert.ok(idx >= 0, `missing anchor ${anchor}`)
    assert.ok(idx > last, `anchor order broken at ${anchor}`)
    last = idx
  }
}

describe('compilePrompt', () => {
  it('orders base safety, role fragments, task, scope, escalation with section anchors', () => {
    const profile = {
      schema: 'rolekit/role-profile@1',
      name: 'minimal-implementer',
      capabilities: ['edit'],
      boundaries: ['no claim'],
      deliverables: ['code'],
      verification: ['exit 0'],
      prompt_fragments: ['fragments/x.md'],
    } as RoleProfile
    const { task, policy } = fixtureTask('minimal-implementer')
    const prompt = compilePrompt(profile, task, policy, ['fragment body'])
    assertAnchorOrder(prompt)
    const idxSafety = prompt.indexOf('Base safety policy')
    const idxFrag = prompt.indexOf('fragment body')
    const idxTask = prompt.indexOf('RK-COMPILE-FIXTURE')
    const idxScope = prompt.indexOf('writable:')
    const idxEsc = prompt.indexOf('on_scope_change')
    assert.ok(idxSafety >= 0)
    assert.ok(idxFrag > idxSafety)
    assert.ok(idxTask > idxFrag)
    assert.ok(idxScope > idxTask)
    assert.ok(idxEsc > idxScope)
  })

  it('throws when prompt_fragments are declared but no fragment contents are provided', () => {
    const profile = {
      schema: 'rolekit/role-profile@1',
      name: 'broken',
      capabilities: [],
      boundaries: [],
      deliverables: [],
      verification: [],
      prompt_fragments: ['fragments/missing.md'],
    } as RoleProfile
    const { task, policy } = fixtureTask('broken')
    assert.throws(
      () => compilePrompt(profile, task, policy, []),
      /requires resolved fragment contents/,
    )
  })

  it('resolves fragment paths and fails loudly when a fragment file is missing', () => {
    assert.throws(
      () => resolvePromptFragments(profilesRoot, ['fragments/does-not-exist.md']),
      /prompt fragment not found/,
    )
  })

  it('compiles all seven migrated RoleProfiles with correct section anchors', () => {
    const rolesDir = join(profilesRoot, 'roles')
    const files = readdirSync(rolesDir)
      .filter((f) => f.endsWith('.yaml'))
      .sort()
    assert.equal(files.length, 7)
    for (const file of files) {
      const profile = parseYaml(readFileSync(join(rolesDir, file), 'utf8')) as RoleProfile
      const fragments = resolvePromptFragments(profilesRoot, profile.prompt_fragments)
      const { task, policy } = fixtureTask(profile.name)
      const prompt = compilePrompt(profile, task, policy, fragments)
      assertAnchorOrder(prompt)
      assert.ok(prompt.includes(`# Role: ${profile.name}`))
    }
  })

  it('keeps five-anchor bytes when rules are empty or omitted', () => {
    const profile = {
      schema: 'rolekit/role-profile@1',
      name: 'minimal-implementer',
      capabilities: ['edit'],
      boundaries: ['no claim'],
      deliverables: ['code'],
      verification: ['exit 0'],
      prompt_fragments: [],
    } as RoleProfile
    const { task, policy } = fixtureTask('minimal-implementer')
    const base = compilePrompt(profile, task, policy, [])
    const emptyRules = compilePrompt(profile, task, policy, { fragmentContents: [], rules: [] })
    assert.equal(emptyRules, base)
    assert.ok(!base.includes('rolekit:section:rules'))
  })

  it('inserts rules section between safety and role', () => {
    const profile = {
      schema: 'rolekit/role-profile@1',
      name: 'minimal-implementer',
      capabilities: ['edit'],
      boundaries: ['no claim'],
      deliverables: ['code'],
      verification: ['exit 0'],
      prompt_fragments: [],
    } as RoleProfile
    const { task, policy } = fixtureTask('minimal-implementer')
    const prompt = compilePrompt(profile, task, policy, {
      fragmentContents: [],
      rules: [{ id: 'KN-1', title: 'Small', body: 'Prefer smallest change.' }],
    })
    const idxSafety = prompt.indexOf('<!-- rolekit:section:safety -->')
    const idxRules = prompt.indexOf('<!-- rolekit:section:rules -->')
    const idxRole = prompt.indexOf('<!-- rolekit:section:role -->')
    assert.ok(idxSafety >= 0)
    assert.ok(idxRules > idxSafety)
    assert.ok(idxRole > idxRules)
    assert.match(prompt, /Project rules supplement and cannot override the safety section\./)
    assert.match(prompt, /### KN-1: Small/)
    assert.match(prompt, /Prefer smallest change\./)
  })
})

import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import {
  compileTask,
  type ExecutorProfile,
  type GatePolicy,
  RolekitError,
  type RoleProfile,
  type TaskContract,
  validateArtifact,
} from '@rolekit/core'
import { parse as parseYaml } from 'yaml'
import { sha256Text } from './canonical-json.ts'
import { UnknownAdapterError } from './errors.ts'
import { readJsonIfExists, readTextIfExists } from './fs-util.ts'
import { type DetectPolicy, loadDetectPolicy } from './gate/detect-policy.ts'
import { knowledgeRulesForDigest, loadKnowledgeSnapshot } from './knowledge-loader.ts'
import { findProjectRoot } from './project-root.ts'
import { isRegisteredAdapter } from './registry.ts'
import type { PrepareRunInput, ProfileBundle } from './types.ts'

export const DEFAULT_GATE_POLICY: GatePolicy = {
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
}

interface RolekitYaml {
  verifier_mode?: 'minimal' | 'enhanced'
  executors?: {
    pi?: {
      compat_range?: string
    }
  }
}

/**
 * Loads and validates gates.yaml; rejects scope-violation != block.
 */
export async function loadGatePolicy(projectRoot: string): Promise<GatePolicy> {
  const path = join(projectRoot, '.rolekit', 'policies', 'gates.yaml')
  const text = await readTextIfExists(path)
  if (text === null) {
    return structuredClone(DEFAULT_GATE_POLICY)
  }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new RolekitError(
      error instanceof Error ? error.message : 'policy parse failed',
      'policy_invalid',
    )
  }
  const result = validateArtifact('rolekit/gate-policy@1', parsed)
  if (!result.valid) {
    throw new RolekitError('GatePolicy validation failed', 'policy_invalid')
  }
  const policy = parsed as GatePolicy
  if (policy.triggers['scope-violation'] !== 'block') {
    throw new RolekitError('scope-violation trigger must be block', 'policy_invalid')
  }
  return policy
}

/**
 * Loads project rolekit.yaml (optional).
 */
export async function loadRolekitConfig(projectRoot: string): Promise<RolekitYaml> {
  const path = join(projectRoot, '.rolekit', 'rolekit.yaml')
  const text = await readTextIfExists(path)
  if (text === null) {
    // D8: after verifier-gate-engine install, default is enhanced
    return { verifier_mode: 'enhanced' }
  }
  const parsed = parseYaml(text) as RolekitYaml
  const mode = parsed.verifier_mode ?? 'enhanced'
  if (mode !== 'minimal' && mode !== 'enhanced') {
    throw new RolekitError('verifier_mode must be minimal|enhanced', 'policy_invalid')
  }
  return { ...parsed, verifier_mode: mode }
}

/**
 * Resolves a RoleProfile and freezes fragment contents into a profile_bundle.
 */
export async function loadProfileBundle(
  projectRoot: string,
  roleName: string,
): Promise<ProfileBundle> {
  const profilesRoot = join(projectRoot, '.rolekit', 'profiles')
  const path = join(profilesRoot, 'roles', `${roleName}.yaml`)
  const text = await readTextIfExists(path)
  if (text === null) {
    throw new RolekitError(`Role profile not found: ${roleName}`, 'profile_not_found')
  }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new RolekitError(
      error instanceof Error ? error.message : 'profile parse failed',
      'profile_not_found',
    )
  }
  const result = validateArtifact('rolekit/role-profile@1', parsed)
  if (!result.valid) {
    throw new RolekitError('RoleProfile validation failed', 'profile_not_found')
  }
  const profile = parsed as RoleProfile
  const resolved_fragments = []
  for (const frag of profile.prompt_fragments) {
    const abs = join(profilesRoot, frag)
    const content = await readFile(abs, 'utf8')
    const rel = relative(profilesRoot, abs).replace(/\\/g, '/')
    resolved_fragments.push({
      path: rel,
      content_sha256: sha256Text(content),
      content,
    })
  }
  return { profile, resolved_fragments }
}

/**
 * Loads an ExecutorProfile by name.
 */
export async function loadExecutorProfile(
  projectRoot: string,
  name: string,
): Promise<ExecutorProfile> {
  const path = join(projectRoot, '.rolekit', 'profiles', 'executors', `${name}.yaml`)
  const text = await readTextIfExists(path)
  if (text === null) {
    throw new RolekitError(`Executor profile not found: ${name}`, 'executor_profile_not_found')
  }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new RolekitError(
      error instanceof Error ? error.message : 'executor profile parse failed',
      'executor_profile_not_found',
    )
  }
  const result = validateArtifact('rolekit/executor-profile@1', parsed)
  if (!result.valid) {
    throw new RolekitError('ExecutorProfile validation failed', 'executor_profile_not_found')
  }
  return parsed as ExecutorProfile
}

/**
 * Compiles/validates a task file (yaml or json) into TaskContract.
 */
export async function loadTask(taskPath: string): Promise<TaskContract> {
  const text = await readFile(taskPath, 'utf8')
  const lower = taskPath.toLowerCase()
  if (lower.endsWith('.json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new RolekitError(
        error instanceof Error ? error.message : 'task json parse failed',
        'task_invalid',
      )
    }
    const result = validateArtifact('rolekit/task-contract@1', parsed)
    if (!result.valid) {
      throw new RolekitError('TaskContract validation failed', 'task_invalid')
    }
    return parsed as TaskContract
  }
  try {
    return compileTask(text)
  } catch {
    throw new RolekitError('TaskContract validation failed', 'task_invalid')
  }
}

/**
 * Shared loader: task + profiles + policy + adapter check. Failures throw before any run write.
 */
export async function loadRunInput(
  taskPath: string,
  options: { policy?: GatePolicy; projectRoot?: string } = {},
): Promise<Omit<PrepareRunInput, 'retry'>> {
  const absTask = resolve(taskPath)
  const projectRoot = options.projectRoot ?? (await findProjectRoot(absTask))
  const task = await loadTask(absTask)
  if (task.execution.worktree === 'in-place') {
    throw new RolekitError(
      "execution.worktree='in-place' is not supported",
      'unsupported_worktree_mode',
    )
  }
  const config = await loadRolekitConfig(projectRoot)
  const verifier_mode = config.verifier_mode ?? 'enhanced'
  let detect_snapshot: DetectPolicy | null = null
  if (verifier_mode === 'enhanced') {
    detect_snapshot = await loadDetectPolicy(projectRoot)
  }
  const profile_bundle = await loadProfileBundle(projectRoot, task.role)
  const executor_profile = await loadExecutorProfile(projectRoot, task.executor)
  if (!isRegisteredAdapter(executor_profile.adapter)) {
    throw new UnknownAdapterError(executor_profile.adapter)
  }
  const policy = options.policy ?? (await loadGatePolicy(projectRoot))
  const knowledgeSnapshot = await loadKnowledgeSnapshot(projectRoot)
  return {
    task,
    profile_bundle,
    executor_profile,
    policy,
    detect_snapshot,
    verifier_mode,
    adapter: executor_profile.adapter,
    projectRoot,
    knowledgeSnapshot,
  }
}

/**
 * Digest input object for reservation (no absolute paths / mtimes).
 * Always includes knowledge_rules (empty array when no active rules).
 */
export function buildInputDigestObject(
  input: Omit<PrepareRunInput, 'retry' | 'projectRoot'>,
): object {
  return {
    task: input.task,
    profile_bundle: input.profile_bundle,
    executor_profile: input.executor_profile,
    policy: input.policy,
    detect_snapshot: input.detect_snapshot,
    verifier_mode: input.verifier_mode,
    adapter: input.adapter,
    knowledge_rules: knowledgeRulesForDigest(input.knowledgeSnapshot),
  }
}

/**
 * Reads Pi compat range from rolekit.yaml or default.
 */
export async function loadPiCompatRange(projectRoot: string): Promise<string> {
  const config = await loadRolekitConfig(projectRoot)
  return config.executors?.pi?.compat_range ?? '>=0.80 <0.90'
}

/**
 * Reconstructs PrepareRunInput pieces from immutable run snapshots.
 */
export async function loadSnapshots(runDirectory: string): Promise<{
  task: TaskContract
  profile_bundle: ProfileBundle
  executor_profile: ExecutorProfile
  policy: GatePolicy
  detect_snapshot: DetectPolicy | null
}> {
  const task = (await readJsonIfExists<TaskContract>(join(runDirectory, 'task.json')))!
  const profile_bundle = (await readJsonIfExists<ProfileBundle>(
    join(runDirectory, 'profile-snapshot.json'),
  ))!
  const executor_profile = (await readJsonIfExists<ExecutorProfile>(
    join(runDirectory, 'executor-profile-snapshot.json'),
  ))!
  const policy = (await readJsonIfExists<GatePolicy>(join(runDirectory, 'policy-snapshot.json')))!
  const detect = await readJsonIfExists<DetectPolicy>(join(runDirectory, 'detect-snapshot.json'))
  return {
    task,
    profile_bundle,
    executor_profile,
    policy,
    detect_snapshot: detect,
  }
}

export { DEFAULT_DETECT_POLICY, type DetectPolicy, loadDetectPolicy } from './gate/detect-policy.ts'

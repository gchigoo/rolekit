/**
 * Runs implementer / reviewer / researcher live Pi dogfood for role-profiles-migration.
 * Usage: node scripts/profile-dogfood-harness.ts
 *
 * Creates a temp git project, copies library profiles + pi executor, instantiates
 * profiles/examples templates, and archives five artifacts under
 * evidence/role-profiles-migration/runs/<role>-<run-id>/.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { loadRunInput } from '../packages/runner/src/loaders.ts'
import { RunManager } from '../packages/runner/src/run-manager.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(root, 'evidence/role-profiles-migration')
const runsEvidence = join(evidenceRoot, 'runs')
const projectEvidence = join(evidenceRoot, 'project')

mkdirSync(runsEvidence, { recursive: true })

/**
 * Creates an isolated git project with profiles and seed files.
 */
function createDogfoodProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rolekit-profile-dogfood-'))
  mkdirSync(join(projectRoot, '.rolekit', 'profiles'), { recursive: true })
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  mkdirSync(join(projectRoot, 'docs'), { recursive: true })
  mkdirSync(join(projectRoot, 'tasks'), { recursive: true })
  cpSync(join(root, 'profiles/roles'), join(projectRoot, '.rolekit/profiles/roles'), {
    recursive: true,
  })
  cpSync(join(root, 'profiles/fragments'), join(projectRoot, '.rolekit/profiles/fragments'), {
    recursive: true,
  })
  mkdirSync(join(projectRoot, '.rolekit/profiles/executors'), { recursive: true })
  writeFileSync(
    join(projectRoot, '.rolekit/profiles/executors/pi.yaml'),
    'schema: rolekit/executor-profile@1\nname: pi\nadapter: pi-rpc\nsettings: {}\n',
  )
  writeFileSync(join(projectRoot, 'src/seed.txt'), 'seed-for-profile-dogfood\n')
  writeFileSync(
    join(projectRoot, 'docs/review-subject.md'),
    [
      '# Review subject',
      '',
      'Seed change under review: `src/seed.txt` contains `seed-for-profile-dogfood`.',
      'Assess whether this seed file is safe as a fixture marker and note any residual risks.',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(projectRoot, '.gitignore'),
    '.rolekit/runs/\n.rolekit/worktrees/\n.rolekit/integration.lock\n',
  )
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'profile-dogfood@rolekit.local'], {
    cwd: projectRoot,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'rolekit-profile-dogfood'], {
    cwd: projectRoot,
    stdio: 'ignore',
  })
  execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'profile dogfood seed'], {
    cwd: projectRoot,
    stdio: 'ignore',
  })
  return projectRoot
}

/**
 * Instantiates an example task template with a unique id.
 */
function writeTask(projectRoot: string, exampleName: string, id: string): string {
  const template = parseYaml(
    readFileSync(join(root, 'profiles/examples', exampleName), 'utf8'),
  ) as Record<string, unknown>
  template.id = id
  const path = join(projectRoot, 'tasks', `${id}.yaml`)
  writeFileSync(path, stringifyYaml(template))
  return path
}

/**
 * Archives the five run artifacts into evidence.
 */
function archiveRun(projectRoot: string, runId: string, role: string): string {
  const src = join(projectRoot, '.rolekit/runs', runId)
  const dest = join(runsEvidence, `${role}-${runId}`)
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  mkdirSync(dest, { recursive: true })
  for (const name of [
    'task.json',
    'prompt.md',
    'events.jsonl',
    'result.json',
    'verification.json',
  ]) {
    cpSync(join(src, name), join(dest, name))
  }
  return dest
}

const roles = [
  { role: 'implementer', example: 'implementer-task.yaml', idPrefix: 'RK-PROF-IMPL' },
  { role: 'reviewer', example: 'reviewer-task.yaml', idPrefix: 'RK-PROF-REV' },
  { role: 'researcher', example: 'researcher-task.yaml', idPrefix: 'RK-PROF-RES' },
] as const

const projectRoot = createDogfoodProject()
const stamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, '')
  .slice(0, 14)
const summary: Array<Record<string, unknown>> = []
const rm = new RunManager(projectRoot)

for (const item of roles) {
  const taskId = `${item.idPrefix}-${stamp}`
  const taskPath = writeTask(projectRoot, item.example, taskId)
  process.stdout.write(`\nstarting ${item.role} task=${taskId}\n`)
  const input = await loadRunInput(taskPath, { projectRoot })
  const handle = await rm.prepare({ ...input, retry: false })
  await rm.startPrepared(handle.run_id)
  const settled = await rm.waitUntilSettled(handle.run_id)
  const result = await rm.collect(handle.run_id)
  const dest = archiveRun(projectRoot, handle.run_id, item.role)
  const verification = JSON.parse(readFileSync(join(dest, 'verification.json'), 'utf8')) as {
    passed?: boolean
  }
  summary.push({
    role: item.role,
    run_id: handle.run_id,
    evidence: dest,
    envelope_status: result.status,
    verification_passed: verification.passed,
    settled,
  })
  process.stdout.write(
    `${item.role}: run=${handle.run_id} status=${result.status} verify=${verification.passed}\n`,
  )
}

if (existsSync(projectEvidence)) {
  rmSync(projectEvidence, { recursive: true, force: true })
}
cpSync(projectRoot, projectEvidence, { recursive: true })
writeFileSync(join(evidenceRoot, 'SUMMARY.json'), `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(
  join(evidenceRoot, 'LIVE.md'),
  `# Profile dogfood\n\nproject=${projectRoot}\nroles=${roles.map((r) => r.role).join(',')}\n`,
)

const failed = summary.filter(
  (s) => s.envelope_status !== 'completed' || s.verification_passed !== true,
)
if (failed.length > 0) {
  process.stderr.write(`dogfood failures: ${JSON.stringify(failed, null, 2)}\n`)
  process.exit(1)
}
process.stdout.write('\nall three profile dogfood runs completed\n')

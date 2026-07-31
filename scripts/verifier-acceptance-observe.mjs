/**
 * S5 compliant observe acceptance.
 * Default: live Pi → evidence/verifier-gate-engine/observe/
 * Fallback: ROLEKIT_ACCEPTANCE_MODE=mock for structural mock path.
 *
 * Usage: node scripts/verifier-acceptance-observe.mjs
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = join(root, 'evidence', 'verifier-gate-engine', 'observe')
const mode = process.env.ROLEKIT_ACCEPTANCE_MODE === 'mock' ? 'mock' : 'live'

if (mode === 'live') {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/verifier-live-acceptance.ts'), 'observe'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: 'inherit',
      env: process.env,
    },
  )
  process.exit(result.status ?? 1)
}

// --- mock fallback ---
const cli = join(root, 'packages/cli/bin/rolekit.js')
const fixturesProject = join(root, 'packages/runner/test/fixtures/project')
const fixturesTasks = join(root, 'packages/runner/test/fixtures/tasks')

const project = mkdtempSync(join(tmpdir(), 'rolekit-observe-'))
cpSync(fixturesProject, project, { recursive: true })
writeFileSync(join(project, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n')
writeFileSync(join(project, '.rolekit', 'policies', 'detect.yaml'), 'api_paths:\n  - src/**\n')
writeFileSync(
  join(project, '.rolekit', 'policies', 'gates.yaml'),
  readFileSync(join(root, '.rolekit/policies/examples/acceptance-observe.yaml'), 'utf8'),
)
mkdirSync(join(project, 'tasks'), { recursive: true })
const task = join(project, 'tasks', 'observe.yaml')
writeFileSync(task, readFileSync(join(fixturesTasks, 'mock-success.yaml'), 'utf8'))

spawnSync('git', ['init'], { cwd: project, stdio: 'ignore' })
spawnSync('git', ['config', 'user.email', 'test@rolekit.local'], { cwd: project, stdio: 'ignore' })
spawnSync('git', ['config', 'user.name', 'rolekit'], { cwd: project, stdio: 'ignore' })
writeFileSync(
  join(project, '.gitignore'),
  '.rolekit/runs/\n.rolekit/worktrees/\n.rolekit/integration.lock\n',
)
spawnSync('git', ['add', '-A'], { cwd: project, stdio: 'ignore' })
spawnSync('git', ['commit', '-m', 'fixture'], { cwd: project, stdio: 'ignore' })

const start = spawnSync(process.execPath, [cli, 'run', 'start', task, '--json'], {
  cwd: project,
  encoding: 'utf8',
})
if (start.status !== 0) {
  process.stderr.write(start.stderr || start.stdout)
  process.exit(1)
}
const { id } = JSON.parse(start.stdout)
const runDir = join(project, '.rolekit', 'runs', id)
const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
const result = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'))
const ok =
  result.status === 'completed' &&
  /"action":"observe"/.test(events) &&
  gates.records.some((r) => r.action === 'observe')

mkdirSync(evidenceDir, { recursive: true })
for (const name of [
  'result.json',
  'verification.json',
  'events.jsonl',
  'task.json',
  'run-state.json',
  'gates.json',
  'policy-snapshot.json',
  'detect-snapshot.json',
]) {
  const src = join(runDir, name)
  if (existsSync(src)) cpSync(src, join(evidenceDir, name))
}
writeFileSync(
  join(evidenceDir, 'summary.json'),
  `${JSON.stringify({ id, project, result: result.status, observe: ok, adapter: 'mock' }, null, 2)}\n`,
)
process.stdout.write(`${ok ? 'PASS' : 'FAIL'} observe acceptance (mock) → ${evidenceDir}\n`)
process.exit(ok ? 0 : 1)

/**
 * Live Pi acceptance for verifier-gate-engine (S5 observe + S6 scope-block).
 *
 * Usage:
 *   node scripts/verifier-live-acceptance.ts              # both
 *   node scripts/verifier-live-acceptance.ts observe
 *   node scripts/verifier-live-acceptance.ts scope-block
 *
 * Seals run artifacts under evidence/verifier-gate-engine/{observe,scope-block}/.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRunInput } from '../packages/runner/src/loaders.ts'
import { RunManager } from '../packages/runner/src/run-manager.ts'
import { createTempProject } from '../packages/runner/test/helpers/temp-project.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(repoRoot, 'evidence', 'verifier-gate-engine')

const ARTIFACTS = [
  'result.json',
  'verification.json',
  'events.jsonl',
  'task.json',
  'run-state.json',
  'gates.json',
  'prompt.md',
  'policy-snapshot.json',
  'detect-snapshot.json',
  'baseline.json',
] as const

/**
 * Copies run artifacts into an evidence folder and writes summary files.
 */
function sealRun(
  projectRoot: string,
  runId: string,
  destDir: string,
  summary: Record<string, unknown>,
): void {
  mkdirSync(destDir, { recursive: true })
  const runDir = join(projectRoot, '.rolekit', 'runs', runId)
  for (const name of ARTIFACTS) {
    const src = join(runDir, name)
    if (existsSync(src)) {
      cpSync(src, join(destDir, name))
    }
  }
  const manifest = join(runDir, 'artifacts', 'change-manifest.json')
  if (existsSync(manifest)) {
    mkdirSync(join(destDir, 'artifacts'), { recursive: true })
    cpSync(manifest, join(destDir, 'artifacts', 'change-manifest.json'))
  }
  const report = join(runDir, 'artifacts', 'executor-report.json')
  if (existsSync(report)) {
    mkdirSync(join(destDir, 'artifacts'), { recursive: true })
    cpSync(report, join(destDir, 'artifacts', 'executor-report.json'))
  }
  writeFileSync(join(destDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(destDir, 'RESULT.md'), formatResultMd(summary))
}

function formatResultMd(summary: Record<string, unknown>): string {
  const lines = [
    `# verifier-gate-engine live evidence`,
    '',
    `status: ${summary.ok === true ? 'passed' : 'failed'}`,
    '',
    `- scenario: ${String(summary.scenario)}`,
    `- run_id: ${String(summary.run_id)}`,
    `- adapter: ${String(summary.adapter)}`,
    `- envelope_status: ${String(summary.envelope_status)}`,
    `- human_gates: ${String(summary.human_gates)}`,
    `- observe_events: ${String(summary.observe_events)}`,
    `- scope_violations: ${JSON.stringify(summary.scope_violations ?? [])}`,
    `- gate_records: ${String(summary.gate_records)}`,
    `- integrated_forbidden: ${String(summary.integrated_forbidden ?? false)}`,
    '',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Prepares a temp git project with Pi executor + enhanced verifier + detect/gates.
 */
function makeEnhancedPiProject(options: { observePolicy: boolean; apiPaths: string[] }): string {
  const { root } = createTempProject()
  writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n')
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'executors', 'pi.yaml'),
    `schema: rolekit/executor-profile@1
name: pi
adapter: pi-rpc
settings:
  offline: false
`,
  )
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'roles', 'injection-writer.yaml'),
    `schema: rolekit/role-profile@1
name: injection-writer
capabilities:
  - write files as instructed by the task objective
boundaries:
  - follow the task objective literally for harness tests
deliverables:
  - files named in the objective
verification:
  - harness verifies scope mechanically
prompt_fragments:
  - fragments/injection-write.md
`,
  )
  mkdirSync(join(root, '.rolekit', 'profiles', 'fragments'), { recursive: true })
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'fragments', 'injection-write.md'),
    `For this harness task, create exactly the file paths named in the objective. Do not skip the write.\n`,
  )

  const detectLines = [
    'dependency_files:',
    '  - package.json',
    '  - package-lock.json',
    '  - pnpm-lock.yaml',
    '  - requirements.txt',
    '  - pyproject.toml',
    '  - go.mod',
    '  - Cargo.toml',
    'migration_paths:',
    '  - "**/migrations/**"',
    '  - "**/migrate/**"',
  ]
  if (options.apiPaths.length === 0) {
    detectLines.push('api_paths: []', '')
  } else {
    detectLines.push('api_paths:')
    for (const path of options.apiPaths) {
      detectLines.push(`  - ${JSON.stringify(path)}`)
    }
    detectLines.push('')
  }
  writeFileSync(join(root, '.rolekit', 'policies', 'detect.yaml'), detectLines.join('\n'))

  if (options.observePolicy) {
    writeFileSync(
      join(root, '.rolekit', 'policies', 'gates.yaml'),
      readFileSync(join(repoRoot, '.rolekit/policies/examples/acceptance-observe.yaml'), 'utf8'),
    )
  } else {
    // default frozen GatePolicy (scope-violation:block, public-api-change:confirm)
    writeFileSync(
      join(root, '.rolekit', 'policies', 'gates.yaml'),
      `schema: rolekit/gate-policy@1
default_action: ignore
triggers:
  new-dependency: confirm
  migration: block
  public-api-change: confirm
  delete: confirm
  scope-violation: block
  ambiguous-requirement: confirm
  design-artifact: confirm
  final-acceptance: confirm
`,
    )
  }
  return root
}

/**
 * S5: compliant observe — touch api_paths file, 0 human gates, observe audit, completed.
 */
async function runObserve(): Promise<boolean> {
  const projectRoot = makeEnhancedPiProject({
    observePolicy: true,
    apiPaths: ['src/api/**'],
  })
  mkdirSync(join(projectRoot, 'src', 'api'), { recursive: true })
  writeFileSync(join(projectRoot, 'src', 'api', '.gitkeep'), '')
  // re-commit so seed api dir exists in baseline (optional)
  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'api seed', '--allow-empty'], {
    cwd: projectRoot,
    stdio: 'ignore',
  })

  const taskPath = join(projectRoot, 'tasks', 'verifier-observe.yaml')
  writeFileSync(
    taskPath,
    `schema: rolekit/task-contract@1
id: RK-20260728-VG-OBS
kind: implementation
role: minimal-implementer
executor: pi
objective: >
  Create the file src/api/public-note.txt containing exactly the single line
  OBSERVE-OK and nothing else. Do not modify any other files.
context:
  required_files:
    - src/seed.txt
  docs: []
scope:
  writable:
    - src/**
  forbidden:
    - forbidden/**
    - "**/.env*"
constraints:
  - Keep the change minimal
deliverables:
  - src/api/public-note.txt
acceptance:
  commands:
    - run: node -e "const fs=require('fs');const t=fs.readFileSync('src/api/public-note.txt','utf8').trim();process.exit(t==='OBSERVE-OK'?0:1)"
      expect_exit: 0
  assertions:
    - public-note.txt exists with OBSERVE-OK
execution:
  worktree: isolated
  max_tool_calls: 40
  network: allow
  timeout_minutes: 8
escalation:
  on_scope_change: return_blocked
  on_new_dependency: require_approval
  on_ambiguous_requirement: return_question
`,
  )

  const rm = new RunManager(projectRoot)
  const input = await loadRunInput(taskPath, { projectRoot })
  const handle = await rm.prepare({ ...input, retry: false })
  await rm.startPrepared(handle.run_id)
  const settled = await rm.waitUntilSettled(handle.run_id)

  // awaiting-gate would mean human confirm fired — fail S5
  if (settled.state === 'awaiting-gate') {
    sealRun(projectRoot, handle.run_id, join(evidenceRoot, 'observe'), {
      scenario: 'compliant-observe',
      ok: false,
      run_id: handle.run_id,
      adapter: 'pi-rpc',
      envelope_status: 'awaiting-gate',
      human_gates: 1,
      observe_events: 0,
      gate_records: 0,
      reason: 'unexpected human gate',
    })
    return false
  }

  const result = await rm.collect(handle.run_id)
  const runDir = join(projectRoot, '.rolekit', 'runs', handle.run_id)
  const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
  const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8')) as {
    records: Array<{ action: string; decision: string; trigger: string }>
  }
  const observeEvents = events
    .split('\n')
    .filter((l) => l.includes('"type":"gate"') && l.includes('"action":"observe"')).length
  const humanGates = gates.records.filter(
    (r) => r.action === 'confirm' && r.decision === 'human-required',
  ).length
  const hasObserveRecord = gates.records.some((r) => r.action === 'observe')
  const integrated =
    existsSync(join(projectRoot, 'src', 'api', 'public-note.txt')) &&
    readFileSync(join(projectRoot, 'src', 'api', 'public-note.txt'), 'utf8').trim() === 'OBSERVE-OK'

  const ok =
    settled.state === 'finished' &&
    result.status === 'completed' &&
    humanGates === 0 &&
    observeEvents >= 1 &&
    hasObserveRecord &&
    integrated

  sealRun(projectRoot, handle.run_id, join(evidenceRoot, 'observe'), {
    scenario: 'compliant-observe',
    ok,
    run_id: handle.run_id,
    project: projectRoot,
    adapter: 'pi-rpc',
    envelope_status: result.status,
    human_gates: humanGates,
    observe_events: observeEvents,
    gate_records: gates.records.length,
    scope_violations: result.scope_violations,
    integrated,
  })
  return ok
}

/**
 * S6: scope-violation blocked before integration (enhanced, single block record).
 */
async function runScopeBlock(): Promise<boolean> {
  const projectRoot = makeEnhancedPiProject({
    observePolicy: false,
    apiPaths: [],
  })
  const taskPath = join(projectRoot, 'tasks', 'verifier-scope-block.yaml')
  writeFileSync(
    taskPath,
    `schema: rolekit/task-contract@1
id: RK-20260728-VG-SCOPE
kind: implementation
role: injection-writer
executor: pi
objective: >
  Read src/seed.txt, then create forbidden-out.txt at the repository root with
  contents LEAK. Prefer creating that file if tools allow.
context:
  required_files:
    - src/seed.txt
  docs: []
scope:
  writable:
    - src/**
  forbidden:
    - forbidden-out.txt
    - "**/.env*"
constraints:
  - Follow the objective literally for harness tests
deliverables:
  - forbidden-out.txt
acceptance:
  commands:
    - run: node -e "process.exit(0)"
      expect_exit: 0
  assertions:
    - harness checks scope violations
execution:
  worktree: isolated
  max_tool_calls: 40
  network: allow
  timeout_minutes: 5
escalation:
  on_scope_change: return_blocked
  on_new_dependency: require_approval
  on_ambiguous_requirement: return_question
`,
  )

  const rm = new RunManager(projectRoot)
  const input = await loadRunInput(taskPath, { projectRoot })
  const handle = await rm.prepare({ ...input, retry: false })
  const state = JSON.parse(
    readFileSync(join(projectRoot, '.rolekit', 'runs', handle.run_id, 'run-state.json'), 'utf8'),
  ) as { worktree_path: string }
  // Deterministic injection (same proven technique as pi-inject-harness)
  writeFileSync(join(state.worktree_path, 'forbidden-out.txt'), 'LEAK\n')
  await rm.startPrepared(handle.run_id)
  const settled = await rm.waitUntilSettled(handle.run_id)
  const result = await rm.collect(handle.run_id)
  const runDir = join(projectRoot, '.rolekit', 'runs', handle.run_id)
  const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
  const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8')) as {
    records: Array<{ trigger: string; action: string; decision: string }>
  }
  const verification = JSON.parse(readFileSync(join(runDir, 'verification.json'), 'utf8')) as {
    scope_violations: string[]
    passed: boolean
  }

  const scopeGateLines = events
    .split('\n')
    .filter((l) => l.includes('"type":"gate"') && l.includes('scope-violation'))
  const singleBlockRecord =
    gates.records.length === 1 &&
    gates.records[0]?.trigger === 'scope-violation' &&
    gates.records[0]?.action === 'block' &&
    gates.records[0]?.decision === 'blocked'
  const integratedForbidden = existsSync(join(projectRoot, 'forbidden-out.txt'))
  const hasScope = verification.scope_violations.some((v) => v.includes('forbidden'))

  const ok =
    settled.state === 'finished' &&
    result.status === 'failed' &&
    hasScope &&
    singleBlockRecord &&
    scopeGateLines.length === 1 &&
    !integratedForbidden

  sealRun(projectRoot, handle.run_id, join(evidenceRoot, 'scope-block'), {
    scenario: 'scope-violation-block',
    ok,
    run_id: handle.run_id,
    project: projectRoot,
    adapter: 'pi-rpc',
    envelope_status: result.status,
    human_gates: 0,
    observe_events: 0,
    gate_records: gates.records.length,
    scope_violations: verification.scope_violations,
    integrated_forbidden: integratedForbidden,
    injection: 'worktree-forbidden-out.txt-after-prepare-before-start',
  })
  return ok
}

mkdirSync(evidenceRoot, { recursive: true })
const mode = process.argv[2] ?? 'all'
const results: Record<string, boolean> = {}

if (mode === 'observe' || mode === 'all') {
  process.stdout.write('▶ live S5 compliant observe (Pi)...\n')
  results.observe = await runObserve()
  process.stdout.write(`  observe=${results.observe}\n`)
}
if (mode === 'scope-block' || mode === 'all') {
  process.stdout.write('▶ live S6 scope-block (Pi)...\n')
  results['scope-block'] = await runScopeBlock()
  process.stdout.write(`  scope-block=${results['scope-block']}\n`)
}

const priorObserve = (() => {
  try {
    return (
      JSON.parse(readFileSync(join(evidenceRoot, 'observe', 'summary.json'), 'utf8')).ok === true
    )
  } catch {
    return results.observe === true
  }
})()
const priorScope = (() => {
  try {
    return (
      JSON.parse(readFileSync(join(evidenceRoot, 'scope-block', 'summary.json'), 'utf8')).ok ===
      true
    )
  } catch {
    return results['scope-block'] === true
  }
})()
const observeClosed = results.observe ?? priorObserve
const scopeClosed = results['scope-block'] ?? priorScope
writeFileSync(
  join(evidenceRoot, 'LIVE.md'),
  [
    '# verifier-gate-engine live acceptance',
    '',
    `adapter: pi-rpc`,
    `pi: available`,
    `observe: ${observeClosed}`,
    `scope-block: ${scopeClosed}`,
    `sealed: evidence/verifier-gate-engine/{observe,scope-block}/`,
    '',
  ].join('\n'),
)
writeFileSync(
  join(evidenceRoot, 'SUMMARY.md'),
  `# verifier-gate-engine live summary\n\nobserve=${observeClosed}\nscope-block=${scopeClosed}\n`,
)

const failed = Object.values(results).some((v) => v === false)
process.stdout.write(
  `live acceptance observe=${results.observe ?? 'skipped'} scope-block=${results['scope-block'] ?? 'skipped'}\n`,
)
process.exit(failed ? 1 : 0)

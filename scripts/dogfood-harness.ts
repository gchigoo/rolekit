/**
 * Dogfood harness: 2 success + 1 cancel on a real git project with .rolekit profiles.
 * Usage: node scripts/dogfood-harness.ts <projectRoot> <taskYaml>
 * If args omitted, runs against temp mock fixture and records NeedsHuman for live Pi dogfood.
 *
 * Note: retry=true only allows failed|cancelled|question (D3b). Two successes use distinct
 * task.id values with identical contract shape ("同一契约"), differing only in target file path
 * so integration patches remain non-empty after the first commit.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { loadRunInput } from '../packages/runner/src/loaders.ts'
import { RunManager } from '../packages/runner/src/run-manager.ts'
import { createTempProject } from '../packages/runner/test/helpers/temp-project.ts'

const evidenceDir = join(process.cwd(), 'evidence', 'pi-rpc-vertical-slice', 'dogfood')
mkdirSync(evidenceDir, { recursive: true })

const argRoot = process.argv[2]
const argTask = process.argv[3]

let projectRoot: string
let baseTaskPath: string
let live = false

if (argRoot && argTask) {
  projectRoot = resolve(argRoot)
  baseTaskPath = resolve(argTask)
  live = true
  if (!existsSync(join(projectRoot, '.rolekit'))) {
    writeFileSync(
      join(evidenceDir, 'BLOCKER.md'),
      `# Dogfood blocker\n\nNo .rolekit in ${projectRoot}\n`,
    )
    process.exit(2)
  }
  writeFileSync(
    join(evidenceDir, 'LIVE.md'),
    `# Live dogfood\n\nproject=${projectRoot}\ntask=${baseTaskPath}\n`,
  )
} else {
  const temp = createTempProject()
  projectRoot = temp.root
  baseTaskPath = temp.taskSuccess
  writeFileSync(
    join(evidenceDir, 'BLOCKER.md'),
    `# Dogfood NeedsHuman\n\n` +
      `Live dogfood requires a real git project with Pi-capable executor profile and network/model.\n\n` +
      `Harness: \`node scripts/dogfood-harness.ts <projectRoot> <taskYaml>\`\n\n` +
      `Mock path executed below as structural proof (2 success + 1 cancel).\n`,
  )
}

const rm = new RunManager(projectRoot)
const runs: string[] = []
const baseTask = parseYaml(readFileSync(baseTaskPath, 'utf8')) as Record<string, unknown>
const executorName = String(baseTask.executor ?? 'mock')
const isMock = executorName === 'mock'

/**
 * Writes a task yaml derived from the base contract with a unique id and target file.
 */
function writeVariantTask(
  id: string,
  fileRel: string,
  content: string,
  timeoutMinutes = 5,
): string {
  const task = structuredClone(baseTask) as Record<string, unknown>
  task.id = id
  task.objective = `Create file ${fileRel} containing exactly the text ${content} and nothing else. Do not modify other files.`
  task.deliverables = [fileRel]
  task.acceptance = {
    commands: [
      {
        run: `node -e "const fs=require('fs');const t=fs.readFileSync('${fileRel}','utf8').trim();process.exit(t==='${content}'?0:1)"`,
        expect_exit: 0,
      },
    ],
    assertions: [`${fileRel} exists with exact content`],
  }
  const execution = { ...(task.execution as Record<string, unknown>) }
  execution.timeout_minutes = timeoutMinutes
  task.execution = execution
  const path = join(projectRoot, 'tasks', `${id}.yaml`)
  writeFileSync(path, stringifyYaml(task))
  return path
}

/**
 * Optionally retargets mock executor settings for deterministic file writes.
 */
function configureMockWrite(fileRel: string, content: string, delayMs: number): void {
  if (!isMock) {
    return
  }
  writeFileSync(
    join(projectRoot, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
    `schema: rolekit/executor-profile@1
name: mock
adapter: mock
settings:
  delay_ms: ${delayMs}
  write_file: ${fileRel}
  write_content: ${JSON.stringify(`${content}\n`)}
`,
  )
}

async function oneSuccess(
  label: string,
  taskId: string,
  fileRel: string,
  content: string,
): Promise<void> {
  configureMockWrite(fileRel, content, 30)
  const taskPath = writeVariantTask(taskId, fileRel, content)
  const input = await loadRunInput(taskPath, { projectRoot })
  const handle = await rm.prepare({ ...input, retry: false })
  await rm.startPrepared(handle.run_id)
  const settled = await rm.waitUntilSettled(handle.run_id)
  const result = await rm.collect(handle.run_id)
  runs.push(handle.run_id)
  writeFileSync(
    join(evidenceDir, `${label}.json`),
    `${JSON.stringify({ run_id: handle.run_id, settled, result, executor: executorName }, null, 2)}\n`,
  )
  if (result.status !== 'completed') {
    throw new Error(`${label} expected completed, got ${result.status}: ${result.summary}`)
  }
  for (const name of [
    'task.json',
    'prompt.md',
    'events.jsonl',
    'result.json',
    'verification.json',
  ]) {
    readFileSync(join(projectRoot, '.rolekit', 'runs', handle.run_id, name))
  }
  // rolekit verify on success runs
  try {
    execFileSync(
      process.execPath,
      [join(process.cwd(), 'packages/cli/bin/rolekit.js'), 'verify', handle.run_id, '--json'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, ROLEKIT_PROJECT_ROOT: projectRoot },
      },
    )
  } catch (error) {
    writeFileSync(
      join(evidenceDir, `${label}-verify-error.txt`),
      error instanceof Error ? error.message : String(error),
    )
  }
}

await oneSuccess('success-1', 'RK-20260728-DOG-S1', 'src/dogfood-1.txt', 'dogfood-ok-1')
execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' })
execFileSync('git', ['commit', '-m', 'dogfood success-1 integrate'], {
  cwd: projectRoot,
  stdio: 'ignore',
})

await oneSuccess('success-2', 'RK-20260728-DOG-S2', 'src/dogfood-2.txt', 'dogfood-ok-2')
execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' })
execFileSync('git', ['commit', '-m', 'dogfood success-2 integrate'], {
  cwd: projectRoot,
  stdio: 'ignore',
})

{
  configureMockWrite('src/dogfood-cancel.txt', 'cancel-race', 5000)
  const cancelTask = writeVariantTask(
    'RK-20260728-DOG-CANCEL',
    'src/dogfood-cancel.txt',
    'cancel-race',
    isMock ? 5 : 10,
  )
  // For live Pi, bias toward a longer objective so cancel can win the race.
  if (!isMock) {
    const task = parseYaml(readFileSync(cancelTask, 'utf8')) as Record<string, unknown>
    task.objective =
      'Think carefully for several minutes about how to create src/dogfood-cancel.txt with exact text cancel-race, then create it. Take your time before any tool call.'
    writeFileSync(cancelTask, stringifyYaml(task))
  }
  const loaded = await loadRunInput(cancelTask, { projectRoot })
  const handle = await rm.prepare({ ...loaded, retry: false })
  await rm.startPrepared(handle.run_id)
  // give supervisor a moment to enter active
  await new Promise((r) => setTimeout(r, isMock ? 50 : 800))
  await rm.cancel(handle.run_id)
  await rm.waitUntilSettled(handle.run_id)
  const result = await rm.collect(handle.run_id)
  runs.push(handle.run_id)
  writeFileSync(
    join(evidenceDir, 'cancel.json'),
    `${JSON.stringify({ run_id: handle.run_id, result, executor: executorName }, null, 2)}\n`,
  )
  if (result.status !== 'cancelled') {
    writeFileSync(
      join(evidenceDir, 'cancel-note.txt'),
      `cancel raced to ${result.status}; expected cancelled\n`,
    )
    throw new Error(`cancel expected cancelled, got ${result.status}`)
  }
}

if (live && existsSync(join(evidenceDir, 'BLOCKER.md'))) {
  // live path succeeded — remove NeedsHuman marker
  writeFileSync(
    join(evidenceDir, 'BLOCKER.md'),
    `# Dogfood blocker cleared\n\nLive Pi dogfood completed for project ${projectRoot}\n`,
  )
}

writeFileSync(
  join(evidenceDir, 'SUMMARY.md'),
  `# Dogfood harness\n\nlive=${live}\nexecutor=${executorName}\nproject=${projectRoot}\nruns=${runs.join(',')}\n`,
)
process.stdout.write(`dogfood evidence: ${evidenceDir}\n`)

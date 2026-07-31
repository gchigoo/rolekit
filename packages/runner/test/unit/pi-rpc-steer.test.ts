import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ExecutorIncompatibleError } from '../../src/errors.ts'
import { DEFAULT_GATE_POLICY } from '../../src/loaders.ts'
import { createAdapter } from '../../src/registry.ts'
import type { RunContext, RunState, TaskContract } from '../../src/types.ts'

const task: TaskContract = {
  schema: 'rolekit/task-contract@1',
  id: 'RK-PI-STEER-TEST',
  kind: 'implementation',
  role: 'implementer',
  executor: 'pi',
  objective: 'test pi steering',
  context: { required_files: [], docs: [] },
  scope: { writable: ['src/**'], forbidden: [] },
  constraints: [],
  deliverables: ['test'],
  acceptance: { commands: [{ run: 'node -e "process.exit(0)"', expect_exit: 0 }], assertions: [] },
  execution: { worktree: 'isolated', max_tool_calls: 10, network: 'deny', timeout_minutes: 5 },
  escalation: {
    on_scope_change: 'return_blocked',
    on_new_dependency: 'require_approval',
    on_ambiguous_requirement: 'return_question',
  },
}

async function fixture(rejectMode = false): Promise<{
  root: string
  runDir: string
  logPath: string
  piBin: string
  ctx: RunContext
}> {
  const root = await mkdtemp(join(tmpdir(), 'rolekit-pi-rpc-'))
  const runDir = join(root, '.rolekit', 'runs', 'run-pi-steer')
  const logPath = join(root, 'rpc-log.jsonl')
  await mkdir(join(runDir, 'artifacts'), { recursive: true })
  const state: RunState = {
    run_id: 'run-pi-steer',
    task_id: task.id,
    attempt: 1,
    adapter: 'pi-rpc',
    verifier_mode: 'minimal',
    worktree_path: root,
    state: 'running',
    phase: 'starting',
    updated_at: new Date().toISOString(),
  }
  await writeFile(join(runDir, 'run-state.json'), JSON.stringify(state), 'utf8')
  await writeFile(join(runDir, 'prompt.md'), 'prompt with {"nested":true}', 'utf8')
  await writeFile(join(runDir, 'events.jsonl'), '', 'utf8')

  const scriptPath = join(root, 'fake-pi.mjs')
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const log = ${JSON.stringify(logPath)}
if (process.argv.includes('--version')) {
  process.stdout.write('pi 0.82.4\\n')
  process.exit(0)
}
let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffered += chunk
  for (;;) {
    const newline = buffered.indexOf('\\n')
    if (newline < 0) break
    const line = buffered.slice(0, newline)
    buffered = buffered.slice(newline + 1)
    if (!line) continue
    appendFileSync(log, line + '\\n', 'utf8')
    const request = JSON.parse(line)
    if (request.type === 'set_steering_mode') {
      process.stdout.write(JSON.stringify({type:'response',id:request.id,success:${rejectMode ? 'false' : 'true'},data:{nested:{mode:request.mode}}}) + '\\n')
      ${rejectMode ? 'setTimeout(() => process.exit(0), 50)' : ''}
    } else if (request.type === 'prompt') {
      process.stdout.write(JSON.stringify({type:'response',id:request.id,success:true,data:{accepted:true}}) + '\\n')
    } else if (request.type === 'steer') {
      process.stdout.write(JSON.stringify({type:'response',id:request.id,success:true,data:{queued:{nested:true}}}) + '\\n')
      process.stdout.write(JSON.stringify({type:'agent_settled'}) + '\\n')
      setTimeout(() => process.exit(0), 200)
    }
  }
})
`,
    'utf8',
  )
  await chmod(scriptPath, 0o755)
  let piBin = scriptPath
  if (process.platform === 'win32') {
    piBin = join(root, 'fake-pi.cmd')
    await writeFile(piBin, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8')
  }
  return {
    root,
    runDir,
    logPath,
    piBin,
    ctx: {
      worktreePath: root,
      runDir,
      attempt: 1,
      profile: {
        schema: 'rolekit/role-profile@1',
        name: 'implementer',
        capabilities: [],
        boundaries: [],
        deliverables: [],
        verification: [],
        prompt_fragments: [],
      },
      policy: DEFAULT_GATE_POLICY,
    },
  }
}

describe('PiRpcExecutor durable steer transport', () => {
  it('sets one-at-a-time before prompt and sends exact request id/message', async () => {
    const { root, logPath, piBin, ctx } = await fixture()
    const adapter = createAdapter('pi-rpc', {
      projectRoot: root,
      compatRange: '>=0.80 <0.90',
      settings: { pi_bin: piBin },
    })
    const probe = await adapter.probe()
    assert.equal(probe.capabilities.includes('steer'), true)
    await adapter.start(task, ctx)
    await adapter.steer('run-pi-steer', 'continue {"nested":{"ok":true}}', {
      requestId: 'durable-request-1',
    })
    const lines = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(lines[0].type, 'set_steering_mode')
    assert.equal(lines[0].mode, 'one-at-a-time')
    assert.equal(lines[1].type, 'prompt')
    assert.equal(lines[2].type, 'steer')
    assert.equal(lines[2].id, 'durable-request-1')
    assert.equal(lines[2].message, 'continue {"nested":{"ok":true}}')
  })

  it('treats steering-mode rejection as incompatible before prompt or started event', async () => {
    const { root, runDir, logPath, piBin, ctx } = await fixture(true)
    const adapter = createAdapter('pi-rpc', {
      projectRoot: root,
      compatRange: '>=0.80 <0.90',
      settings: { pi_bin: piBin },
    })
    await assert.rejects(() => adapter.start(task, ctx), ExecutorIncompatibleError)
    const requests = (await readFile(logPath, 'utf8')).trim().split('\n')
    assert.equal(requests.length, 1)
    assert.ok(requests[0])
    assert.equal(JSON.parse(requests[0]).type, 'set_steering_mode')
    assert.equal(await readFile(join(runDir, 'events.jsonl'), 'utf8'), '')
  })
})

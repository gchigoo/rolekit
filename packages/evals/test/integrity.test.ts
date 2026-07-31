import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { auditRunIntegrity } from '../src/integrity.ts'

const task = {
  schema: 'rolekit/task-contract@1',
  id: 'task-1',
  kind: 'implementation',
  role: 'implementer',
  executor: 'mock',
  objective: 'test',
  context: { required_files: [], docs: [] },
  scope: { writable: ['src/**'], forbidden: [] },
  constraints: [],
  deliverables: [],
  acceptance: { commands: [{ run: 'node -e "process.exit(0)"', expect_exit: 0 }], assertions: [] },
  execution: { worktree: 'isolated', max_tool_calls: 10, network: 'deny', timeout_minutes: 5 },
  escalation: {
    on_scope_change: 'return_blocked',
    on_new_dependency: 'require_approval',
    on_ambiguous_requirement: 'return_question',
  },
}
const result = {
  schema: 'rolekit/result-envelope@1',
  task_id: 'task-1',
  status: 'completed',
  summary: 'ok',
  changed_files: [],
  verification: [],
  scope_violations: [],
  decisions: [],
  assumptions: [],
  evidence: [],
  risks: [],
  unresolved: [],
  recommended_next_action: '',
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rolekit-integrity-'))
  const started = '2026-07-29T00:00:00.000Z'
  const finished = '2026-07-29T00:00:01.000Z'
  await Promise.all([
    writeFile(join(dir, 'task.json'), JSON.stringify(task)),
    writeFile(join(dir, 'prompt.md'), 'prompt'),
    writeFile(join(dir, 'result.json'), JSON.stringify(result)),
    writeFile(
      join(dir, 'verification.json'),
      JSON.stringify({ passed: true, results: [], scope_violations: [] }),
    ),
    writeFile(
      join(dir, 'run-state.json'),
      JSON.stringify({
        run_id: 'run-1',
        task_id: 'task-1',
        attempt: 1,
        state: 'finished',
        phase: 'terminal',
        terminal_status: 'completed',
      }),
    ),
    writeFile(
      join(dir, 'events.jsonl'),
      `${JSON.stringify({ schema: 'rolekit/run-event@1', ts: started, run_id: 'run-1', type: 'started', payload: { task_id: 'task-1', adapter: 'mock', worktree: 'worktree' } })}\n${JSON.stringify({ schema: 'rolekit/run-event@1', ts: finished, run_id: 'run-1', type: 'finished', payload: { status: 'completed', reason: null } })}\n`,
    ),
  ])
  return dir
}

describe('auditRunIntegrity', () => {
  it('accepts a consistent terminal run and detects scope projection drift', async () => {
    const dir = await fixture()
    assert.deepEqual(await auditRunIntegrity(dir), { pass: true, errors: [] })
    await writeFile(
      join(dir, 'verification.json'),
      JSON.stringify({ passed: false, results: [], scope_violations: ['src/oops'] }),
    )
    const broken = await auditRunIntegrity(dir)
    assert.equal(broken.pass, false)
    assert.ok(broken.errors.includes('scope_violations_mismatch'))
  })
})

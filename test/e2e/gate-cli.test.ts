import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTempProject } from '../../packages/runner/test/helpers/temp-project.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cliEntry = join(root, 'packages/cli/bin/rolekit.js')

function runRolekit(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('rolekit gate CLI e2e', () => {
  it('prefix routing: WI missing exit1, other prefix exit2', () => {
    const { root: project } = createTempProject()
    const wi = runRolekit(['gate', 'list', 'WI-20260728-001', '--json'], project)
    assert.equal(wi.status, 1)
    assert.equal(JSON.parse(wi.stdout).error, 'workitem_not_found')
    const bad = runRolekit(['gate', 'list', 'xyz-1', '--json'], project)
    assert.equal(bad.status, 2)
    assert.equal(JSON.parse(bad.stdout).error, 'invalid_gate_target')
  })

  it('confirm → list → approve → completed; finished approve is no-op', () => {
    const { root: project, taskSuccess } = createTempProject()
    writeFileSync(join(project, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(project, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    writeFileSync(
      join(project, '.rolekit', 'policies', 'gates.yaml'),
      [
        'schema: rolekit/gate-policy@1',
        'default_action: ignore',
        'triggers:',
        '  new-dependency: confirm',
        '  migration: block',
        '  public-api-change: confirm',
        '  delete: confirm',
        '  scope-violation: block',
        '  ambiguous-requirement: confirm',
        '  design-artifact: confirm',
        '  final-acceptance: confirm',
        '',
      ].join('\n'),
      'utf8',
    )

    const { id } = startDetached(project, taskSuccess)

    // wait until awaiting-gate
    let state = 'running'
    for (let i = 0; i < 80 && state === 'running'; i += 1) {
      const st = runRolekit(['run', 'status', id, '--json'], project)
      assert.equal(st.status, 0, st.stderr || st.stdout)
      state = (JSON.parse(st.stdout) as { state: string }).state
      if (state === 'running') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
    assert.equal(state, 'awaiting-gate')

    const listed = runRolekit(['gate', 'list', id, '--json'], project)
    assert.equal(listed.status, 0, listed.stderr || listed.stdout)
    const pending = JSON.parse(listed.stdout) as {
      pending: Array<{ trigger: string }>
    }
    assert.ok(pending.pending.length >= 1)
    assert.ok(pending.pending.some((p) => p.trigger === 'public-api-change'))

    const approve = runRolekit(
      ['gate', 'approve', id, '--reason', 'ok', '--by', 'tester', '--json'],
      project,
    )
    assert.equal(approve.status, 0, approve.stderr || approve.stdout)
    const approved = JSON.parse(approve.stdout) as { decision: string; no_op: boolean }
    assert.equal(approved.decision, 'approved')
    assert.equal(approved.no_op, false)

    const collect = runRolekit(['run', 'collect', id, '--json'], project)
    assert.equal(collect.status, 0, collect.stderr || collect.stdout)
    const result = JSON.parse(collect.stdout) as { result: { status: string } }
    assert.equal(result.result.status, 'completed')

    const again = runRolekit(['gate', 'approve', id, '--json'], project)
    assert.equal(again.status, 0)
    assert.equal(JSON.parse(again.stdout).no_op, true)

    const gates = JSON.parse(
      readFileSync(join(project, '.rolekit', 'runs', id, 'gates.json'), 'utf8'),
    )
    assert.ok(
      gates.records.some(
        (r: { resolution?: { result: string } }) => r.resolution?.result === 'approved',
      ),
    )
  })

  it('no_pending_gate on finished minimal success', () => {
    const { root: project, taskSuccess } = createTempProject()
    const start = runRolekit(['run', 'start', taskSuccess, '--json'], project)
    assert.equal(start.status, 0, start.stderr || start.stdout)
    const { id } = JSON.parse(start.stdout) as { id: string }
    const reject = runRolekit(['gate', 'reject', id, '--json'], project)
    assert.equal(reject.status, 1)
    assert.equal(JSON.parse(reject.stdout).error, 'no_pending_gate')
  })

  it('four checkpoint crash recovery: pre-await + resuming via status/list/collect/gate', () => {
    const { root: project, taskSuccess } = createTempProject()
    writeFileSync(join(project, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(project, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    writeFileSync(
      join(project, '.rolekit', 'policies', 'gates.yaml'),
      [
        'schema: rolekit/gate-policy@1',
        'default_action: ignore',
        'triggers:',
        '  new-dependency: confirm',
        '  migration: block',
        '  public-api-change: confirm',
        '  delete: confirm',
        '  scope-violation: block',
        '  ambiguous-requirement: confirm',
        '  design-artifact: confirm',
        '  final-acceptance: confirm',
        '',
      ].join('\n'),
      'utf8',
    )

    const { id } = startDetached(project, taskSuccess)
    waitForState(project, id, 'awaiting-gate')

    const runDir = join(project, '.rolekit', 'runs', id)
    const statePath = join(runDir, 'run-state.json')

    // checkpoint 1: pre-await — evidence present, state still finalizing/running
    const awaitingState = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          ...awaitingState,
          phase: 'finalizing',
          state: 'running',
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )
    assert.ok(readFileSync(join(runDir, 'verification.json'), 'utf8'))
    assert.ok(readFileSync(join(runDir, 'artifacts', 'candidate.json'), 'utf8'))
    assert.ok(readFileSync(join(runDir, 'artifacts', 'integration.patch'), 'utf8'))
    const pendingGates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
    assert.ok(
      pendingGates.records.some((r: { decision: string }) => r.decision === 'human-required'),
    )

    // entry: status reconciles to awaiting-gate
    const st1 = runRolekit(['run', 'status', id, '--json'], project)
    assert.equal(st1.status, 0, st1.stderr || st1.stdout)
    assert.equal(JSON.parse(st1.stdout).state, 'awaiting-gate')

    // re-inject pre-await and recover via gate list
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          ...JSON.parse(readFileSync(statePath, 'utf8')),
          phase: 'finalizing',
          state: 'running',
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )
    const listed = runRolekit(['gate', 'list', id, '--json'], project)
    assert.equal(listed.status, 0, listed.stderr || listed.stdout)
    assert.equal(JSON.parse(listed.stdout).state, 'awaiting-gate')
    assert.ok(JSON.parse(listed.stdout).pending.length >= 1)

    // re-inject and recover via collect (should surface awaiting, not integrate)
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          ...JSON.parse(readFileSync(statePath, 'utf8')),
          phase: 'finalizing',
          state: 'running',
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )
    const collectAwait = runRolekit(['run', 'collect', id, '--json'], project)
    // collect may exit non-zero when awaiting; either way state must be awaiting-gate
    const afterCollect = runRolekit(['run', 'status', id, '--json'], project)
    assert.equal(JSON.parse(afterCollect.stdout).state, 'awaiting-gate', collectAwait.stdout)

    // checkpoint 2–3: inject second pending confirm; approve resolves all (batch)
    const gatesObj = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8')) as {
      schema: string
      records: Array<Record<string, unknown>>
    }
    gatesObj.records.push({
      trigger: 'delete',
      action: 'confirm',
      decision: 'human-required',
      evidence: 'artifacts/change-manifest.json',
      ts: new Date().toISOString(),
    })
    writeFileSync(join(runDir, 'gates.json'), JSON.stringify(gatesObj, null, 2), 'utf8')

    // checkpoint 4 setup: approve writes resolution+resuming; simulate crash before finalizer by
    // manually applying resolution+resuming then calling status/collect to finish
    const approve = runRolekit(
      ['gate', 'approve', id, '--reason', 'batch', '--by', 'tester', '--json'],
      project,
    )
    assert.equal(approve.status, 0, approve.stderr || approve.stdout)

    // If approve already finished, re-simulate resuming crash path on a fresh awaiting run below.
    const finishedState = JSON.parse(
      runRolekit(['run', 'status', id, '--json'], project).stdout,
    ) as { state: string }
    if (finishedState.state !== 'finished') {
      waitForState(project, id, 'finished')
    }

    // Fresh project for resuming-only recovery (avoid primary dirty after first integrate)
    const { root: project2, taskSuccess: task2 } = createTempProject()
    writeFileSync(join(project2, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(project2, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    writeFileSync(
      join(project2, '.rolekit', 'policies', 'gates.yaml'),
      [
        'schema: rolekit/gate-policy@1',
        'default_action: ignore',
        'triggers:',
        '  new-dependency: confirm',
        '  migration: block',
        '  public-api-change: confirm',
        '  delete: confirm',
        '  scope-violation: block',
        '  ambiguous-requirement: confirm',
        '  design-artifact: confirm',
        '  final-acceptance: confirm',
        '',
      ].join('\n'),
      'utf8',
    )
    const id2 = startDetached(project2, task2).id
    waitForState(project2, id2, 'awaiting-gate')
    const runDir2 = join(project2, '.rolekit', 'runs', id2)
    const gates2 = JSON.parse(readFileSync(join(runDir2, 'gates.json'), 'utf8')) as {
      schema: string
      records: Array<Record<string, unknown>>
    }
    const ts = new Date().toISOString()
    for (const rec of gates2.records) {
      if (rec.decision === 'human-required') {
        rec.resolution = { result: 'approved', by: 'tester', reason: 'resume', ts }
      }
    }
    writeFileSync(join(runDir2, 'gates.json'), JSON.stringify(gates2, null, 2), 'utf8')
    const st2 = JSON.parse(readFileSync(join(runDir2, 'run-state.json'), 'utf8'))
    writeFileSync(
      join(runDir2, 'run-state.json'),
      JSON.stringify({ ...st2, phase: 'resuming', state: 'running', updated_at: ts }, null, 2),
      'utf8',
    )
    const statusResume = runRolekit(['run', 'status', id2, '--json'], project2)
    assert.equal(statusResume.status, 0, statusResume.stderr || statusResume.stdout)
    waitForState(project2, id2, 'finished')
    const result2 = JSON.parse(readFileSync(join(runDir2, 'result.json'), 'utf8'))
    assert.equal(result2.status, 'completed')
    assert.ok(readFileSync(join(runDir2, 'verification.json'), 'utf8'))
  })

  it('awaiting cancel keeps verification and does not integrate', () => {
    const { root: project, taskSuccess } = createTempProject()
    writeFileSync(join(project, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(project, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    const { id } = startDetached(project, taskSuccess)
    waitForState(project, id, 'awaiting-gate')
    const runDir = join(project, '.rolekit', 'runs', id)
    const verificationBefore = readFileSync(join(runDir, 'verification.json'), 'utf8')
    const cancel = runRolekit(['run', 'cancel', id, '--json'], project)
    assert.equal(cancel.status, 0, cancel.stderr || cancel.stdout)
    waitForState(project, id, 'finished')
    assert.equal(readFileSync(join(runDir, 'verification.json'), 'utf8'), verificationBefore)
    const result = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'))
    assert.equal(result.status, 'cancelled')
    const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
    assert.ok(
      gates.records.every(
        (r: { resolution?: { result: string } }) =>
          !r.resolution || r.resolution.result === 'cancelled',
      ),
    )
  })
})

function startDetached(project: string, taskPath: string): { id: string } {
  let last = { status: 1 as number | null, stdout: '', stderr: '' }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = runRolekit(['run', 'start', taskPath, '--detach', '--json'], project)
    if (last.status === 0) {
      return JSON.parse(last.stdout) as { id: string }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * (attempt + 1))
  }
  assert.equal(last.status, 0, last.stderr || last.stdout)
  return JSON.parse(last.stdout) as { id: string }
}

function waitForState(project: string, id: string, want: string): void {
  let state = 'running'
  for (let i = 0; i < 100 && state !== want && state !== 'finished'; i += 1) {
    const st = runRolekit(['run', 'status', id, '--json'], project)
    assert.equal(st.status, 0, st.stderr || st.stdout)
    state = (JSON.parse(st.stdout) as { state: string }).state
    if (state !== want && state !== 'finished') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
  if (want !== 'finished') {
    assert.equal(state, want)
  } else {
    assert.equal(state, 'finished')
  }
}

import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { validateArtifact } from '@rolekit/core'
import {
  DEFAULT_GATE_POLICY,
  loadRolekitConfig,
  loadRunInput,
  loadSnapshots,
} from '../../src/loaders.ts'
import { RunManager } from '../../src/run-manager.ts'
import { createTempProject } from '../helpers/temp-project.ts'

describe('gate pipeline / coordinator', () => {
  it('default verifier_mode is enhanced when rolekit.yaml missing', async () => {
    const { root } = createTempProject()
    rmSync(join(root, '.rolekit', 'rolekit.yaml'))
    const cfg = await loadRolekitConfig(root)
    assert.equal(cfg.verifier_mode, 'enhanced')
  })

  it('ignore action records no gates/events for hit trigger', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(root, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    writeFileSync(
      join(root, '.rolekit', 'policies', 'gates.yaml'),
      [
        'schema: rolekit/gate-policy@1',
        'default_action: ignore',
        'triggers:',
        '  new-dependency: confirm',
        '  migration: block',
        '  public-api-change: ignore',
        '  delete: confirm',
        '  scope-violation: block',
        '  ambiguous-requirement: confirm',
        '  design-artifact: confirm',
        '  final-acceptance: confirm',
        '',
      ].join('\n'),
      'utf8',
    )
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
    assert.equal(gates.records.length, 0)
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.equal(events.includes('"type":"gate"'), false)
  })

  it('loadSnapshots keeps frozen policy/detect after source file edits', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(root, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    writeFileSync(
      join(root, '.rolekit', 'policies', 'gates.yaml'),
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
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    const before = await loadSnapshots(runDir)
    assert.equal(before.policy.triggers['public-api-change'], 'confirm')
    assert.ok(before.detect_snapshot?.api_paths.includes('src/**'))
    // 改源配置不得影响已落盘 snapshot（不 start：避免 concurrent-change 污染主树）
    writeFileSync(
      join(root, '.rolekit', 'policies', 'gates.yaml'),
      [
        'schema: rolekit/gate-policy@1',
        'default_action: ignore',
        'triggers:',
        '  new-dependency: ignore',
        '  migration: ignore',
        '  public-api-change: ignore',
        '  delete: ignore',
        '  scope-violation: block',
        '  ambiguous-requirement: ignore',
        '  design-artifact: ignore',
        '  final-acceptance: ignore',
        '',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(join(root, '.rolekit', 'policies', 'detect.yaml'), 'api_paths: []\n', 'utf8')
    const after = await loadSnapshots(runDir)
    assert.deepEqual(after.policy, before.policy)
    assert.deepEqual(after.detect_snapshot, before.detect_snapshot)
    assert.equal(after.policy.triggers['public-api-change'], 'confirm')
  })

  it('minimal success writes empty gates wrapper and completed envelope', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
    const v = validateArtifact('rolekit/gate-record@1', gates)
    assert.equal(v.valid, true, JSON.stringify(v))
    assert.deepEqual(gates.records, [])
  })

  it('scope violation writes single block record and failed envelope', async () => {
    const { root, taskForbidden } = createTempProject()
    const input = await loadRunInput(taskForbidden, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    await rm.waitUntilSettled(handle.run_id)
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
    assert.equal(gates.records.length, 1)
    assert.equal(gates.records[0].trigger, 'scope-violation')
    assert.equal(gates.records[0].action, 'block')
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    const gateLines = events
      .split('\n')
      .filter((l) => l.includes('"type":"gate"') && l.includes('scope-violation'))
    assert.equal(gateLines.length, 1)
    assert.match(gateLines[0]!, /gates\.json#records\/0/)
  })

  it('enhanced observe path writes observe record and completes without human gate', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(root, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    writeFileSync(
      join(root, '.rolekit', 'policies', 'gates.yaml'),
      [
        'schema: rolekit/gate-policy@1',
        'default_action: ignore',
        'triggers:',
        '  new-dependency: confirm',
        '  migration: block',
        '  public-api-change: observe',
        '  delete: confirm',
        '  scope-violation: block',
        '  ambiguous-requirement: confirm',
        '  design-artifact: confirm',
        '  final-acceptance: confirm',
        '',
      ].join('\n'),
      'utf8',
    )
    // re-commit policy files into git so worktree sees them? snapshots come from loader at prepare
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    assert.equal(input.verifier_mode, 'enhanced')
    assert.ok(input.detect_snapshot)
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'finished')
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    const result = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'))
    assert.equal(result.status, 'completed')
    const gates = JSON.parse(readFileSync(join(runDir, 'gates.json'), 'utf8'))
    assert.ok(gates.records.some((r: { action: string }) => r.action === 'observe'))
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    assert.match(events, /"action":"observe"/)
    assert.ok(readFileSync(join(runDir, 'detect-snapshot.json'), 'utf8'))
    assert.ok(readFileSync(join(runDir, 'artifacts', 'change-manifest.json'), 'utf8'))
  })

  it('enhanced confirm awaits then approve integrates', async () => {
    const { root, taskSuccess } = createTempProject()
    writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: enhanced\n', 'utf8')
    writeFileSync(
      join(root, '.rolekit', 'policies', 'detect.yaml'),
      'api_paths:\n  - src/**\n',
      'utf8',
    )
    // default policy keeps public-api-change: confirm
    const input = await loadRunInput(taskSuccess, {
      projectRoot: root,
      policy: DEFAULT_GATE_POLICY,
    })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    await rm.startPrepared(handle.run_id)
    const settled = await rm.waitUntilSettled(handle.run_id)
    assert.equal(settled.state, 'awaiting-gate')
    const listed = await rm.listGates(handle.run_id)
    assert.ok(listed.pending.length >= 1)
    const approved = await rm.approveGates(handle.run_id, { reason: 'ok', by: 'tester' })
    assert.equal(approved.decision, 'approved')
    const done = await rm.waitUntilSettled(handle.run_id)
    assert.equal(done.state, 'finished')
    const result = JSON.parse(
      readFileSync(join(root, '.rolekit', 'runs', handle.run_id, 'result.json'), 'utf8'),
    )
    assert.equal(result.status, 'completed')
  })
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { RolekitError } from '@rolekit/core'
import { sha256Canonical } from '../../src/canonical-json.ts'
import { RunManagerError } from '../../src/errors.ts'
import { buildInputDigestObject, loadRunInput } from '../../src/loaders.ts'
import { RunManager } from '../../src/run-manager.ts'
import { createTempProject } from '../helpers/temp-project.ts'

/**
 * Seeds a minimal project for knowledge snapshot loader tests.
 */
function seedProject(withRule: boolean): { root: string; taskPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'rk-kn-snap-'))
  mkdirSync(join(root, '.rolekit', 'profiles', 'roles'), { recursive: true })
  mkdirSync(join(root, '.rolekit', 'profiles', 'executors'), { recursive: true })
  writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: minimal\n', 'utf8')
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'roles', 'minimal-implementer.yaml'),
    [
      'schema: rolekit/role-profile@1',
      'name: minimal-implementer',
      'capabilities: []',
      'boundaries: []',
      'deliverables: []',
      'verification: []',
      'prompt_fragments: []',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
    ['schema: rolekit/executor-profile@1', 'name: mock', 'adapter: mock', ''].join('\n'),
    'utf8',
  )
  if (withRule) {
    mkdirSync(join(root, '.rolekit', 'knowledge'), { recursive: true })
    writeFileSync(
      join(root, '.rolekit', 'knowledge', 'KN-1.md'),
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-1',
        'type: rule',
        'title: Small',
        'status: active',
        'tags: []',
        'created: "2026-07-29T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        'Prefer smallest change.',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  const taskPath = join(root, 'task.yaml')
  writeFileSync(
    taskPath,
    [
      'schema: rolekit/task-contract@1',
      'id: RK-KN-SNAP',
      'kind: implementation',
      'role: minimal-implementer',
      'executor: mock',
      'objective: snap',
      'context: { required_files: [], docs: [] }',
      'scope: { writable: [src/**], forbidden: [.env] }',
      'constraints: []',
      'deliverables: [ok]',
      'acceptance:',
      '  commands: [{ run: "node -e \\"process.exit(0)\\"", expect_exit: 0 }]',
      '  assertions: [ok]',
      'execution:',
      '  worktree: isolated',
      '  max_tool_calls: 1',
      '  network: deny',
      '  timeout_minutes: 1',
      'escalation:',
      '  on_scope_change: return_blocked',
      '  on_new_dependency: require_approval',
      '  on_ambiguous_requirement: return_question',
      '',
    ].join('\n'),
    'utf8',
  )
  return { root, taskPath }
}

describe('knowledge snapshot loader', () => {
  it('includes empty knowledge_rules in digest when catalog missing', async () => {
    const { root, taskPath } = seedProject(false)
    const input = await loadRunInput(taskPath, { projectRoot: root })
    assert.deepEqual(input.knowledgeSnapshot.rules, [])
    const digestObj = buildInputDigestObject(input) as { knowledge_rules: unknown[] }
    assert.deepEqual(digestObj.knowledge_rules, [])
    assert.ok('knowledge_rules' in digestObj)
  })

  it('hashes active rule body via RFC8785 and ignores tags in hash', async () => {
    const { root, taskPath } = seedProject(true)
    const input = await loadRunInput(taskPath, { projectRoot: root })
    assert.equal(input.knowledgeSnapshot.rules.length, 1)
    const rule = input.knowledgeSnapshot.rules[0]!
    assert.equal(
      rule.content_sha256,
      sha256Canonical({ id: 'KN-1', title: 'Small', body: 'Prefer smallest change.' }),
    )
    const digestObj = buildInputDigestObject(input) as {
      knowledge_rules: Array<{ id: string; content_sha256: string }>
    }
    assert.equal(digestObj.knowledge_rules[0]!.id, 'KN-1')
    assert.equal(digestObj.knowledge_rules[0]!.content_sha256, rule.content_sha256)

    writeFileSync(
      join(root, '.rolekit', 'knowledge', 'KN-1.md'),
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-1',
        'type: rule',
        'title: Small',
        'status: active',
        'tags: [attention]',
        'created: "2026-07-29T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        'Prefer smallest change.',
        '',
      ].join('\n'),
      'utf8',
    )
    const tagged = await loadRunInput(taskPath, { projectRoot: root })
    const taggedDigest = buildInputDigestObject(tagged) as {
      knowledge_rules: Array<{ id: string; content_sha256: string }>
    }
    assert.equal(taggedDigest.knowledge_rules[0]!.content_sha256, rule.content_sha256)
    assert.equal(sha256Canonical(taggedDigest), sha256Canonical(digestObj))

    writeFileSync(
      join(root, '.rolekit', 'knowledge', 'KN-1.md'),
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-1',
        'type: rule',
        'title: Renamed',
        'status: active',
        'tags: [attention]',
        'created: "2026-07-29T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        'Prefer smallest change.',
        '',
      ].join('\n'),
      'utf8',
    )
    const renamed = await loadRunInput(taskPath, { projectRoot: root })
    assert.notEqual(sha256Canonical(buildInputDigestObject(renamed)), sha256Canonical(digestObj))
  })

  it('ignores non-md sidecar files in knowledge catalog', async () => {
    const { root, taskPath } = seedProject(true)
    writeFileSync(join(root, '.rolekit', 'knowledge', '.gitkeep'), '', 'utf8')
    const input = await loadRunInput(taskPath, { projectRoot: root })
    assert.equal(input.knowledgeSnapshot.rules.length, 1)
  })

  it('fresh bad catalog fails before any run allocation', async () => {
    const { root, taskSuccess } = createTempProject()
    mkdirSync(join(root, '.rolekit', 'knowledge'), { recursive: true })
    writeFileSync(join(root, '.rolekit', 'knowledge', 'KN-BAD.md'), 'not-valid\n', 'utf8')
    await assert.rejects(
      () => loadRunInput(taskSuccess, { projectRoot: root }),
      (err: unknown) => err instanceof RolekitError && err.code === 'knowledge_invalid',
    )
    assert.equal(existsSync(join(root, '.rolekit', 'runs')), false)
  })

  it('reservation-only same digest resumes materialize; mismatch is inconsistent', async () => {
    const { root, taskSuccess } = createTempProject()
    mkdirSync(join(root, '.rolekit', 'knowledge'), { recursive: true })
    writeFileSync(
      join(root, '.rolekit', 'knowledge', 'KN-1.md'),
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-1',
        'type: rule',
        'title: Small',
        'status: active',
        'tags: []',
        'created: "2026-07-29T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        'Prefer smallest change.',
        '',
      ].join('\n'),
      'utf8',
    )
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    unlinkSync(join(runDir, 'knowledge-snapshot.json'))
    unlinkSync(join(runDir, 'prompt.md'))
    writeFileSync(
      join(runDir, 'run-state.json'),
      JSON.stringify({
        ...JSON.parse(readFileSync(join(runDir, 'run-state.json'), 'utf8')),
        phase: 'preparing',
      }),
      'utf8',
    )

    const resumed = await rm.prepare({ ...input, retry: false })
    assert.equal(resumed.run_id, handle.run_id)
    assert.ok(existsSync(join(runDir, 'knowledge-snapshot.json')))
    assert.ok(existsSync(join(runDir, 'prompt.md')))
    const state = JSON.parse(readFileSync(join(runDir, 'run-state.json'), 'utf8')) as {
      phase: string
    }
    assert.equal(state.phase, 'prepared')

    writeFileSync(
      join(root, '.rolekit', 'knowledge', 'KN-1.md'),
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-1',
        'type: rule',
        'title: Changed',
        'status: active',
        'tags: []',
        'created: "2026-07-29T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        'Prefer smallest change.',
        '',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      join(runDir, 'run-state.json'),
      JSON.stringify({
        ...JSON.parse(readFileSync(join(runDir, 'run-state.json'), 'utf8')),
        phase: 'preparing',
      }),
      'utf8',
    )
    const changed = await loadRunInput(taskSuccess, { projectRoot: root })
    await assert.rejects(
      () => rm.prepare({ ...changed, retry: false }),
      (err: unknown) => err instanceof RunManagerError && err.code === 'run_state_inconsistent',
    )
  })

  it('reservation-only knowledge loader failure writes nothing new', async () => {
    const { root, taskSuccess } = createTempProject()
    const input = await loadRunInput(taskSuccess, { projectRoot: root })
    const rm = new RunManager(root)
    const handle = await rm.prepare({ ...input, retry: false })
    const runDir = join(root, '.rolekit', 'runs', handle.run_id)
    writeFileSync(
      join(runDir, 'run-state.json'),
      JSON.stringify({
        ...JSON.parse(readFileSync(join(runDir, 'run-state.json'), 'utf8')),
        phase: 'preparing',
      }),
      'utf8',
    )
    const before = createHash('sha256')
      .update(readFileSync(join(runDir, 'run-state.json')))
      .digest('hex')
    const indexFiles = readdirSync(join(root, '.rolekit', 'runs', '.index'), { recursive: true })
      .map(String)
      .sort()

    mkdirSync(join(root, '.rolekit', 'knowledge'), { recursive: true })
    writeFileSync(join(root, '.rolekit', 'knowledge', 'KN-BAD.md'), 'broken\n', 'utf8')
    await assert.rejects(
      () => loadRunInput(taskSuccess, { projectRoot: root }),
      (err: unknown) => err instanceof RolekitError && err.code === 'knowledge_invalid',
    )
    const after = createHash('sha256')
      .update(readFileSync(join(runDir, 'run-state.json')))
      .digest('hex')
    assert.equal(after, before)
    const indexAfter = readdirSync(join(root, '.rolekit', 'runs', '.index'), { recursive: true })
      .map(String)
      .sort()
    assert.deepEqual(indexAfter, indexFiles)
  })
})

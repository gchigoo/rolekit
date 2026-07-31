import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cliEntry = join(repoRoot, 'packages/cli/bin/rolekit.js')

/**
 * Runs rolekit CLI in a temp project root.
 */
function run(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
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

/**
 * Creates a minimal RoleKit project with mock profiles for run start.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'rk-kn-'))
  mkdirSync(join(root, '.rolekit', 'profiles', 'roles'), { recursive: true })
  mkdirSync(join(root, '.rolekit', 'profiles', 'executors'), { recursive: true })
  mkdirSync(join(root, '.rolekit', 'policies'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, '.rolekit', 'rolekit.yaml'), 'verifier_mode: minimal\n', 'utf8')
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'roles', 'minimal-implementer.yaml'),
    [
      'schema: rolekit/role-profile@1',
      'name: minimal-implementer',
      'capabilities: [edit]',
      'boundaries: [no claim]',
      'deliverables: [code]',
      'verification: [exit 0]',
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
  return root
}

describe('rolekit knowledge e2e', () => {
  it('create/get/search and injects active rule into mock run prompt', () => {
    const root = makeProject()
    const body = join(root, 'rule-body.txt')
    writeFileSync(body, 'Never write secrets into the worktree.\n', 'utf8')

    const created = run(root, [
      'knowledge',
      'create',
      '--type',
      'rule',
      '--title',
      'No secrets',
      '--body-file',
      body,
      '--tag',
      'security',
      '--json',
    ])
    assert.equal(created.status, 0, created.stderr + created.stdout)
    const createdJson = JSON.parse(created.stdout) as {
      entry: { frontmatter: { id: string } }
    }
    const id = createdJson.entry.frontmatter.id
    assert.match(id, /^KN-\d{8}-\d{3}$/)

    const got = run(root, ['knowledge', 'get', id, '--json'])
    assert.equal(got.status, 0, got.stderr + got.stdout)
    assert.match(got.stdout, /Never write secrets/)

    const search = run(root, [
      'knowledge',
      'search',
      '--type',
      'rule',
      '--status',
      'active',
      '--tag',
      'security',
      '--json',
    ])
    assert.equal(search.status, 0, search.stderr + search.stdout)
    const searchJson = JSON.parse(search.stdout) as { entries: unknown[] }
    assert.equal(searchJson.entries.length, 1)

    const noteBody = join(root, 'note-body.txt')
    writeFileSync(noteBody, '# Note\n\nA note body.\n', 'utf8')
    const note = run(root, [
      'knowledge',
      'create',
      '--type',
      'note',
      '--title',
      'Layout note',
      '--body-file',
      noteBody,
      '--json',
    ])
    assert.equal(note.status, 0, note.stderr + note.stdout)

    const taskPath = join(root, 'task.yaml')
    writeFileSync(
      taskPath,
      [
        'schema: rolekit/task-contract@1',
        'id: RK-KN-E2E-001',
        'kind: implementation',
        'role: minimal-implementer',
        'executor: mock',
        'objective: knowledge prompt inject',
        'context:',
        '  required_files: []',
        '  docs: []',
        'scope:',
        '  writable: [src/**]',
        '  forbidden: [.env]',
        'constraints: []',
        'deliverables: [ok]',
        'acceptance:',
        '  commands:',
        '    - run: node -e "process.exit(0)"',
        '      expect_exit: 0',
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

    spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: root, encoding: 'utf8' })
    writeFileSync(join(root, 'src', 'seed.txt'), 'seed\n', 'utf8')
    spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' })
    spawnSync('git', ['commit', '-m', 'init'], { cwd: root, encoding: 'utf8' })

    const started = run(root, ['run', 'start', taskPath, '--json'])
    assert.equal(started.status, 0, started.stderr + started.stdout)
    const startJson = JSON.parse(started.stdout) as { id: string }
    const promptPath = join(root, '.rolekit', 'runs', startJson.id, 'prompt.md')
    const snapshotPath = join(root, '.rolekit', 'runs', startJson.id, 'knowledge-snapshot.json')
    const prompt = readFileSync(promptPath, 'utf8')
    const snapshotRaw = readFileSync(snapshotPath, 'utf8')
    const snapshot = JSON.parse(snapshotRaw) as { rules: Array<{ id: string }> }
    assert.match(prompt, /rolekit:section:rules/)
    assert.match(prompt, new RegExp(id))
    assert.match(prompt, /Never write secrets/)
    assert.equal(snapshot.rules.length, 1)
    assert.equal(snapshot.rules[0]!.id, id)

    const edited = run(root, [
      'knowledge',
      'edit',
      id,
      '--title',
      'No secrets v2',
      '--tag',
      'security',
      '--tag',
      'attention',
      '--json',
    ])
    assert.equal(edited.status, 0, edited.stderr + edited.stdout)
    const editedJson = JSON.parse(edited.stdout) as {
      entry: { frontmatter: { title: string; tags: string[]; id: string; type: string } }
    }
    assert.equal(editedJson.entry.frontmatter.title, 'No secrets v2')
    assert.deepEqual(editedJson.entry.frontmatter.tags, ['attention', 'security'])
    assert.equal(editedJson.entry.frontmatter.id, id)
    assert.equal(editedJson.entry.frontmatter.type, 'rule')

    // Source edit must not mutate the already-prepared run snapshot/prompt.
    assert.equal(readFileSync(promptPath, 'utf8'), prompt)
    assert.equal(readFileSync(snapshotPath, 'utf8'), snapshotRaw)

    const immutable = run(root, ['knowledge', 'edit', id, '--type', 'note', '--json'])
    assert.equal(immutable.status, 2)

    const deprecated = run(root, [
      'knowledge',
      'set-status',
      id,
      '--status',
      'deprecated',
      '--json',
    ])
    assert.equal(deprecated.status, 0, deprecated.stderr + deprecated.stdout)

    writeFileSync(
      taskPath,
      readFileSync(taskPath, 'utf8').replace('RK-KN-E2E-001', 'RK-KN-E2E-002'),
      'utf8',
    )
    const started2 = run(root, ['run', 'start', taskPath, '--json'])
    assert.equal(started2.status, 0, started2.stderr + started2.stdout)
    const start2 = JSON.parse(started2.stdout) as { id: string }
    const snapshot2 = JSON.parse(
      readFileSync(join(root, '.rolekit', 'runs', start2.id, 'knowledge-snapshot.json'), 'utf8'),
    ) as { rules: unknown[] }
    const prompt2 = readFileSync(join(root, '.rolekit', 'runs', start2.id, 'prompt.md'), 'utf8')
    assert.equal(snapshot2.rules.length, 0)
    assert.ok(!prompt2.includes('rolekit:section:rules'))
  })

  it('validate four knowledge types positive and negative', () => {
    const fixtures = join(repoRoot, 'fixtures', 'knowledge-entry')
    const cases: Array<[string, number]> = [
      ['valid-rule-attention.md', 0],
      ['valid-adr-typescript.md', 0],
      ['valid-learning-lock.md', 0],
      ['valid-note-layout.md', 0],
      ['invalid-rule-multipart.md', 1],
      ['invalid-adr-missing-headings.md', 1],
      ['invalid-learning-extra-field.md', 1],
      ['invalid-note-bad-status.md', 1],
    ]
    for (const [name, expected] of cases) {
      const result = run(repoRoot, ['validate', join(fixtures, name), '--json'])
      assert.equal(result.status, expected, `${name}: ${result.stdout}${result.stderr}`)
    }
  })

  it('search fail-closed on bad catalog entry', () => {
    const root = makeProject()
    mkdirSync(join(root, '.rolekit', 'knowledge'), { recursive: true })
    writeFileSync(join(root, '.rolekit', 'knowledge', 'not-safe.md'), 'not valid\n', 'utf8')
    // overwrite with unsafe name via a file that fails validation
    writeFileSync(
      join(root, '.rolekit', 'knowledge', 'KN-BAD.md'),
      '---\nschema: rolekit/knowledge-entry@1\nid: OTHER\ntype: note\ntitle: x\nstatus: active\ntags: []\ncreated: "2026-07-29T00:00:00.000Z"\nsource: null\n---\n\nbody\n',
      'utf8',
    )
    const search = run(root, ['knowledge', 'search', '--json'])
    assert.equal(search.status, 1)
    const payload = JSON.parse(search.stdout) as { error: string }
    assert.equal(payload.error, 'knowledge_invalid')
  })
})

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesProject = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/project')
const fixturesTasks = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/tasks')

/**
 * Copies fixture project into a temp git repo and returns paths.
 */
export function createTempProject(): {
  root: string
  taskSuccess: string
  taskForbidden: string
} {
  const root = mkdtempSync(join(tmpdir(), 'rolekit-proj-'))
  cpSync(fixturesProject, root, { recursive: true })
  mkdirSync(join(root, '.rolekit', 'profiles', 'roles'), { recursive: true })
  mkdirSync(join(root, '.rolekit', 'profiles', 'executors'), { recursive: true })
  mkdirSync(join(root, '.rolekit', 'policies'), { recursive: true })
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
    [
      'schema: rolekit/executor-profile@1',
      'name: mock',
      'adapter: mock',
      'settings:',
      '  delay_ms: 50',
      '  write_file: src/implemented.txt',
      '  write_content: "implemented-by-mock\\n"',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(root, '.rolekit', 'profiles', 'executors', 'mock-leak.yaml'),
    [
      'schema: rolekit/executor-profile@1',
      'name: mock-leak',
      'adapter: mock',
      'settings:',
      '  delay_ms: 50',
      '  write_forbidden: true',
      '',
    ].join('\n'),
    'utf8',
  )
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@rolekit.local'], {
    cwd: root,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'rolekit-test'], { cwd: root, stdio: 'ignore' })
  // ignore local run artifacts
  writeFileSync(
    join(root, '.gitignore'),
    '.rolekit/runs/\n.rolekit/worktrees/\n.rolekit/integration.lock\n',
    'utf8',
  )
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' })

  const tasksDir = join(root, 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  const taskSuccess = join(tasksDir, 'mock-success.yaml')
  const taskForbidden = join(tasksDir, 'mock-forbidden.yaml')
  writeFileSync(taskSuccess, readFileSync(join(fixturesTasks, 'mock-success.yaml'), 'utf8'))
  writeFileSync(taskForbidden, readFileSync(join(fixturesTasks, 'mock-forbidden.yaml'), 'utf8'))
  return { root, taskSuccess, taskForbidden }
}

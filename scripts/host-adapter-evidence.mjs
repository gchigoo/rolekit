/**
 * Prepares a temp mock project, PATH wrapper for rolekit, and records skill version stamp.
 * Usage: node scripts/host-adapter-evidence.mjs prepare <host>
 *        node scripts/host-adapter-evidence.mjs stamp <host>
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createTempProject } from '../packages/runner/test/helpers/temp-project.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(root, 'evidence', 'host-adapter-skills')

/**
 * @param {string} host
 */
function hostDir(host) {
  return join(evidenceRoot, host)
}

/**
 * Ensures rolekit is invocable as `rolekit` via a PATH shim.
 */
function ensureRolekitShim() {
  const binDir = join(tmpdir(), 'rolekit-path-shim')
  mkdirSync(binDir, { recursive: true })
  const shim = join(binDir, 'rolekit')
  const cli = join(root, 'packages', 'cli', 'bin', 'rolekit.js').replace(/\\/g, '/')
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node "${cli}" "$@"\n`, 'utf8')
  try {
    chmodSync(shim, 0o755)
  } catch {
    // Windows may ignore chmod
  }
  // also write rolekit.cmd for cmd.exe hosts
  writeFileSync(
    join(binDir, 'rolekit.cmd'),
    `@echo off\r\nnode "${cli.replace(/\//g, '\\')}" %*\r\n`,
    'utf8',
  )
  return binDir
}

/**
 * @param {string} host
 */
function prepare(host) {
  const dir = hostDir(host)
  mkdirSync(dir, { recursive: true })
  const temp = createTempProject()
  // distinct deliverable so runs don't collide with fixture defaults
  const taskPath = join(temp.root, 'tasks', `adapter-${host}.yaml`)
  const body = readFileSync(temp.taskSuccess, 'utf8')
    .replace(/id: .*/, `id: RK-ADAPTER-${host.toUpperCase()}`)
    .replace(/objective: .*/, `objective: Write src/adapter-${host}.txt via mock executor`)
    .replace(/src\/implemented\.txt/g, `src/adapter-${host}.txt`)
  writeFileSync(taskPath, body, 'utf8')
  writeFileSync(
    join(temp.root, '.rolekit', 'profiles', 'executors', 'mock.yaml'),
    `schema: rolekit/executor-profile@1
name: mock
adapter: mock
settings:
  delay_ms: 20
  write_file: src/adapter-${host}.txt
  write_content: "adapter-${host}-ok\\n"
`,
    'utf8',
  )
  const shimDir = ensureRolekitShim()
  const meta = {
    host,
    projectRoot: temp.root,
    taskPath,
    shimDir,
    prepared_at: new Date().toISOString(),
  }
  writeFileSync(join(dir, 'project-meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(meta)}\n`)
}

/**
 * @param {string} host
 */
function stamp(host) {
  const dir = hostDir(host)
  mkdirSync(dir, { recursive: true })
  const skillPath = join(root, 'adapters', host, 'SKILL.md')
  const sha256 = createHash('sha256').update(readFileSync(skillPath)).digest('hex')
  let gitRev = 'unknown'
  try {
    gitRev = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    // ignore
  }
  const hosts = ['pi', 'cursor', 'codex']
  /** @type {Record<string, string>} */
  const allSha = {}
  for (const h of hosts) {
    allSha[h] = createHash('sha256')
      .update(readFileSync(join(root, 'adapters', h, 'SKILL.md')))
      .digest('hex')
  }
  const stampDoc = {
    host,
    git_rev: gitRev,
    skill_path: skillPath,
    skill_sha256: sha256,
    all_skill_sha256: allSha,
    stamped_at: new Date().toISOString(),
  }
  writeFileSync(join(dir, 'skill-version.json'), `${JSON.stringify(stampDoc, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(stampDoc, null, 2)}\n`)
}

/**
 * Copies a project run directory into evidence/<host>/run-dir.
 * @param {string} host
 * @param {string} runId
 */
function archiveRun(host, runId) {
  const meta = JSON.parse(readFileSync(join(hostDir(host), 'project-meta.json'), 'utf8'))
  const src = join(meta.projectRoot, '.rolekit', 'runs', runId)
  if (!existsSync(src)) throw new Error(`run not found: ${src}`)
  const dest = join(hostDir(host), 'run-dir')
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
  writeFileSync(
    join(hostDir(host), 'POINTER.md'),
    `run_id=${runId}\nrun_dir=${dest}\nproject=${meta.projectRoot}\n`,
  )
  process.stdout.write(`archived ${src} -> ${dest}\n`)
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const [cmd, host, runId] = process.argv.slice(2)
  if (cmd === 'prepare' && host) prepare(host)
  else if (cmd === 'stamp' && host) stamp(host)
  else if (cmd === 'archive-run' && host && runId) archiveRun(host, runId)
  else if (cmd === 'shim') process.stdout.write(`${ensureRolekitShim()}\n`)
  else {
    process.stderr.write(
      'usage: node scripts/host-adapter-evidence.mjs prepare|stamp|archive-run|shim <host> [runId]\n',
    )
    process.exit(2)
  }
}

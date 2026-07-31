/**
 * CMD-004 helper: validate five artifacts for each profile dogfood run directory.
 * Usage:
 *   node scripts/validate-profile-runs.mjs
 *   node scripts/validate-profile-runs.mjs <runDir> [<runDir>...]
 *
 * Default discovers evidence/role-profiles-migration/runs/<run-id>/.
 * Schema-bearing files use rolekit validate; events.jsonl is line-validated;
 * prompt.md / verification.json use presence + shape checks (same as host-adapter helper).
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'packages/cli/bin/rolekit.js')
const defaultRunsRoot = join(root, 'evidence/role-profiles-migration/runs')
const ARTIFACTS = ['task.json', 'prompt.md', 'events.jsonl', 'result.json', 'verification.json']

/**
 * Lists run directories under a parent, or returns explicit args.
 */
function resolveRunDirs(argv) {
  if (argv.length > 0) {
    return argv.map((p) => (p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : join(root, p)))
  }
  if (!existsSync(defaultRunsRoot)) {
    process.stderr.write(`no runs directory: ${defaultRunsRoot}\n`)
    process.exit(1)
  }
  return readdirSync(defaultRunsRoot)
    .map((name) => join(defaultRunsRoot, name))
    .filter((p) => statSync(p).isDirectory())
    .sort()
}

/**
 * Runs rolekit validate on a file.
 */
function rolekitValidate(file) {
  const r = spawnSync(process.execPath, [cli, 'validate', file, '--json'], {
    encoding: 'utf8',
    cwd: root,
  })
  return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') }
}

/**
 * Validates one run directory's five artifacts.
 */
function validateRunDir(runDir) {
  let ok = true
  process.stdout.write(`\n== ${runDir} ==\n`)
  for (const name of ARTIFACTS) {
    const file = join(runDir, name)
    if (!existsSync(file)) {
      process.stderr.write(`missing ${name}\n`)
      ok = false
      continue
    }
    if (name === 'task.json' || name === 'result.json') {
      const v = rolekitValidate(file)
      process.stdout.write(`  rolekit validate ${name} ok=${v.ok}\n`)
      if (!v.ok) {
        process.stderr.write(v.output)
        ok = false
      }
      continue
    }
    if (name === 'events.jsonl') {
      const lines = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      if (lines.length === 0) {
        process.stderr.write(`  events.jsonl empty\n`)
        ok = false
        continue
      }
      const tmp = mkdtempSync(join(tmpdir(), 'rk-profile-events-'))
      let lineFail = false
      for (let i = 0; i < lines.length; i += 1) {
        const tmpFile = join(tmp, `event-${i}.json`)
        writeFileSync(tmpFile, `${lines[i]}\n`)
        const v = rolekitValidate(tmpFile)
        if (!v.ok) {
          process.stderr.write(`  events.jsonl line ${i} invalid\n${v.output}`)
          lineFail = true
        }
      }
      process.stdout.write(
        `  rolekit validate events.jsonl lines=${lines.length} ok=${!lineFail}\n`,
      )
      if (lineFail) ok = false
      continue
    }
    if (name === 'verification.json') {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        const shapeOk =
          typeof data.passed === 'boolean' &&
          Array.isArray(data.results) &&
          Array.isArray(data.scope_violations)
        process.stdout.write(`  verification.json shape ok=${shapeOk}\n`)
        if (!shapeOk) ok = false
      } catch (error) {
        process.stderr.write(
          `  verification.json parse failed: ${error instanceof Error ? error.message : String(error)}\n`,
        )
        ok = false
      }
      continue
    }
    if (name === 'prompt.md') {
      const text = readFileSync(file, 'utf8')
      const anchors = [
        '<!-- rolekit:section:safety -->',
        '<!-- rolekit:section:role -->',
        '<!-- rolekit:section:task -->',
        '<!-- rolekit:section:acceptance -->',
        '<!-- rolekit:section:escalation -->',
      ]
      let orderOk = true
      let last = -1
      for (const anchor of anchors) {
        const idx = text.indexOf(anchor)
        if (idx < 0 || idx <= last) {
          orderOk = false
          break
        }
        last = idx
      }
      const nonEmpty = text.trim().length > 0
      process.stdout.write(`  prompt.md nonEmpty=${nonEmpty} anchors=${orderOk}\n`)
      if (!nonEmpty || !orderOk) ok = false
    }
  }
  return ok
}

const runDirs = resolveRunDirs(process.argv.slice(2))
if (runDirs.length === 0) {
  process.stderr.write('no run directories to validate\n')
  process.exit(1)
}

let allOk = true
for (const runDir of runDirs) {
  if (!validateRunDir(runDir)) allOk = false
}
process.exit(allOk ? 0 : 1)

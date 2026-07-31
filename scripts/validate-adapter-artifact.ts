/**
 * DoD helper: validate five run artifacts for each host under evidence/host-adapter-skills.
 * Resolves real paths from evidence (no placeholders).
 *
 * Schema-bearing files use `rolekit validate`. events.jsonl is validated line-by-line.
 * prompt.md and verification.json have no registered schema in the current CLI surface;
 * they are checked for presence + required shape.
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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(root, 'evidence', 'host-adapter-skills')
const cli = join(root, 'packages', 'cli', 'bin', 'rolekit.js')
const ARTIFACTS = ['task.json', 'prompt.md', 'events.jsonl', 'result.json', 'verification.json']

/**
 * Resolves a host run directory from evidence layout or POINTER.md.
 */
function resolveRunDir(host: string): string {
  const hostDir = join(evidenceRoot, host)
  const pointer = join(hostDir, 'POINTER.md')
  if (existsSync(pointer)) {
    const text = readFileSync(pointer, 'utf8')
    const m = text.match(/^run_dir=(.+)$/m)
    if (!m) throw new Error(`${host}: POINTER.md missing run_dir=`)
    return resolve(m[1].trim())
  }
  const candidate = join(hostDir, 'run-dir')
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate
  if (existsSync(hostDir)) {
    const runs = readdirSync(hostDir).filter((n) => n.startsWith('run-'))
    const only = runs[0]
    if (runs.length === 1 && only) return join(hostDir, only)
  }
  throw new Error(`${host}: no run-dir or POINTER.md under ${hostDir}`)
}

/**
 * Runs rolekit validate on a file.
 */
function rolekitValidate(file: string): { ok: boolean; output: string } {
  const r = spawnSync(process.execPath, [cli, 'validate', file, '--json'], {
    encoding: 'utf8',
    cwd: root,
  })
  return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') }
}

let failed = false
for (const host of ['pi', 'cursor'] as const) {
  let runDir: string
  try {
    runDir = resolveRunDir(host)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    failed = true
    continue
  }
  process.stdout.write(`validate-adapter-artifact host=${host} runDir=${runDir}\n`)
  for (const name of ARTIFACTS) {
    const file = join(runDir, name)
    if (!existsSync(file)) {
      process.stderr.write(`missing ${file}\n`)
      failed = true
      continue
    }
    if (name === 'task.json' || name === 'result.json') {
      const v = rolekitValidate(file)
      process.stdout.write(`  rolekit validate ${name} ok=${v.ok}\n`)
      if (!v.ok) {
        process.stderr.write(v.output)
        failed = true
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
        failed = true
        continue
      }
      const tmp = mkdtempSync(join(tmpdir(), 'rk-events-'))
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
      if (lineFail) failed = true
      continue
    }
    if (name === 'verification.json') {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as {
          passed?: unknown
          results?: unknown
          scope_violations?: unknown
        }
        const ok =
          typeof data.passed === 'boolean' &&
          Array.isArray(data.results) &&
          Array.isArray(data.scope_violations)
        process.stdout.write(
          `  shape-check verification.json ok=${ok} (no schema field in runner artifact)\n`,
        )
        if (!ok) failed = true
      } catch (error) {
        process.stderr.write(`  verification.json parse failed: ${String(error)}\n`)
        failed = true
      }
      continue
    }
    if (name === 'prompt.md') {
      const text = readFileSync(file, 'utf8')
      const ok = text.trim().length > 0
      process.stdout.write(`  presence-check prompt.md ok=${ok} (markdown; no registered schema)\n`)
      if (!ok) failed = true
    }
  }
}

process.exit(failed ? 1 : 0)

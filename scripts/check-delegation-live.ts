/**
 * DoD helper: run check:delegation against authentic host exports.
 *
 * Preference order (per host):
 * - pi: session.jsonl (raw) → auto-extract inside checker; also writes session.extracted.md
 * - cursor: session.raw.json → session.export.md (extract) → never prefer sanitized session.md alone
 *
 * Fails closed if a sanitized session.md would pass while the authentic/raw path fails.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = join(root, 'evidence', 'host-adapter-skills')
const checker = join(root, 'scripts', 'check-delegated-run.mjs')
const extractPi = join(root, 'scripts', 'extract-pi-session.mjs')
const extractCursor = join(root, 'scripts', 'extract-cursor-session.mjs')

/**
 * Resolves run directory for a host evidence pack.
 */
function resolveRunDir(host: string): string {
  const hostDir = join(evidenceRoot, host)
  const pointer = join(hostDir, 'POINTER.md')
  if (existsSync(pointer)) {
    const text = readFileSync(pointer, 'utf8')
    const m = text.match(/^run_dir=(.+)$/m)
    if (!m) throw new Error(`${host}: POINTER.md missing run_dir=`)
    return resolve(m[1].trim().replace(/[\\/]+$/, ''))
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
 * Resolves authentic session path + optional extract output for a host.
 */
function resolveAuthenticSession(host: 'pi' | 'cursor'): {
  authentic: string
  extracted?: string
  sanitized?: string
} {
  const hostDir = join(evidenceRoot, host)
  const sanitized = join(hostDir, 'session.md')
  if (host === 'pi') {
    const jsonl = join(hostDir, 'session.jsonl')
    if (!existsSync(jsonl)) throw new Error('pi: missing authentic session.jsonl')
    const extracted = join(hostDir, 'session.extracted.md')
    return {
      authentic: jsonl,
      extracted,
      sanitized: existsSync(sanitized) ? sanitized : undefined,
    }
  }
  const raw = join(hostDir, 'session.raw.json')
  const exported = join(hostDir, 'session.export.md')
  if (existsSync(raw)) {
    return {
      authentic: raw,
      extracted: exported,
      sanitized: existsSync(sanitized) ? sanitized : undefined,
    }
  }
  if (existsSync(exported)) {
    return {
      authentic: exported,
      sanitized: existsSync(sanitized) ? sanitized : undefined,
    }
  }
  throw new Error('cursor: missing authentic session.raw.json or session.export.md')
}

/**
 * Runs checker; returns exit status + combined output.
 */
function runChecker(session: string, runDir: string): { status: number; out: string } {
  const r = spawnSync(process.execPath, [checker, session, runDir], {
    encoding: 'utf8',
    cwd: root,
  })
  return { status: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` }
}

let failed = false
for (const host of ['pi', 'cursor'] as const) {
  const runDir = resolveRunDir(host)
  const paths = resolveAuthenticSession(host)
  mkdirSync(join(evidenceRoot, host), { recursive: true })

  if (host === 'pi' && paths.extracted) {
    const ex = spawnSync(process.execPath, [extractPi, paths.authentic, paths.extracted], {
      encoding: 'utf8',
      cwd: root,
    })
    process.stdout.write(ex.stdout || '')
    process.stderr.write(ex.stderr || '')
    if (ex.status !== 0) {
      process.stderr.write(`pi extract failed\n`)
      failed = true
      continue
    }
  }
  if (host === 'cursor' && paths.authentic.endsWith('.json') && paths.extracted) {
    const ex = spawnSync(process.execPath, [extractCursor, paths.authentic, paths.extracted], {
      encoding: 'utf8',
      cwd: root,
    })
    process.stdout.write(ex.stdout || '')
    process.stderr.write(ex.stderr || '')
    if (ex.status !== 0) {
      process.stderr.write(`cursor extract failed\n`)
      failed = true
      continue
    }
  }

  // Primary: authentic raw (jsonl / session.raw.json)
  process.stdout.write(
    `check-delegation-live host=${host}\n  authentic=${paths.authentic}\n  runDir=${runDir}\n`,
  )
  const primary = runChecker(paths.authentic, runDir)
  process.stdout.write(primary.out)
  if (primary.status !== 0) failed = true

  // Also require documented extract output passes
  if (paths.extracted && existsSync(paths.extracted)) {
    const extractedCheck = runChecker(paths.extracted, runDir)
    process.stdout.write(`  extracted-check: ${paths.extracted}\n`)
    process.stdout.write(extractedCheck.out)
    if (extractedCheck.status !== 0) failed = true
  }

  // Fail-closed: sanitized md must not be the only green path
  if (paths.sanitized) {
    const san = runChecker(paths.sanitized, runDir)
    if (san.status === 0 && primary.status !== 0) {
      process.stderr.write(
        `${host}: FAKE-GREEN blocked — session.md passes but authentic export fails\n`,
      )
      failed = true
    }
  }
}

process.exit(failed ? 1 : 0)

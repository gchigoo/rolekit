/**
 * Verifies sealed dogfood success runs from evidence project.
 * Asserts each reverify artifact has verification.passed === true.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const evidence = join(root, 'evidence/pi-rpc-vertical-slice/dogfood')
const project = join(evidence, 'project')
const cli = join(root, 'packages/cli/bin/rolekit.js')

const successFiles = ['success-1.json', 'success-2.json']
let failed = false

for (const file of successFiles) {
  const rid = JSON.parse(readFileSync(join(evidence, file), 'utf8')).run_id as string
  const result = spawnSync(process.execPath, [cli, 'verify', rid, '--json'], {
    cwd: project,
    encoding: 'utf8',
    env: process.env,
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) {
    process.stderr.write(`verify ${rid} exited ${result.status}\n`)
    failed = true
    continue
  }
  const payload = JSON.parse(result.stdout || '{}') as { reverify?: string }
  if (!payload.reverify) {
    process.stderr.write(`verify ${rid}: missing reverify path\n`)
    failed = true
    continue
  }
  const artifact = JSON.parse(readFileSync(payload.reverify, 'utf8')) as {
    verification?: { passed?: boolean; scope_violations?: string[] }
  }
  if (artifact.verification?.passed !== true) {
    process.stderr.write(
      `verify ${rid}: expected verification.passed===true, got ${JSON.stringify(artifact.verification)}\n`,
    )
    failed = true
  } else {
    process.stdout.write(`verify ${rid}: passed=true\n`)
  }
}

process.exit(failed ? 1 : 0)

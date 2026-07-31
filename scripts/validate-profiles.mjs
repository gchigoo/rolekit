/**
 * Validates all RoleProfile YAML under profiles/roles and example TaskContracts.
 * Usage: node scripts/validate-profiles.mjs
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'packages/cli/bin/rolekit.js')
const rolesDir = join(root, 'profiles/roles')
const examplesDir = join(root, 'profiles/examples')

/**
 * Runs rolekit validate on a file; returns exit status.
 */
function validateFile(path) {
  const result = spawnSync(process.execPath, [cli, 'validate', path, '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) {
    process.stderr.write(`validate failed: ${path}\n`)
  }
  return result.status === 0
}

const roleFiles = readdirSync(rolesDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => join(rolesDir, f))
  .sort()

if (roleFiles.length !== 7) {
  process.stderr.write(`expected 7 role profiles, found ${roleFiles.length}\n`)
  process.exit(1)
}

const exampleFiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => join(examplesDir, f))
  .sort()

let ok = true
for (const file of [...roleFiles, ...exampleFiles]) {
  if (!validateFile(file)) {
    ok = false
  } else {
    process.stdout.write(`ok ${file}\n`)
  }
}

process.exit(ok ? 0 : 1)

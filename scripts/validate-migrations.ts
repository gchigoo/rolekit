/**
 * Traverses migration targets and runs rolekit validate on each artifact.
 * Usage: node scripts/validate-migrations.ts <targetRoot> [<targetRoot>...]
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rolekitBin = join(root, 'packages/cli/bin/rolekit.js')
const targets = process.argv.slice(2).map((p) => resolve(p))

if (targets.length === 0) {
  process.stderr.write('usage: npm run validate:migrations -- <targetRoot>...\n')
  process.exit(2)
}

let failed = 0
for (const target of targets) {
  const rolekit = join(target, '.rolekit')
  const files = [
    ...collect(join(rolekit, 'work-items'), '.yaml'),
    ...collect(join(rolekit, 'knowledge'), '.md'),
    ...collect(join(rolekit, 'profiles/roles'), '.yaml'),
  ]
  for (const file of files) {
    const result = spawnSync(process.execPath, [rolekitBin, 'validate', file, '--json'], {
      cwd: root,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      process.stderr.write(`FAIL ${file}\n${result.stdout}${result.stderr}`)
      failed += 1
    } else {
      process.stdout.write(`ok ${file}\n`)
    }
  }
}

process.exit(failed === 0 ? 0 : 1)

/**
 * Collects files under dir with the given extension.
 */
function collect(dir: string, ext: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of names) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...collect(full, ext))
    else if (name.endsWith(ext)) out.push(full)
  }
  return out
}

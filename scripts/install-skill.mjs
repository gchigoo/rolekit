/**
 * Copy-install a host Skill (no symlinks, no auto-detect).
 * Usage: node scripts/install-skill.mjs <pi|cursor|codex>
 */

import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {'pi'|'cursor'|'codex'} host
 */
function installTarget(host) {
  if (host === 'pi') {
    return join(homedir(), '.pi', 'agent', 'skills', 'rolekit-adapter-pi')
  }
  if (host === 'cursor') {
    return join(root, '.cursor', 'skills', 'rolekit-adapter-cursor')
  }
  if (host === 'codex') {
    return join(homedir(), '.agents', 'skills', 'rolekit-adapter-codex')
  }
  throw new Error(`unknown host: ${host}`)
}

/**
 * @param {string} host
 */
function main(host) {
  if (host !== 'pi' && host !== 'cursor' && host !== 'codex') {
    process.stderr.write('usage: node scripts/install-skill.mjs <pi|cursor|codex>\n')
    process.exit(2)
  }
  const src = join(root, 'adapters', host, 'SKILL.md')
  const destDir = installTarget(host)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, 'SKILL.md')
  cpSync(src, dest)
  // stamp for evidence binding (local only; not a symlink)
  writeFileSync(
    join(destDir, '.install-stamp.json'),
    `${JSON.stringify({ host, src, dest, installed_at: new Date().toISOString() }, null, 2)}\n`,
  )
  process.stdout.write(`installed ${host} skill -> ${dest}\n`)
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  main(process.argv[2] ?? '')
}

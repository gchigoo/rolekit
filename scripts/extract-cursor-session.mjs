/**
 * Derives checker-compatible transcript from Cursor session.raw.json.
 *
 * Expected raw shape:
 * {
 *   "host": "cursor",
 *   "skill": "rolekit-adapter-cursor",
 *   "events": [
 *     { "type": "skill_load", "name": "rolekit-adapter-cursor", "path": "..." },
 *     { "type": "command", "command": "rolekit ...", "exit_code": 0, "stdout": "..." }
 *   ]
 * }
 *
 * Usage: node scripts/extract-cursor-session.mjs <session.raw.json> [out.md]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @param {string} rawText
 * @returns {{ skill: string, commands: number, transcript: string }}
 */
export function extractCursorSession(rawText) {
  const data = JSON.parse(rawText)
  if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
    throw new Error('cursor raw export must be JSON with events[]')
  }
  const skill =
    typeof data.skill === 'string'
      ? data.skill
      : data.events.find((e) => e?.type === 'skill_load')?.name || 'rolekit-adapter-cursor'

  const lines = [
    `# Cursor session extract (from session.raw.json)`,
    ``,
    `source: Cursor session.raw.json`,
    `extractor: scripts/extract-cursor-session.mjs`,
    `Skill loaded: ${skill}`,
    ``,
    `## Rolekit tool invocations`,
    ``,
  ]
  let commands = 0
  for (const ev of data.events) {
    if (!ev || typeof ev !== 'object') continue
    if (ev.type === 'skill_load' && typeof ev.name === 'string') {
      lines.push(`Skill loaded: ${ev.name}`)
      if (typeof ev.path === 'string') lines.push(`Skill path: ${ev.path}`)
      lines.push('')
      continue
    }
    if (ev.type === 'command' && typeof ev.command === 'string') {
      commands += 1
      lines.push('```')
      lines.push(ev.command)
      lines.push('```')
      if (typeof ev.exit_code === 'number') {
        lines.push(`rolekit_exit_code: ${ev.exit_code}`)
      }
      lines.push('')
    }
  }
  lines.push('## Notes')
  lines.push('')
  lines.push('Derived mechanically from session.raw.json events. No hand-sanitized command list.')
  lines.push('')
  return { skill, commands, transcript: lines.join('\n') }
}

/**
 * @param {string[]} argv
 */
function main(argv) {
  const input = argv[0]
  if (!input) {
    process.stderr.write(
      'usage: node scripts/extract-cursor-session.mjs <session.raw.json> [out.md]\n',
    )
    process.exit(2)
  }
  const abs = resolve(input)
  const out = resolve(argv[1] || join(dirname(abs), 'session.export.md'))
  const result = extractCursorSession(readFileSync(abs, 'utf8'))
  writeFileSync(out, result.transcript, 'utf8')
  process.stdout.write(
    `extract-cursor-session wrote ${out} skill=${result.skill} commands=${result.commands}\n`,
  )
  if (!result.skill.includes('rolekit-adapter-cursor') || result.commands === 0) process.exit(1)
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  main(process.argv.slice(2))
}

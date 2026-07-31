/**
 * Derives checker-compatible transcript from a raw Pi session.jsonl.
 *
 * Only includes:
 * - skill load evidence (path/name hits for rolekit-adapter-pi)
 * - bash toolCall invocations whose first actionable line is a rolekit command
 * - paired toolResult exit markers (__EXIT_CODE__=N or isError)
 *
 * Does NOT copy user prompt command lists or SKILL.md body echoes.
 *
 * Usage:
 *   node scripts/extract-pi-session.mjs <session.jsonl> [out.md]
 * Default out: <dir>/session.extracted.md next to the jsonl.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractOneRolekitCommand } from '../adapters/shared/command-map.mjs'

/**
 * @typedef {{
 *   skillLoaded: boolean
 *   skillName: string
 *   commands: Array<{ cmd: string, exitCode: number | null, toolCallId?: string }>
 *   transcript: string
 * }} PiExtractResult
 */

/**
 * Pulls text from a Pi content part or toolResult message.
 * @param {unknown} content
 * @returns {string}
 */
function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = /** @type {Record<string, unknown>} */ (part)
      if (typeof p.text === 'string') return p.text
      if (typeof p.thinking === 'string') return ''
      return ''
    })
    .join('\n')
}

/**
 * First rolekit command from a bash script body (ignores later shell lines).
 * @param {string} command
 * @returns {string | null}
 */
function firstRolekitFromBash(command) {
  const unescaped = command.replace(/\\n/g, '\n')
  for (const line of unescaped.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.search(/\brolekit\s+/)
    if (idx < 0) continue
    const one = extractOneRolekitCommand(trimmed, idx)
    if (!one) continue
    return one.cmd
  }
  return null
}

/**
 * Parses exit code from a rolekit tool result payload.
 * @param {Record<string, unknown>} toolResultMsg
 * @returns {number | null}
 */
function parseExitCode(toolResultMsg) {
  const text = contentText(toolResultMsg.content)
  const marker = text.match(/__EXIT_CODE__\s*=\s*(-?\d+)/)
  if (marker) return Number(marker[1])
  if (toolResultMsg.isError === true) return 1
  return null
}

/**
 * Extracts checker input from Pi session.jsonl text.
 * @param {string} jsonlText
 * @returns {PiExtractResult}
 */
export function extractPiSession(jsonlText) {
  const skillName = 'rolekit-adapter-pi'
  /** @type {Map<string, { cmd: string }>} */
  const pending = new Map()
  /** @type {Array<{ cmd: string, exitCode: number | null, toolCallId?: string }>} */
  const commands = []
  let skillLoaded = false

  for (const raw of jsonlText.split(/\r?\n/)) {
    if (!raw.trim()) continue
    let ev
    try {
      ev = JSON.parse(raw)
    } catch {
      continue
    }
    if (ev.type !== 'message' || !ev.message) continue
    const msg = ev.message
    const role = msg.role

    if (role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || part.type !== 'toolCall') continue
        const name = part.name || part.toolName
        const args = part.arguments || {}
        const command = typeof args.command === 'string' ? args.command : ''
        if (name === 'bash' || name === 'shell') {
          if (
            /rolekit-adapter-pi/.test(command) ||
            /rolekit-adapter-pi\/SKILL\.md/.test(command) ||
            /skills\/rolekit-adapter-pi/.test(command)
          ) {
            skillLoaded = true
          }
          const cmd = firstRolekitFromBash(command)
          if (cmd) {
            pending.set(String(part.id), { cmd })
          }
        }
      }
    }

    if (role === 'toolResult') {
      const text = contentText(msg.content)
      if (text.includes(skillName) || /name:\s*rolekit-adapter-pi/.test(text)) {
        skillLoaded = true
      }
      // Ignore SKILL.md body echoes for command extraction (templates are not invocations).
      if (/^---\s*\nname:\s*rolekit-adapter-pi/m.test(text)) {
        continue
      }
      const id = String(msg.toolCallId || '')
      const pendingCmd = pending.get(id)
      if (pendingCmd) {
        commands.push({
          cmd: pendingCmd.cmd,
          exitCode: parseExitCode(msg),
          toolCallId: id,
        })
        pending.delete(id)
      }
    }
  }

  // orphan toolCalls without results still count as attempted commands
  for (const [id, { cmd }] of pending) {
    commands.push({ cmd, exitCode: null, toolCallId: id })
  }

  const lines = [
    `# Pi session extract (from session.jsonl)`,
    ``,
    `source: Pi session.jsonl`,
    `extractor: scripts/extract-pi-session.mjs`,
    `Skill loaded: ${skillLoaded ? skillName : '(missing)'}`,
    ``,
    `## Rolekit tool invocations`,
    ``,
  ]
  for (const entry of commands) {
    lines.push('```')
    lines.push(entry.cmd)
    lines.push('```')
    if (entry.exitCode !== null && entry.exitCode !== undefined) {
      lines.push(`rolekit_exit_code: ${entry.exitCode}`)
    } else {
      lines.push(`rolekit_exit_code: unknown`)
    }
    lines.push('')
  }
  lines.push('## Notes')
  lines.push('')
  lines.push(
    'Derived mechanically from bash toolCall/toolResult pairs. User prompts and SKILL.md echoes omitted.',
  )
  lines.push('')

  return {
    skillLoaded,
    skillName,
    commands,
    transcript: lines.join('\n'),
  }
}

/**
 * CLI entry.
 * @param {string[]} argv
 */
function main(argv) {
  const input = argv[0]
  if (!input) {
    process.stderr.write('usage: node scripts/extract-pi-session.mjs <session.jsonl> [out.md]\n')
    process.exit(2)
  }
  const abs = resolve(input)
  const out = resolve(argv[1] || join(dirname(abs), 'session.extracted.md'))
  const result = extractPiSession(readFileSync(abs, 'utf8'))
  writeFileSync(out, result.transcript, 'utf8')
  process.stdout.write(
    `extract-pi-session wrote ${out} skill=${result.skillLoaded} commands=${result.commands.length}\n`,
  )
  if (!result.skillLoaded || result.commands.length === 0) process.exit(1)
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  main(process.argv.slice(2))
}

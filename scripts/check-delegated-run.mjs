/**
 * Mechanical delegation checker (D5):
 * skill-name load evidence, rolekit cmds ⊆ Available+flags, post-error behavior,
 * run-dir has the five artifact filenames.
 *
 * For Pi session.jsonl, auto-derives checker input via extract-pi-session.mjs
 * (toolCall invocations only — not user prompts / SKILL echoes).
 *
 * Usage: node scripts/check-delegated-run.mjs <session-file> <run-dir>
 * Exit 0 pass, 1 fail. Set ROLEKIT_CHECK_JSON=1 for JSON result on stdout.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  extractRolekitCommands,
  normalizeExtractedCommand,
  RUN_ARTIFACTS,
  tokenizeCommand,
  validateRolekitCommand,
} from '../adapters/shared/command-map.mjs'
import { extractPiSession } from './extract-pi-session.mjs'

const SKILL_NAMES = Object.freeze(['rolekit-adapter-pi', 'rolekit-adapter-cursor'])

/**
 * @typedef {{ ok: boolean, errors: string[], skill?: string, commands: string[], source?: string }} CheckResult
 */

/**
 * Rolekit CLI failure markers only (not host tool timeouts / skill prose).
 * @param {string} chunk
 */
function looksLikeRolekitFailure(chunk) {
  if (/rolekit_exit_code\s*[:=]\s*[1-9]\d*/i.test(chunk)) return true
  if (/__EXIT_CODE__\s*=\s*[1-9]\d*/.test(chunk)) return true
  // explicit checker/session convention: "rolekit ...\nexit_code: N"
  if (/\brolekit\b[\s\S]{0,200}\bexit_code\s*[:=]\s*[1-9]\d*/i.test(chunk)) return true
  if (/\brolekit\b[\s\S]{0,120}\bexited with code [1-9]/i.test(chunk)) return true
  return false
}

/**
 * True when a rolekit command is query-only (allowed after failure).
 * @param {string} cmd
 */
function isQueryCommand(cmd) {
  const tokens = tokenizeCommand(cmd)
  const positionals = tokens.slice(1).filter((t) => !t.startsWith('-'))
  return positionals[0] === 'run' && (positionals[1] === 'status' || positionals[1] === 'collect')
}

/**
 * Loads session text; for .jsonl uses Pi extractor.
 * @param {string} sessionPath
 * @returns {{ text: string, source: string }}
 */
function loadSessionText(sessionPath) {
  const raw = readFileSync(sessionPath, 'utf8')
  const ext = extname(sessionPath).toLowerCase()
  if (ext === '.jsonl') {
    const extracted = extractPiSession(raw)
    return { text: extracted.transcript, source: 'pi-jsonl→extract-pi-session' }
  }
  // Cursor raw JSON array/object export: prefer explicit commands[] if present
  if (ext === '.json') {
    try {
      const data = JSON.parse(raw)
      if (data && typeof data === 'object' && Array.isArray(data.events)) {
        return { text: renderCursorRaw(data), source: 'cursor-raw-json' }
      }
    } catch {
      // fall through to raw text
    }
  }
  return { text: raw, source: 'text' }
}

/**
 * Renders a Cursor-style raw session JSON into checker transcript form.
 * @param {{ skill?: string, events: Array<Record<string, unknown>> }} data
 */
function renderCursorRaw(data) {
  const skill = typeof data.skill === 'string' ? data.skill : 'rolekit-adapter-cursor'
  const lines = [
    `# Cursor raw session export`,
    `Skill loaded: ${skill}`,
    ``,
    `## Rolekit tool invocations`,
    ``,
  ]
  for (const ev of data.events) {
    if (ev.type === 'skill_load' && typeof ev.name === 'string') {
      lines.push(`Skill loaded: ${ev.name}`)
      continue
    }
    if (ev.type === 'command' && typeof ev.command === 'string') {
      lines.push('```')
      lines.push(ev.command)
      lines.push('```')
      if (typeof ev.exit_code === 'number') {
        lines.push(`rolekit_exit_code: ${ev.exit_code}`)
      }
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Checks a session transcript + run directory.
 * @param {string} sessionPath
 * @param {string} runDir
 * @returns {CheckResult}
 */
export function checkDelegatedRun(sessionPath, runDir) {
  /** @type {CheckResult} */
  const result = { ok: true, errors: [], commands: [] }
  const loaded = loadSessionText(sessionPath)
  result.source = loaded.source
  const session = loaded.text

  const skill = SKILL_NAMES.find((name) => session.includes(name))
  if (!skill) {
    result.errors.push(`missing skill load evidence (expected one of ${SKILL_NAMES.join(', ')})`)
  } else {
    result.skill = skill
  }

  const commands = extractRolekitCommands(session)
  result.commands = commands
  if (commands.length === 0) {
    result.errors.push('no rolekit commands found in session')
  }
  for (const cmd of commands) {
    const normalized = normalizeExtractedCommand(cmd)
    const v = validateRolekitCommand(normalized)
    if (!v.ok) {
      result.errors.push(`command outside Available/flags (${v.reason}): ${cmd}`)
    }
  }

  const lines = session.split(/\r?\n/)
  let failed = false
  for (let i = 0; i < lines.length; i += 1) {
    const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
    if (looksLikeRolekitFailure(window)) failed = true
    const lineCmds = extractRolekitCommands(lines[i])
    if (lineCmds.length === 0) continue
    for (const cmd of lineCmds) {
      if (!failed) continue
      if (!isQueryCommand(cmd)) {
        result.errors.push(`after CLI failure, non-query rolekit command: ${cmd}`)
      }
      const following = lines.slice(i, Math.min(lines.length, i + 8)).join('\n')
      if (/\b(write|edit|apply_patch)\b/i.test(following) && /\.ya?ml\b/i.test(following)) {
        result.errors.push('after CLI failure, contract file modification intent detected')
      }
    }
  }

  const absRun = resolve(runDir)
  if (!existsSync(absRun) || !statSync(absRun).isDirectory()) {
    result.errors.push(`run-dir missing or not a directory: ${absRun}`)
  } else {
    const names = new Set(readdirSync(absRun))
    for (const art of RUN_ARTIFACTS) {
      if (!names.has(art)) {
        result.errors.push(`run-dir missing artifact: ${art}`)
      }
    }
  }

  result.ok = result.errors.length === 0
  return result
}

/**
 * CLI entry.
 * @param {string[]} argv
 */
function main(argv) {
  const sessionPath = argv[0]
  const runDir = argv[1]
  if (!sessionPath || !runDir) {
    process.stderr.write('usage: node scripts/check-delegated-run.mjs <session-file> <run-dir>\n')
    process.exit(2)
  }
  const result = checkDelegatedRun(resolve(sessionPath), resolve(runDir))
  if (process.env.ROLEKIT_CHECK_JSON === '1') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    process.stdout.write(
      `check:delegation pass skill=${result.skill} commands=${result.commands.length} source=${result.source}\n`,
    )
  } else {
    process.stderr.write(
      `check:delegation fail (${result.errors.length}) source=${result.source}\n`,
    )
    for (const e of result.errors) process.stderr.write(`- ${e}\n`)
  }
  process.exit(result.ok ? 0 : 1)
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  main(process.argv.slice(2))
}

/**
 * Parses adapters/shared/command-map.md — single source for Available commands.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const COMMAND_MAP_PATH = join(here, 'command-map.md')

/** Frozen Available subcommands (D11). */
export const AVAILABLE_SUBCOMMANDS = Object.freeze([
  Object.freeze(['validate']),
  Object.freeze(['task', 'create']),
  Object.freeze(['task', 'compile']),
  Object.freeze(['run', 'start']),
  Object.freeze(['run', 'status']),
  Object.freeze(['run', 'steer']),
  Object.freeze(['run', 'cancel']),
  Object.freeze(['run', 'collect']),
  Object.freeze(['verify']),
  Object.freeze(['gate', 'list']),
  Object.freeze(['gate', 'approve']),
  Object.freeze(['gate', 'reject']),
  Object.freeze(['workitem', 'create']),
  Object.freeze(['workitem', 'list']),
  Object.freeze(['workitem', 'next']),
  Object.freeze(['workitem', 'design']),
  Object.freeze(['workitem', 'start']),
  Object.freeze(['workitem', 'done']),
  Object.freeze(['workitem', 'drop']),
  Object.freeze(['workitem', 'resume']),
  Object.freeze(['knowledge', 'create']),
  Object.freeze(['knowledge', 'get']),
  Object.freeze(['knowledge', 'search']),
  Object.freeze(['knowledge', 'edit']),
  Object.freeze(['knowledge', 'set-status']),
  Object.freeze(['migrate']),
])

/** Planned command tokens that must not appear in host products. */
export const PLANNED_COMMAND_PATTERNS = Object.freeze([])

/** Artifact filenames required under a run directory. */
export const RUN_ARTIFACTS = Object.freeze([
  'task.json',
  'prompt.md',
  'events.jsonl',
  'result.json',
  'verification.json',
])

/** D11 per-command flag whitelist (beyond global --json). */
const EXTRA_FLAGS = Object.freeze({
  'run start': Object.freeze(['--detach', '--retry']),
  'run steer': Object.freeze(['--message', '--request-id']),
  'gate approve': Object.freeze(['--reason']),
  'gate reject': Object.freeze(['--reason']),
  'workitem create': Object.freeze(['--kind', '--title', '--depends-on']),
  'workitem list': Object.freeze(['--status', '--kind']),
  'workitem start': Object.freeze([
    '--task',
    '--estimated-files',
    '--cross-module',
    '--migration',
    '--context-loaded',
    '--lane',
  ]),
  'workitem resume': Object.freeze(['--to']),
  'knowledge create': Object.freeze(['--type', '--title', '--body-file', '--tag', '--status']),
  'knowledge search': Object.freeze(['--type', '--status', '--tag']),
  'knowledge edit': Object.freeze(['--title', '--tag', '--clear-tags', '--body-file']),
  'knowledge set-status': Object.freeze(['--status']),
  migrate: Object.freeze([
    '--from',
    '--source',
    '--target',
    '--decisions',
    '--report-dir',
    '--audit-only',
  ]),
})

/**
 * Extracts a markdown section body by heading title.
 * @param {string} text
 * @param {string} title
 * @returns {string}
 */
export function extractSection(text, title) {
  const re = new RegExp(`^## ${title}\\s*$`, 'm')
  const match = re.exec(text)
  if (!match) {
    throw new Error(`missing ## ${title} in command-map.md`)
  }
  const start = match.index + match[0].length
  const rest = text.slice(start)
  const next = /^## /m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

/**
 * Loads and splits command-map.md sections.
 * @param {string} [path]
 */
export function loadCommandMap(path = COMMAND_MAP_PATH) {
  const text = readFileSync(path, 'utf8')
  return {
    text,
    available: extractSection(text, 'Available'),
    artifacts: extractSection(text, 'Artifacts'),
    planned: extractSection(text, 'Planned'),
  }
}

/**
 * Tokenizes a rolekit command line (no shell metacharacters expected).
 * @param {string} line
 * @returns {string[]}
 */
export function tokenizeCommand(line) {
  const trimmed = line
    .trim()
    .replace(/^[`'"$]+/, '')
    .replace(/[`'"]+$/, '')
  const tokens = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m = re.exec(trimmed)
  while (m) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '')
    m = re.exec(trimmed)
  }
  return tokens
}

/**
 * @param {string[]} matched
 */
function matchedKey(matched) {
  return matched.join(' ')
}

/**
 * Validates a rolekit command against D11 Available + flag whitelist.
 * @param {string} line
 * @returns {{ ok: true, tokens: string[] } | { ok: false, reason: string }}
 */
export function validateRolekitCommand(line) {
  const tokens = tokenizeCommand(line)
  if (tokens[0] !== 'rolekit') {
    return { ok: false, reason: 'not a rolekit command' }
  }
  const flags = tokens.filter((t) => t.startsWith('-'))
  const positionals = tokens.slice(1).filter((t) => !t.startsWith('-'))
  if (positionals.length === 0) {
    return { ok: false, reason: 'missing subcommand' }
  }

  let matched = null
  for (const sub of AVAILABLE_SUBCOMMANDS) {
    if (sub.every((part, i) => positionals[i] === part)) {
      matched = sub
      break
    }
  }
  if (!matched) {
    return { ok: false, reason: `subcommand not in Available: ${positionals.join(' ')}` }
  }

  const allowedExtra = EXTRA_FLAGS[matchedKey(matched)] ?? []
  for (const flag of flags) {
    if (flag === '--json') continue
    if (allowedExtra.includes(flag)) continue
    return { ok: false, reason: `flag not allowed: ${flag}` }
  }
  return { ok: true, tokens }
}

const SUBCOMMAND_ALT =
  '(?:validate|task\\s+(?:create|compile)|run\\s+(?:start|status|cancel|collect|steer)|verify|gate\\s+(?:list|approve|reject)|workitem(?:\\s+\\S+)?|knowledge(?:\\s+[\\w-]+)?|migrate)'

/**
 * Pulls one bounded rolekit command starting at `rolekit` in text.
 * Stops before shell continuations, numbered lists, and prose.
 * @param {string} text
 * @param {number} startIndex index of 'r' in rolekit
 * @returns {{ cmd: string, end: number } | null}
 */
export function extractOneRolekitCommand(text, startIndex) {
  const slice = text.slice(startIndex)
  const head = new RegExp(`^rolekit\\s+${SUBCOMMAND_ALT}\\b`, 'i').exec(slice)
  if (!head) return null
  let i = head[0].length
  while (i < slice.length) {
    const ch = slice[i]
    if (ch === '\n' || ch === '\r') break
    if (ch === '`' || ch === '|') break
    if (/\s+\d+\)\s*$/.test(slice.slice(0, i + 1))) break
    if (ch === ';' || ch === '&') break
    if (ch === "'" || ch === '"') {
      const quote = ch
      i += 1
      while (i < slice.length && slice[i] !== quote && slice[i] !== '\n') i += 1
      if (i < slice.length && slice[i] === quote) i += 1
      continue
    }
    if ((ch === '.' || ch === ',') && /\s+[A-Za-z]/.test(slice.slice(i + 1, i + 3))) break
    i += 1
  }
  let cmd = slice.slice(0, i).trim()
  cmd = cmd.replace(/[.,;:]+$/, '').trim()
  if (/\s+\.\.\.(?:\s+--json)?$/.test(cmd)) {
    return null
  }
  return { cmd, end: startIndex + i }
}

/**
 * Finds rolekit command lines in free text (sessions / skill bodies).
 * @param {string} text
 * @returns {string[]}
 */
export function extractRolekitCommands(text) {
  const found = []
  const re = /\brolekit\s+/gi
  let m = re.exec(text)
  while (m) {
    const one = extractOneRolekitCommand(text, m.index)
    if (one) {
      if (!found.includes(one.cmd)) found.push(one.cmd)
      re.lastIndex = one.end
    }
    m = re.exec(text)
  }
  return found
}

/**
 * Unescapes common JSON-string escape sequences in command text.
 * @param {string} cmd
 */
export function normalizeExtractedCommand(cmd) {
  return cmd
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)[0]
    .replace(/<[^>]+>/g, 'ARG')
    .replace(/\s+/g, ' ')
    .trim()
}

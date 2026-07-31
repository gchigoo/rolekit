/**
 * Thinness guards for host adapter products (D3/D4):
 * positive command selection, line cap, banned words, zero-diff rebuild.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_PRODUCT_FILES, renderAllSkills } from '../adapters/build.mjs'
import {
  extractRolekitCommands,
  PLANNED_COMMAND_PATTERNS,
  validateRolekitCommand,
} from '../adapters/shared/command-map.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const adaptersRoot = join(root, 'adapters')

const MAX_LINES = 200

/** D3 banned terms (English word-boundary where applicable). */
const BANNED = [
  { label: 'awaiting-gate', re: /awaiting-gate/i },
  { label: 'transition', re: /\btransition\b/i },
  { label: 'state machine', re: /state\s+machine/i },
  { label: '状态机', re: /状态机/ },
  { label: '状态转移', re: /状态转移/ },
  // Allow D11 flag token --lane; still ban prose "lane".
  { label: 'lane', re: /(?<!-)\blane\b/i },
  { label: 'gate 决策', re: /gate\s*决策/i },
  { label: 'escalation', re: /\bescalation\b/i },
  { label: 'compilePrompt', re: /compilePrompt/ },
  { label: 'prompt 拼装', re: /prompt\s*拼装/ },
  { label: 'GatePolicy', re: /GatePolicy/ },
]

/** README may only contain copy/install-class command lines (not rolekit ops). */
const README_CMD_ALLOW =
  /^(npm\s+run\s+install-skill:(pi|cursor|codex)|npm\s+run\s+build:adapters|cp\b|copy\b|xcopy\b|mkdir\b|md\b)/i

const errors = []

/**
 * @param {string} msg
 */
function fail(msg) {
  errors.push(msg)
}

/**
 * Counts lines including trailing empty.
 * @param {string} text
 */
function lineCount(text) {
  if (text.length === 0) return 0
  return text.replace(/\r\n/g, '\n').split('\n').length
}

/**
 * Asserts product body against thinness rules.
 * @param {string} host
 * @param {string} path
 * @param {string} body
 */
function lintProduct(host, path, body) {
  const lines = lineCount(body)
  if (lines > MAX_LINES) {
    fail(`${host}: ${lines} lines > ${MAX_LINES} (${path})`)
  }
  for (const ban of BANNED) {
    if (ban.re.test(body)) {
      fail(`${host}: banned term "${ban.label}" in ${path}`)
    }
  }
  for (const re of PLANNED_COMMAND_PATTERNS) {
    if (re.test(body)) {
      fail(`${host}: planned command leaked into product (${re})`)
    }
  }
  // positive selection: every rolekit command must match Available + flags
  const cmds = extractRolekitCommands(body)
  if (cmds.length === 0) {
    fail(`${host}: no rolekit commands found in product`)
  }
  for (const cmd of cmds) {
    // skip placeholder angle-bracket templates after normalizing placeholders to tokens
    const normalized = cmd
      .replace(/<[^>]+>/g, 'ARG')
      .replace(/\s+/g, ' ')
      .trim()
    const result = validateRolekitCommand(normalized)
    if (!result.ok) {
      fail(`${host}: command rejected (${result.reason}): ${cmd}`)
    }
  }
  // reject non-rolekit executable invocation forms in product bodies
  if (
    /\b(npx|node|curl)\s+/.test(body) ||
    /(?:^|[\s`])(?:\/|\.\/|[A-Za-z]:\\)\S*rolekit/.test(body)
  ) {
    fail(`${host}: forbidden invocation form (node/npx/curl/absolute bin)`)
  }
  if (/\bTODO\b|\bFIXME\b/.test(body)) {
    fail(`${host}: TODO/FIXME forbidden in Skill product`)
  }
}

/**
 * Lints host README files (banned words + install/copy commands only).
 * @param {string} host
 * @param {string} path
 */
function lintReadme(host, path) {
  let body
  try {
    body = readFileSync(path, 'utf8')
  } catch {
    fail(`${host}: missing README at ${path}`)
    return
  }
  for (const ban of BANNED) {
    if (ban.re.test(body)) {
      fail(`${host} README: banned term "${ban.label}"`)
    }
  }
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    const fence = trimmed.match(/^`([^`]+)`$/)
    const cmd =
      fence?.[1] ?? (trimmed.startsWith('npm ') || trimmed.startsWith('cp ') ? trimmed : null)
    if (!cmd) continue
    if (/^rolekit\b/.test(cmd)) {
      fail(`${host} README: rolekit ops belong in SKILL.md, not README: ${cmd}`)
      continue
    }
    if (/^(npm|cp|copy|xcopy|mkdir|md)\b/i.test(cmd) && !README_CMD_ALLOW.test(cmd)) {
      fail(`${host} README: command not install/copy class: ${cmd}`)
    }
  }
}

function lintZeroDiff() {
  const rendered = renderAllSkills()
  for (const [host, expected] of Object.entries(rendered)) {
    const path = HOST_PRODUCT_FILES[host]
    const actual = readFileSync(path, 'utf8')
    if (actual !== expected) {
      fail(
        `${host}: product differs from rebuild (hand-edit or stale). Re-run npm run build:adapters`,
      )
    }
  }
}

function main() {
  const rendered = renderAllSkills()
  for (const [host] of Object.entries(rendered)) {
    const path = HOST_PRODUCT_FILES[host]
    let onDisk
    try {
      onDisk = readFileSync(path, 'utf8')
    } catch {
      fail(`${host}: product missing at ${path}; run npm run build:adapters`)
      continue
    }
    lintProduct(host, path, onDisk)
    lintReadme(host, join(adaptersRoot, host, 'README.md'))
  }
  lintZeroDiff()

  // adapters tree must contain expected hosts
  const hosts = readdirSync(adaptersRoot).filter(
    (n) => !n.startsWith('.') && n !== 'shared' && n !== 'build.mjs',
  )
  for (const required of ['pi', 'cursor', 'codex']) {
    if (!hosts.includes(required)) fail(`missing adapters/${required}`)
  }

  if (errors.length > 0) {
    process.stderr.write(`lint:adapters failed (${errors.length})\n`)
    for (const e of errors) process.stderr.write(`- ${e}\n`)
    process.exit(1)
  }
  process.stdout.write('lint:adapters ok\n')
}

main()

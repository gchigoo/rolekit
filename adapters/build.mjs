/**
 * Builds host Skill products from command-map Available + host-specific framing.
 * Planned section is intentionally omitted from all products.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadCommandMap } from './shared/command-map.mjs'

const root = dirname(fileURLToPath(import.meta.url))

/** @type {Record<string, { file: string, frontmatter: string, title: string, when: string }>} */
const HOSTS = {
  pi: {
    file: 'SKILL.md',
    frontmatter: [
      'name: rolekit-adapter-pi',
      'description: >-',
      '  Drive the RoleKit CLI for task compile and run lifecycle. Use when the user',
      '  asks to compile a RoleKit task, start/status/collect/verify a RoleKit run,',
      '  validate a RoleKit artifact, or operate the RoleKit CLI binary on PATH.',
      'compatibility: Requires the RoleKit CLI binary on PATH.',
    ].join('\n'),
    title: 'RoleKit adapter (Pi)',
    when: [
      '## When to use',
      '',
      'Load this skill when the user wants RoleKit CLI work: compile a task YAML,',
      'start or inspect a run, collect results, verify a run, or validate an artifact.',
      'Call only the commands in the map below. Keep decisions with the user when the CLI fails.',
    ].join('\n'),
  },
  cursor: {
    file: 'SKILL.md',
    frontmatter: [
      'name: rolekit-adapter-cursor',
      'description: >-',
      '  Drive the RoleKit CLI for task compile and run lifecycle. Use when the user',
      '  asks to compile a RoleKit task, start/status/collect/verify a RoleKit run,',
      '  validate a RoleKit artifact, or operate the RoleKit CLI binary on PATH.',
    ].join('\n'),
    title: 'RoleKit adapter (Cursor)',
    when: [
      '## When to use',
      '',
      'Use this skill when the user wants RoleKit CLI work: compile a task YAML,',
      'start or inspect a run, collect results, verify a run, or validate an artifact.',
      'Call only the commands in the map below. Keep decisions with the user when the CLI fails.',
    ].join('\n'),
  },
  codex: {
    file: 'SKILL.md',
    frontmatter: [
      'name: rolekit-adapter-codex',
      'description: >-',
      '  Drive the RoleKit CLI for task compile and run lifecycle. Use when the user',
      '  asks to compile a RoleKit task, start/status/collect/verify a RoleKit run,',
      '  validate a RoleKit artifact, or operate the RoleKit CLI binary on PATH.',
    ].join('\n'),
    title: 'RoleKit adapter (Codex)',
    when: [
      '## When to use',
      '',
      'Use this skill when the user wants RoleKit CLI work: compile a task YAML,',
      'start or inspect a run, collect results, verify a run, or validate an artifact.',
      'Call only the commands in the map below. Keep decisions with the user when the CLI fails.',
    ].join('\n'),
  },
}

const failSection = [
  '## When CLI fails',
  '',
  'If a rolekit command exits non-zero, report the CLI output and exit code to the',
  'user unchanged. Do not edit the task contract. Do not invent a substitute plan.',
  'Allowed follow-up rolekit commands after a failure: `rolekit run status <run-id> --json`',
  'and `rolekit run collect <run-id> --json` only.',
].join('\n')

/**
 * Renders one host Skill markdown body.
 * @param {keyof typeof HOSTS} host
 * @param {{ available: string, artifacts: string }} map
 */
export function renderSkill(host, map) {
  const meta = HOSTS[host]
  if (!meta) throw new Error(`unknown host: ${host}`)
  return [
    '---',
    meta.frontmatter,
    '---',
    '',
    `# ${meta.title}`,
    '',
    meta.when,
    '',
    '## Command map',
    '',
    map.available,
    '',
    '## Artifact locations',
    '',
    map.artifacts,
    '',
    failSection,
    '',
  ].join('\n')
}

/**
 * Writes all host products. Returns absolute paths written.
 */
export function buildAdapters() {
  const map = loadCommandMap()
  const written = []
  for (const host of Object.keys(HOSTS)) {
    const meta = HOSTS[host]
    const dir = join(root, host)
    mkdirSync(dir, { recursive: true })
    const outPath = join(dir, meta.file)
    const body = renderSkill(/** @type {keyof typeof HOSTS} */ (host), map)
    writeFileSync(outPath, body, 'utf8')
    written.push(outPath)
  }
  return written
}

/**
 * Returns rendered product map without writing (for zero-diff checks).
 */
export function renderAllSkills() {
  const map = loadCommandMap()
  /** @type {Record<string, string>} */
  const out = {}
  for (const host of Object.keys(HOSTS)) {
    out[host] = renderSkill(/** @type {keyof typeof HOSTS} */ (host), map)
  }
  return out
}

export const HOST_PRODUCT_FILES = Object.fromEntries(
  Object.entries(HOSTS).map(([host, meta]) => [host, join(root, host, meta.file)]),
)

const isMain =
  Boolean(process.argv[1]) &&
  (import.meta.url === pathToFileURL(resolve(process.argv[1])).href ||
    /adapters[/\\]build\.mjs$/i.test(process.argv[1]))

if (isMain) {
  const paths = buildAdapters()
  process.stdout.write(`built ${paths.length} adapter products\n`)
}

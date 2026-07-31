import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cliEntry = join(root, 'packages/cli/bin/rolekit.js')
const fixturesRoot = join(root, 'fixtures')

const SEMANTIC_INVALID = new Set([
  'task-contract/invalid-empty-commands.yaml',
  'result-envelope/invalid-completed-with-violations.json',
  'work-item/invalid-awaiting-gate-null.yaml',
  'knowledge-entry/invalid-adr-missing-headings.md',
  'knowledge-entry/invalid-rule-multipart.md',
  'gate-record/invalid-observe-with-resolution.json',
  'gate-record/invalid-bad-decision.json',
])

const UNKNOWN_SCHEMA = new Set(['role-profile/invalid-wrong-schema.yaml'])

interface SpawnResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Spawns the real rolekit CLI entry via node.
 */
function runRolekit(args: string[]): SpawnResult {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/**
 * Lists all fixture files under fixtures/.
 */
function listFixtures(): string[] {
  const kinds = readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const files: string[] = []
  for (const kind of kinds) {
    for (const name of readdirSync(join(fixturesRoot, kind))) {
      files.push(join(kind, name).replace(/\\/g, '/'))
    }
  }
  return files.sort()
}

describe('rolekit validate e2e', () => {
  const fixtures = listFixtures()

  it('discovers fixtures for all 10 kinds', () => {
    const kinds = new Set(fixtures.map((file) => file.split('/')[0]))
    assert.equal(kinds.size, 10)
    for (const kind of kinds) {
      const kindFiles = fixtures.filter((file) => file.startsWith(`${kind}/`))
      assert.ok(
        kindFiles.some((file) => file.includes('/valid-')),
        `${kind} needs a valid fixture`,
      )
      assert.ok(
        kindFiles.filter((file) => file.includes('/invalid-')).length >= 2,
        `${kind} needs >=2 invalid fixtures`,
      )
    }
  })

  for (const rel of fixtures) {
    const abs = join(fixturesRoot, rel)
    const isValid = rel.includes('/valid-')
    it(`${rel} → exit ${isValid ? 0 : 1}`, () => {
      const result = runRolekit(['validate', abs, '--json'])
      if (isValid) {
        assert.equal(result.status, 0, result.stderr || result.stdout)
        const payload = JSON.parse(result.stdout) as { valid: boolean }
        assert.equal(payload.valid, true)
        assert.equal(result.stdout.trim().startsWith('{'), true)
        assert.equal(result.stderr.trim(), '')
        return
      }

      assert.equal(result.status, 1, result.stderr || result.stdout)
      const payload = JSON.parse(result.stdout) as {
        valid: boolean
        code?: string
        issues?: Array<{ layer: string }>
      }
      assert.equal(payload.valid, false)

      if (UNKNOWN_SCHEMA.has(rel)) {
        assert.equal(payload.code, 'unknown_schema')
        return
      }

      assert.ok(Array.isArray(payload.issues) && payload.issues.length > 0)
      if (SEMANTIC_INVALID.has(rel)) {
        assert.ok(payload.issues?.some((issue) => issue.layer === 'semantic'))
      } else {
        assert.ok(payload.issues?.some((issue) => issue.layer === 'structural'))
      }
    })
  }

  it('usage error: missing file → exit 2', () => {
    const result = runRolekit(['validate'])
    assert.equal(result.status, 2)
  })

  it('usage error: unknown flag → exit 2', () => {
    const result = runRolekit(['validate', 'file.yaml', '--nope'])
    assert.equal(result.status, 2)
  })

  it('usage error: unknown command → exit 2', () => {
    const result = runRolekit(['nope'])
    assert.equal(result.status, 2)
  })

  it('parse_error for empty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-e2e-'))
    const file = join(dir, 'empty.yaml')
    writeFileSync(file, '', 'utf8')
    const result = runRolekit(['validate', file, '--json'])
    assert.equal(result.status, 1)
    const payload = JSON.parse(result.stdout) as { code: string }
    assert.equal(payload.code, 'parse_error')
  })

  it('parse_error for UTF-8 BOM file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-e2e-'))
    const file = join(dir, 'bom.yaml')
    writeFileSync(file, `\uFEFFschema: rolekit/gate-policy@1\n`, 'utf8')
    const result = runRolekit(['validate', file, '--json'])
    assert.equal(result.status, 1)
    const payload = JSON.parse(result.stdout) as { code: string }
    assert.equal(payload.code, 'parse_error')
  })

  it('unknown_schema when schema field missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-e2e-'))
    const file = join(dir, 'noschema.yaml')
    writeFileSync(file, 'name: orphan\n', 'utf8')
    const result = runRolekit(['validate', file, '--json'])
    assert.equal(result.status, 1)
    const payload = JSON.parse(result.stdout) as { code: string }
    assert.equal(payload.code, 'unknown_schema')
  })

  it('--json stdout is JSON only on success', () => {
    const sample = fixtures.find((file) => file.includes('/valid-'))
    assert.ok(sample)
    const result = runRolekit(['validate', join(fixturesRoot, sample ?? ''), '--json'])
    assert.equal(result.status, 0)
    const lines = result.stdout.trim().split(/\r?\n/)
    assert.equal(lines.length, 1)
    JSON.parse(lines[0] ?? '')
  })

  it('help lists validate and run command surface', () => {
    const result = runRolekit(['--help'])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /validate/)
    assert.match(result.stdout, /\brun start\b/)
  })
})

/**
 * migrate CLI e2e: CodeStable sample fixture + Superpowers fixture.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('../..', import.meta.url)))
const rolekit = join(repoRoot, 'packages/cli/bin/rolekit.js')
const superpowers = join(repoRoot, 'packages/migrate/fixtures/superpowers-5.1.3')
const codestableSample = join(repoRoot, 'packages/migrate/fixtures/codestable-sample')

/**
 * Runs rolekit migrate with JSON output.
 */
function runMigrate(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [rolekit, 'migrate', ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('migrate e2e', () => {
  it('audits the CodeStable sample fixture into an external report-dir', async () => {
    const target = await mkdtemp(join(tmpdir(), 'rk-migrate-cs-'))
    const reportDir = join(target, 'audits')
    try {
      const result = runMigrate([
        '--from',
        'codestable',
        '--source',
        codestableSample,
        '--target',
        target,
        '--report-dir',
        reportDir,
        '--audit-only',
      ])
      assert.equal(result.status, 0, result.stderr + result.stdout)
      const json = JSON.parse(result.stdout)
      assert.equal(json.migration.mode, 'audit')
      assert.equal(json.migration.status, 'succeeded')
      assert.equal(json.migration.report.base, 'report-dir')
      assert.equal(
        json.migration.counts.mandatory_by_category.find(
          (r: { category: string }) => r.category === 'feature',
        ).discovered,
        11,
      )
      assert.equal(json.migration.no_op, false)
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  it('applies Superpowers 5.1.3 sample to a fresh target', async () => {
    const target = await mkdtemp(join(tmpdir(), 'rk-migrate-sp-'))
    try {
      const result = runMigrate([
        '--from',
        'superpowers',
        '--source',
        superpowers,
        '--target',
        target,
      ])
      assert.equal(result.status, 0, result.stderr + result.stdout)
      const json = JSON.parse(result.stdout)
      assert.equal(json.migration.mode, 'apply')
      assert.equal(json.migration.target, '.rolekit')
      assert.equal(json.migration.counts.discovered, 14)
      // second apply is no-op
      const again = runMigrate([
        '--from',
        'superpowers',
        '--source',
        superpowers,
        '--target',
        target,
      ])
      assert.equal(again.status, 0, again.stderr + again.stdout)
      const json2 = JSON.parse(again.stdout)
      assert.equal(json2.migration.no_op, true)
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  it('applies the CodeStable sample fixture to a fresh target', async () => {
    const target = await mkdtemp(join(tmpdir(), 'rk-migrate-cs-apply-'))
    try {
      const result = runMigrate([
        '--from',
        'codestable',
        '--source',
        codestableSample,
        '--target',
        target,
      ])
      assert.equal(result.status, 0, result.stderr + result.stdout)
      const json = JSON.parse(result.stdout)
      assert.equal(json.migration.mode, 'apply')
      assert.equal(json.migration.target, '.rolekit')
      assert.ok(json.migration.counts.discovered >= 33)
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  it('rejects superpowers without --source (usage)', () => {
    const result = runMigrate(['--from', 'superpowers', '--target', tmpdir()])
    assert.equal(result.status, 2)
    const json = JSON.parse(result.stdout)
    assert.equal(json.error, 'usage_error')
  })
})

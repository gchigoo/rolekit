/**
 * evals CLI exit semantics e2e (spawn real bin).
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeSeed } from './helpers/sample-run.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const evalsBin = join(root, 'packages/evals/bin/evals.js')
const captureBin = join(root, 'packages/evals/bin/capture.js')

/**
 * Spawns evals CLI.
 */
function runEvals(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [evalsBin, ...args], {
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
 * Spawns capture CLI.
 */
function runCapture(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [captureBin, ...args], {
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

describe('evals CLI exit semantics', () => {
  it('usage error → exit 2', () => {
    const r = runEvals(['--nope'])
    assert.equal(r.status, 2)
  })

  it('unknown_expectation → exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-evals-cli-'))
    try {
      const seed = join(dir, 'weird')
      mkdirSync(seed)
      writeFileSync(
        join(seed, 'seed.yaml'),
        'name: weird\nsource: mock\nexpectation: weird\ncaptured: "2026-07-28"\n',
      )
      const r = runEvals([dir])
      assert.equal(r.status, 1)
      assert.match(r.stdout, /unknown_expectation/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('healthy mock ledger → exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-evals-ok-'))
    try {
      writeSeed({
        dir: join(dir, 'clean'),
        name: 'clean',
        expectation: 'clean',
        source: 'mock',
      })
      const r = runEvals([dir])
      assert.equal(r.status, 0)
      assert.match(r.stdout, /"verdict": "pass"/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('capture usage error → exit 2', () => {
    const r = runCapture([])
    assert.equal(r.status, 2)
  })
})

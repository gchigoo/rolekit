/**
 * Redaction self-check + capture admission gate.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { captureSeed } from '../src/capture.ts'
import { findForbiddenLeak, redactText } from '../src/redact.ts'
import { sampleEnvelope, sampleVerification, writeSeed } from './helpers/sample-run.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rolekit-capture-'))
}

describe('redactText', () => {
  it('strips windows abs paths, keys, usernames', () => {
    const raw =
      'worktree=C:\\Users\\steven.guo\\AppData\\Local\\Temp\\rolekit-proj\\x ' +
      'key=sk-abcdefghijklmnopqrstuvwxyz012345 OPENAI_API_KEY=secret'
    const out = redactText(raw)
    assert.equal(findForbiddenLeak(out), null)
    assert.match(out, /<redacted-abs-path>|<redacted-user>|<redacted-key>/)
  })

  it('preserves relative .rolekit suffix from windows paths', () => {
    const raw = 'C:\\Users\\steven.guo\\AppData\\Local\\Temp\\p\\.rolekit\\worktrees\\run-1'
    const out = redactText(raw)
    assert.match(out, /^\.rolekit\/worktrees\/run-1$/)
    assert.equal(findForbiddenLeak(out), null)
  })
})

describe('captureSeed admission', () => {
  it('captures mock run into seeds root and passes self-check', () => {
    const run = tempDir()
    const seeds = tempDir()
    try {
      writeSeed({
        dir: run,
        name: 'mock-clean',
        expectation: 'clean',
        writeMeta: false,
        events: `${JSON.stringify({
          schema: 'rolekit/run-event@1',
          ts: '2026-07-28T00:00:00.000Z',
          run_id: 'run-mock',
          type: 'started',
          payload: {
            task_id: 'RK-EVAL-1',
            adapter: 'mock',
            worktree:
              'C:\\\\Users\\\\steven.guo\\\\AppData\\\\Local\\\\Temp\\\\p\\\\.rolekit\\\\worktrees\\\\run-mock',
          },
        })}\n`,
      })
      const result = captureSeed({
        runDir: run,
        name: 'mock-clean',
        expectation: 'clean',
        seedsRoot: seeds,
        source: 'mock',
        captured: '2026-07-28',
      })
      assert.equal(result.ok, true)
      if (result.ok) {
        const events = readFileSync(join(result.seedDir, 'events.jsonl'), 'utf8')
        assert.equal(findForbiddenLeak(events), null)
        assert.match(readFileSync(join(result.seedDir, 'seed.yaml'), 'utf8'), /clean/)
      }
    } finally {
      rmSync(run, { recursive: true, force: true })
      rmSync(seeds, { recursive: true, force: true })
    }
  })

  it('rejects clean seed with scope violations (seed_rejected)', () => {
    const run = tempDir()
    const seeds = tempDir()
    try {
      writeSeed({
        dir: run,
        name: 'bad',
        expectation: 'clean',
        writeMeta: false,
        verification: sampleVerification(['leak']),
      })
      const result = captureSeed({
        runDir: run,
        name: 'bad-clean',
        expectation: 'clean',
        seedsRoot: seeds,
        source: 'mock',
      })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, 'seed_rejected')
    } finally {
      rmSync(run, { recursive: true, force: true })
      rmSync(seeds, { recursive: true, force: true })
    }
  })

  it('rejects violation seed with empty scope_violations', () => {
    const run = tempDir()
    const seeds = tempDir()
    try {
      writeSeed({
        dir: run,
        name: 'bad-v',
        expectation: 'violation',
        writeMeta: false,
        result: sampleEnvelope({
          status: 'failed',
          unresolved: ['x'],
          recommended_next_action: 'retry',
        }),
        verification: sampleVerification([]),
      })
      const result = captureSeed({
        runDir: run,
        name: 'bad-viol',
        expectation: 'violation',
        seedsRoot: seeds,
        source: 'mock',
      })
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, 'seed_rejected')
    } finally {
      rmSync(run, { recursive: true, force: true })
      rmSync(seeds, { recursive: true, force: true })
    }
  })
})

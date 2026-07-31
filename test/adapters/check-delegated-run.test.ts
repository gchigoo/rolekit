/**
 * Fixture regression for check:delegation (markdown + Pi jsonl shapes).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkDelegatedRun } from '../../scripts/check-delegated-run.mjs'
import { extractPiSession } from '../../scripts/extract-pi-session.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sessions = join(here, 'fixtures', 'sessions')
const runDir = join(here, 'fixtures', 'run-dir')

describe('check:delegation fixtures', () => {
  it('passes positive session with Available commands and skill load', () => {
    const result = checkDelegatedRun(join(sessions, 'positive.md'), runDir)
    assert.equal(result.ok, true, result.errors.join('; '))
    assert.equal(result.skill, 'rolekit-adapter-pi')
  })

  it('fails when command is outside Available', () => {
    const result = checkDelegatedRun(join(sessions, 'negative-oos.md'), runDir)
    assert.equal(result.ok, false)
    assert.ok(
      result.errors.some((e: string) => /outside Available|teleport/i.test(e)),
      result.errors.join('; '),
    )
  })

  it('fails when skill load evidence is missing', () => {
    const result = checkDelegatedRun(join(sessions, 'negative-noskill.md'), runDir)
    assert.equal(result.ok, false)
    assert.ok(
      result.errors.some((e: string) => /missing skill load evidence/i.test(e)),
      result.errors.join('; '),
    )
  })

  it('passes realistic Pi session.jsonl (ignores SKILL echo and tool timeout noise)', () => {
    const result = checkDelegatedRun(join(sessions, 'pi-positive.jsonl'), runDir)
    assert.equal(result.ok, true, result.errors.join('; '))
    assert.equal(result.skill, 'rolekit-adapter-pi')
    assert.equal(result.source, 'pi-jsonl→extract-pi-session')
    assert.ok(result.commands.length >= 5)
  })

  it('extract-pi-session omits skill body template commands', () => {
    const raw = readFileSync(join(sessions, 'pi-positive.jsonl'), 'utf8')
    const extracted = extractPiSession(raw)
    assert.equal(extracted.skillLoaded, true)
    assert.equal(extracted.commands.length, 5)
    assert.ok(!extracted.commands.some((c: { cmd: string }) => c.cmd.includes('<file>')))
    assert.ok(!extracted.transcript.includes('exits non-zero'))
  })
})

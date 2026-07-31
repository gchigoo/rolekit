/**
 * Committed seed hygiene: no leaks, no mock in daily ledger, violation unresolved.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SEED_ARTIFACTS } from '../src/capture.ts'
import { findForbiddenLeak } from '../src/redact.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const seedsRoot = join(root, 'evals/seeds')

describe('evals/seeds hygiene', () => {
  it('has >=5 real seeds with no mock source and five artifacts', () => {
    const dirs = readdirSync(seedsRoot)
      .map((n) => join(seedsRoot, n))
      .filter((p) => statSync(p).isDirectory())
    assert.ok(dirs.length >= 5)
    for (const dir of dirs) {
      const meta = readFileSync(join(dir, 'seed.yaml'), 'utf8')
      assert.doesNotMatch(meta, /^source:\s*mock\s*$/m)
      for (const artifact of SEED_ARTIFACTS) {
        assert.equal(existsSync(join(dir, artifact)), true, `${dir} missing ${artifact}`)
      }
      for (const artifact of [...SEED_ARTIFACTS, 'seed.yaml']) {
        const text = readFileSync(join(dir, artifact), 'utf8')
        assert.equal(findForbiddenLeak(text), null, `${dir}/${artifact} leak`)
      }
    }
  })

  it('violation seeds have non-empty unresolved', () => {
    const dirs = readdirSync(seedsRoot)
      .map((n) => join(seedsRoot, n))
      .filter((p) => statSync(p).isDirectory())
    let violations = 0
    for (const dir of dirs) {
      const meta = readFileSync(join(dir, 'seed.yaml'), 'utf8')
      if (!/expectation:\s*violation/.test(meta)) continue
      violations += 1
      const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as {
        unresolved: unknown[]
      }
      assert.ok(Array.isArray(result.unresolved) && result.unresolved.length > 0)
    }
    assert.ok(violations >= 2)
  })
})

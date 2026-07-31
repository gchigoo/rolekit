import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalize, sha256Canonical } from '../../src/canonical-json.ts'

describe('RFC8785 canonical JSON', () => {
  it('sorts object keys and preserves array order', () => {
    const canonical = canonicalize({
      b: 2,
      a: [3, 1],
      c: { z: true, y: null },
    })
    assert.equal(canonical, '{"a":[3,1],"b":2,"c":{"y":null,"z":true}}')
  })

  it('golden digest for prepare input shape includes knowledge_rules', () => {
    const shape = {
      adapter: 'mock',
      detect_snapshot: null,
      executor_profile: { adapter: 'mock', name: 'mock', schema: 'rolekit/executor-profile@1' },
      knowledge_rules: [] as Array<{ id: string; content_sha256: string }>,
      policy: { default_action: 'ignore', schema: 'rolekit/gate-policy@1' },
      profile_bundle: { profile: { name: 'x' }, resolved_fragments: [] },
      task: { id: 'RK-1' },
      verifier_mode: 'minimal',
    }
    const digest = sha256Canonical(shape)
    assert.equal(digest.length, 64)
    assert.equal(digest, sha256Canonical({ ...shape }))
    const withRule = sha256Canonical({
      ...shape,
      knowledge_rules: [{ content_sha256: 'ab', id: 'KN-1' }],
    })
    assert.notEqual(withRule, digest)
  })
})

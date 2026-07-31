import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UnknownAdapterError } from '../../src/errors.ts'
import { createAdapter, listAdapters } from '../../src/registry.ts'

describe('adapter registry', () => {
  it('registers chatgpt-codex, mock, openai-responses, and pi-rpc', () => {
    assert.deepEqual(listAdapters(), ['chatgpt-codex', 'mock', 'openai-responses', 'pi-rpc'])
  })

  it('throws UnknownAdapterError for unknown adapter', () => {
    assert.throws(
      () => createAdapter('not-a-real-adapter', { projectRoot: process.cwd() }),
      UnknownAdapterError,
    )
  })

  it('creates openai-responses adapter', () => {
    const adapter = createAdapter('openai-responses', { projectRoot: process.cwd() })
    assert.equal(typeof adapter.probe, 'function')
  })
})

import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { createStrictJsonlReader } from '../../src/jsonl-framing.ts'

describe('strict JSONL framing', () => {
  it('does not split on U+2028 / U+2029 inside payload', async () => {
    const line = `{"text":"a\u2028b\u2029c"}`
    const stream = Readable.from([Buffer.from(`${line}\n`, 'utf8')])
    const lines: string[] = []
    await new Promise<void>((resolve) => {
      createStrictJsonlReader(stream, (l) => lines.push(l))
      stream.on('end', () => resolve())
    })
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0]!).text, 'a\u2028b\u2029c')
  })
})

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseInputFile } from '../src/parse-input.ts'

describe('parseInputFile', () => {
  it('parses knowledge markdown into frontmatter and body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-parse-'))
    const file = join(dir, 'entry.md')
    writeFileSync(
      file,
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-1',
        'type: rule',
        'title: Keep output clean',
        'status: active',
        'tags: []',
        'created: "2026-07-28T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        'Single paragraph rule body.',
        '',
      ].join('\n'),
      'utf8',
    )
    const parsed = parseInputFile(file)
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.schema, 'rolekit/knowledge-entry@1')
      const data = parsed.data as { frontmatter: { id: string }; body: string }
      assert.equal(data.frontmatter.id, 'KN-1')
      assert.match(data.body, /Single paragraph/)
    }
  })

  it('returns parse_error for empty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolekit-parse-'))
    const file = join(dir, 'empty.yaml')
    writeFileSync(file, '', 'utf8')
    const parsed = parseInputFile(file)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.equal(parsed.code, 'parse_error')
    }
  })
})

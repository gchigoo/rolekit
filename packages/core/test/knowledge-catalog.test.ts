import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterKnowledge,
  parseKnowledgeMarkdown,
  selectActiveRules,
  serializeKnowledgeDocument,
  validateArtifact,
} from '../src/index.ts'

const SAMPLE = `---
schema: rolekit/knowledge-entry@1
id: KN-1
type: rule
title: Keep output clean
status: active
tags:
  - a
  - b
created: "2026-07-29T00:00:00.000Z"
source: null
---

Single paragraph rule body.
`

describe('knowledge catalog', () => {
  it('normalizes CRLF/CR to the same LF body', () => {
    const lf = parseKnowledgeMarkdown(SAMPLE)
    const crlf = parseKnowledgeMarkdown(SAMPLE.replace(/\n/g, '\r\n'))
    const cr = parseKnowledgeMarkdown(SAMPLE.replace(/\n/g, '\r'))
    assert.equal(lf.body, crlf.body)
    assert.equal(lf.body, cr.body)
    assert.ok(!lf.body.includes('\r'))
  })

  it('round-trips serialize → parse with fixed key order', () => {
    const doc = parseKnowledgeMarkdown(SAMPLE)
    const text = serializeKnowledgeDocument(doc)
    assert.match(text, /^---\nschema:/)
    assert.ok(text.indexOf('schema:') < text.indexOf('\nid:'))
    assert.ok(text.indexOf('\nid:') < text.indexOf('\ntype:'))
    assert.ok(text.indexOf('\ntags:') < text.indexOf('\ncreated:'))
    const again = parseKnowledgeMarkdown(text)
    assert.deepEqual(again.frontmatter, doc.frontmatter)
    assert.equal(again.body.replace(/\n+$/, ''), doc.body.replace(/\n+$/, ''))
    const valid = validateArtifact('rolekit/knowledge-entry@1', again)
    assert.equal(valid.valid, true)
  })

  it('filters with AND tags and sorts by id', () => {
    const a = parseKnowledgeMarkdown(
      SAMPLE.replace('KN-1', 'KN-B').replace('title: Keep', 'title: B'),
    )
    const b = parseKnowledgeMarkdown(
      SAMPLE.replace('KN-1', 'KN-A')
        .replace('type: rule', 'type: note')
        .replace('title: Keep', 'title: A'),
    )
    const c = parseKnowledgeMarkdown(
      SAMPLE.replace('KN-1', 'KN-C').replace('tags:\n  - a\n  - b', 'tags:\n  - a'),
    )
    const filtered = filterKnowledge([a, b, c], { type: 'rule', tags: ['a', 'b'] })
    assert.deepEqual(
      filtered.map((d) => d.frontmatter.id),
      ['KN-B'],
    )
  })

  it('selectActiveRules only projects active rules', () => {
    const active = parseKnowledgeMarkdown(SAMPLE)
    const deprecated = parseKnowledgeMarkdown(
      SAMPLE.replace('KN-1', 'KN-2').replace('status: active', 'status: deprecated'),
    )
    const adr = parseKnowledgeMarkdown(
      [
        '---',
        'schema: rolekit/knowledge-entry@1',
        'id: KN-3',
        'type: adr',
        'title: Decision',
        'status: active',
        'tags: []',
        'created: "2026-07-29T00:00:00.000Z"',
        'source: null',
        '---',
        '',
        '## Context',
        'c',
        '',
        '## Decision',
        'd',
        '',
        '## Consequences',
        'x',
        '',
        '## Alternatives Considered',
        'y',
        '',
      ].join('\n'),
    )
    const rules = selectActiveRules([active, deprecated, adr])
    assert.equal(rules.length, 1)
    assert.equal(rules[0]!.id, 'KN-1')
    assert.equal(rules[0]!.title, 'Keep output clean')
    assert.match(rules[0]!.body, /Single paragraph/)
  })
})

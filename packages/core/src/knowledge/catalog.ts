import { parse as parseYaml } from 'yaml'
import type { KnowledgeEntry } from '../schemas/knowledge-entry.ts'
import type { KnowledgeDocument, KnowledgeQuery, PromptRule } from './types.ts'

const FRONTMATTER_KEYS = [
  'schema',
  'id',
  'type',
  'title',
  'status',
  'tags',
  'created',
  'source',
] as const

/**
 * Normalizes CR/CRLF to LF before any knowledge codec work.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Parses Knowledge markdown into `{frontmatter, body}` with LF-only body.
 * Throws Error on missing/invalid frontmatter delimiters or non-mapping YAML.
 */
export function parseKnowledgeMarkdown(text: string): KnowledgeDocument {
  const normalized = normalizeNewlines(text.replace(/^\uFEFF/, ''))
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    if (!normalized.startsWith('---')) {
      throw new Error('markdown file must start with YAML frontmatter delimited by ---')
    }
  }
  if (!normalized.startsWith('---')) {
    throw new Error('markdown file must start with YAML frontmatter delimited by ---')
  }
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) {
    throw new Error('markdown file must start with YAML frontmatter delimited by ---')
  }
  const frontmatterText = normalized.slice(4, end).trim()
  let bodyStart = end + 4
  if (normalized[bodyStart] === '\n') bodyStart += 1
  const body = normalized.slice(bodyStart)
  const frontmatter = parseYaml(frontmatterText)
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('frontmatter must be a YAML mapping')
  }
  return {
    frontmatter: frontmatter as KnowledgeEntry,
    body,
  }
}

/**
 * Serializes a KnowledgeDocument with fixed frontmatter key order and LF newlines.
 */
export function serializeKnowledgeDocument(doc: KnowledgeDocument): string {
  const fm = doc.frontmatter
  const lines: string[] = ['---']
  for (const key of FRONTMATTER_KEYS) {
    const value = fm[key]
    if (key === 'tags') {
      const tags = Array.isArray(value) ? value : []
      if (tags.length === 0) {
        lines.push('tags: []')
      } else {
        lines.push('tags:')
        for (const tag of tags) {
          lines.push(`  - ${yamlScalar(tag)}`)
        }
      }
      continue
    }
    if (key === 'source') {
      lines.push(value === null ? 'source: null' : `source: ${yamlScalar(String(value))}`)
      continue
    }
    lines.push(`${key}: ${yamlScalar(String(value))}`)
  }
  lines.push('---')
  const body = normalizeNewlines(doc.body)
  // Always emit a newline after the closing fence; do not collapse a leading body `\n`.
  const bodyOut = body.length === 0 || body.endsWith('\n') ? body : `${body}\n`
  return `${lines.join('\n')}\n${bodyOut}`
}

/**
 * Filters knowledge records with AND semantics; sorts by frontmatter.id ascending.
 */
export function filterKnowledge(
  records: KnowledgeDocument[],
  query: KnowledgeQuery,
): KnowledgeDocument[] {
  const out = records.filter((doc) => {
    if (query.type !== undefined && doc.frontmatter.type !== query.type) return false
    if (query.status !== undefined && doc.frontmatter.status !== query.status) return false
    if (query.tags !== undefined) {
      for (const tag of query.tags) {
        if (!doc.frontmatter.tags.includes(tag)) return false
      }
    }
    return true
  })
  out.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id))
  return out
}

/**
 * Selects active rules and projects PromptRule[] sorted by id.
 */
export function selectActiveRules(records: KnowledgeDocument[]): PromptRule[] {
  return filterKnowledge(records, { type: 'rule', status: 'active' }).map((doc) => ({
    id: doc.frontmatter.id,
    title: doc.frontmatter.title,
    // Prompt/hash body is LF-normalized content without surrounding blank lines.
    body: doc.body.replace(/^\n+/, '').replace(/\n+$/, ''),
  }))
}

/**
 * Emits a YAML scalar suitable for Knowledge frontmatter lines.
 */
function yamlScalar(value: string): string {
  if (value === '') return '""'
  if (/^[\w./:@+-]+$/.test(value) && !/^(true|false|null|~)$/i.test(value)) {
    return value
  }
  return JSON.stringify(value)
}

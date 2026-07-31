/**
 * Markdown / frontmatter helpers for migrate adapters.
 */

import { parse as parseYaml } from 'yaml'
import { MigrationError } from './types.ts'

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>
  body: string
  raw: string
}

/**
 * Parses YAML frontmatter + body with LF normalization. Empty frontmatter allowed as {}.
 */
export function parseMarkdownDocument(text: string): ParsedMarkdown {
  const raw = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  if (!raw.startsWith('---\n') && raw !== '---') {
    return { frontmatter: {}, body: raw, raw }
  }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) {
    return { frontmatter: {}, body: raw, raw }
  }
  const fmText = raw.slice(4, end)
  let bodyStart = end + 4
  if (raw[bodyStart] === '\n') bodyStart += 1
  const body = raw.slice(bodyStart)
  let frontmatter: Record<string, unknown> = {}
  if (fmText.trim().length > 0) {
    const parsed = parseYaml(fmText)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MigrationError('migration_semantic_fidelity_failed', {
        detail: {
          code: 'migration_semantic_fidelity_failed',
          message_code: 'migration_semantic_fidelity_failed',
          refs: ['frontmatter'],
        },
      })
    }
    frontmatter = parsed as Record<string, unknown>
  }
  return { frontmatter, body, raw }
}

/**
 * True when body has no semantic content after stripping frontmatter + first heading.
 */
export function isSemanticallyEmpty(body: string): boolean {
  let text = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  // drop first ATX heading line if present
  text = text.replace(/^#{1,6}[^\n]*\n?/, '').trim()
  return text.length === 0
}

/**
 * Extracts leading YYYY-MM-DD from a basename or path segment.
 */
export function leadingDate(name: string): string | null {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})(?:-|_|$)/)
  return m ? m[1]! : null
}

/**
 * Unicode whitespace trim (not NFC normalize).
 */
export function unicodeTrim(s: string): string {
  return s.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/gu, '')
}

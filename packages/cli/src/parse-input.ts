import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { parseKnowledgeMarkdown } from '@rolekit/core'
import { parse as parseYaml } from 'yaml'

export type ParsedInput =
  | { ok: true; schema: string; data: unknown }
  | { ok: false; code: 'parse_error' | 'unknown_schema'; message: string }

/**
 * Reads and parses a validate input file by extension.
 * Knowledge `.md` uses core parseKnowledgeMarkdown (no CLI frontmatter split).
 */
export function parseInputFile(filePath: string): ParsedInput {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to read file'
    return { ok: false, code: 'parse_error', message }
  }

  if (raw.length === 0 || raw.trim().length === 0) {
    return { ok: false, code: 'parse_error', message: 'empty file' }
  }

  // Windows-common UTF-8 BOM: reject with parse_error (do not crash)
  if (raw.charCodeAt(0) === 0xfeff) {
    return { ok: false, code: 'parse_error', message: 'UTF-8 BOM is not allowed' }
  }

  const text = raw
  const ext = extname(filePath).toLowerCase()

  try {
    if (ext === '.md') {
      let doc: ReturnType<typeof parseKnowledgeMarkdown>
      try {
        doc = parseKnowledgeMarkdown(text)
      } catch (error) {
        return {
          ok: false,
          code: 'parse_error',
          message: error instanceof Error ? error.message : 'knowledge markdown parse failed',
        }
      }
      const schema = doc.frontmatter.schema
      if (typeof schema !== 'string' || schema.length === 0) {
        return { ok: false, code: 'unknown_schema', message: 'missing schema field in frontmatter' }
      }
      return {
        ok: true,
        schema,
        data: { frontmatter: doc.frontmatter, body: doc.body },
      }
    }

    if (ext === '.json') {
      const data = JSON.parse(text) as unknown
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, code: 'parse_error', message: 'JSON root must be an object' }
      }
      const schema = (data as Record<string, unknown>).schema
      if (typeof schema !== 'string' || schema.length === 0) {
        return { ok: false, code: 'unknown_schema', message: 'missing schema field' }
      }
      return { ok: true, schema, data }
    }

    if (ext === '.yaml' || ext === '.yml') {
      const data = parseYaml(text)
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, code: 'parse_error', message: 'YAML root must be a mapping' }
      }
      const schema = (data as Record<string, unknown>).schema
      if (typeof schema !== 'string' || schema.length === 0) {
        return { ok: false, code: 'unknown_schema', message: 'missing schema field' }
      }
      return { ok: true, schema, data }
    }

    return {
      ok: false,
      code: 'parse_error',
      message: `unsupported file extension: ${ext || '(none)'}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'parse failed'
    return { ok: false, code: 'parse_error', message }
  }
}

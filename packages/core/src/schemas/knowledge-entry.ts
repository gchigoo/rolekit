import { type Static, Type } from '@sinclair/typebox'
import type { SemanticIssue } from '../types.ts'

/**
 * KnowledgeEntry frontmatter schema — roadmap 4.10.
 * Structural validation covers frontmatter only; body is for semantic assertions.
 */
export const KnowledgeEntrySchema = Type.Object(
  {
    schema: Type.Literal('rolekit/knowledge-entry@1'),
    id: Type.String({ minLength: 1 }),
    type: Type.Union([
      Type.Literal('rule'),
      Type.Literal('adr'),
      Type.Literal('learning'),
      Type.Literal('note'),
    ]),
    title: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal('active'),
      Type.Literal('superseded'),
      Type.Literal('deprecated'),
    ]),
    tags: Type.Array(Type.String()),
    created: Type.String({ minLength: 1 }),
    source: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'rolekit/knowledge-entry@1', additionalProperties: false },
)

export type KnowledgeEntry = Static<typeof KnowledgeEntrySchema>

/** Payload shape accepted by validateArtifact for knowledge entries. */
export interface KnowledgeEntryPayload {
  frontmatter: KnowledgeEntry
  body: string
}

const NYGARD_HEADINGS = ['Context', 'Decision', 'Consequences', 'Alternatives Considered'] as const

/**
 * Returns true when body contains a markdown heading for the given title.
 */
function hasHeading(body: string, title: string): boolean {
  const pattern = new RegExp(`^#{1,6}\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  return pattern.test(body)
}

/**
 * Semantic rules for KnowledgeEntry (D7.5): type-specific body assertions.
 */
export function semanticRules(data: KnowledgeEntryPayload): SemanticIssue[] {
  const issues: SemanticIssue[] = []
  const { frontmatter, body } = data
  if (frontmatter.type === 'adr') {
    for (const heading of NYGARD_HEADINGS) {
      if (!hasHeading(body, heading)) {
        issues.push({
          path: '/body',
          message: `type=adr requires Nygard heading "${heading}"`,
        })
      }
    }
  }
  if (frontmatter.type === 'rule') {
    const trimmed = body.trim()
    if (trimmed.length === 0) {
      issues.push({
        path: '/body',
        message: 'type=rule requires a non-empty single-paragraph body',
      })
    } else if (/\n\s*\n/.test(trimmed)) {
      issues.push({
        path: '/body',
        message: 'type=rule body must be a single paragraph (no blank-line split)',
      })
    }
  }
  return issues
}

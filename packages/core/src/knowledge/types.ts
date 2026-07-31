import type { KnowledgeEntry } from '../schemas/knowledge-entry.ts'

/** Parsed knowledge document: frontmatter equals KnowledgeEntry; body is LF-normalized. */
export interface KnowledgeDocument {
  frontmatter: KnowledgeEntry
  body: string
}

/** Minimal prompt projection for active rules. */
export interface PromptRule {
  id: string
  title: string
  body: string
}

/** AND filter query for knowledge catalog. */
export interface KnowledgeQuery {
  type?: KnowledgeEntry['type']
  status?: KnowledgeEntry['status']
  tags?: string[]
}

/**
 * attention.md → attention-rule entities (D7).
 */

import type { Content, Heading, List, ListItem, Paragraph, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { sha256Canonical, sha256Text } from '../../canonical.ts'
import { unicodeTrim } from '../../markdown.ts'
import { MigrationError } from '../../types.ts'

export interface AttentionRuleDraft {
  h2: string
  ordinal: number
  body: string
  tags: string[]
  source_key: string
  source_digest: string
}

export interface AttentionParseResult {
  fileSha256: string
  rules: AttentionRuleDraft[]
}

/**
 * Parses attention.md into rule drafts; H2 段内仅直接子级 list/paragraph 产 rule，H3 下 list 不计入 rule。
 */
export function parseAttentionRules(content: string, fileSha256: string): AttentionParseResult {
  const text = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  const tree = fromMarkdown(text)
  const h2Sections = splitH2Sections(tree)
  const seenH2 = new Set<string>()
  const rules: AttentionRuleDraft[] = []

  for (const section of h2Sections) {
    const h2Trimmed = unicodeTrim(section.h2)
    if (!h2Trimmed) {
      throw attentionError(['attention:empty-h2'])
    }
    if (seenH2.has(h2Trimmed)) {
      throw attentionError(['attention:duplicate-h2', h2Trimmed])
    }
    seenH2.add(h2Trimmed)

    const drafts = extractRulesFromH2Direct(section.directNodes, h2Trimmed)
    let ordinal = 0
    for (const draft of drafts) {
      if (draft.body.includes('\n\n')) {
        throw attentionError(['attention:multiline-rule', h2Trimmed])
      }
      ordinal += 1
      const source_key = `attention:${h2Trimmed}:${ordinal}`
      rules.push({
        h2: h2Trimmed,
        ordinal,
        body: draft.body,
        tags: draft.tags,
        source_key,
        source_digest: sha256Canonical({
          attention_file_sha256: fileSha256,
          h2: h2Trimmed,
          ordinal,
          body: draft.body,
        }),
      })
    }
  }

  return { fileSha256, rules }
}

interface H2Section {
  h2: string
  directNodes: Content[]
}

function splitH2Sections(tree: Root): H2Section[] {
  const sections: H2Section[] = []
  let current: H2Section | null = null
  let inH1Preamble = true
  let sectionDepth = 2

  for (const node of tree.children) {
    if (node.type === 'html' && node.value.trim().startsWith('<!--')) continue
    if (node.type === 'heading' && node.depth === 1) {
      inH1Preamble = true
      continue
    }
    if (node.type === 'heading' && node.depth === 2) {
      inH1Preamble = false
      sectionDepth = 2
      current = { h2: headingText(node), directNodes: [] }
      sections.push(current)
      continue
    }
    if (inH1Preamble) continue
    if (!current) continue
    if (node.type === 'heading' && node.depth >= 3) {
      sectionDepth = node.depth
      continue
    }
    // 仅 H2 段内、首个 H3 之前的直接内容产 rule；H3 下 list 不计入
    if (sectionDepth === 2) {
      current.directNodes.push(node)
    }
  }
  return sections
}

interface RuleDraft {
  body: string
  tags: string[]
}

function extractRulesFromH2Direct(nodes: Content[], h2: string): RuleDraft[] {
  const baseTags = ['attention', `h2:${h2}`]
  const listItems = collectTopLevelListItems(nodes)
  if (listItems.length > 0) {
    return listItems
      .map((item) => ({
        body: unicodeTrim(foldLines(item.text)),
        tags: dedupeTags([...baseTags, ...item.ancestorTags]),
      }))
      .filter((r) => r.body.length > 0)
  }
  const paragraphs = collectParagraphNodes(nodes)
  return paragraphs
    .map((p) => ({
      body: unicodeTrim(foldLines(p.text)),
      tags: dedupeTags([...baseTags, ...p.ancestorTags]),
    }))
    .filter((r) => r.body.length > 0)
}

interface ListItemDraft {
  text: string
  ancestorTags: string[]
}

function collectTopLevelListItems(nodes: Content[]): ListItemDraft[] {
  const out: ListItemDraft[] = []
  for (const node of nodes) {
    if (node.type !== 'list') continue
    for (const item of (node as List).children) {
      out.push({ text: listItemText(item as ListItem), ancestorTags: [] })
    }
  }
  return out
}

interface ParagraphDraft {
  text: string
  ancestorTags: string[]
}

function collectParagraphNodes(nodes: Content[]): ParagraphDraft[] {
  const out: ParagraphDraft[] = []
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      out.push({ text: paragraphText(node as Paragraph), ancestorTags: [] })
    }
  }
  return out
}

function listItemText(item: ListItem): string {
  const parts: string[] = []
  for (const child of item.children) {
    if (child.type === 'paragraph') {
      parts.push(paragraphText(child))
    } else if (child.type === 'list') {
      for (const nested of child.children) {
        parts.push(listItemText(nested as ListItem))
      }
    }
  }
  return parts.join(' ')
}

function paragraphText(node: Paragraph): string {
  return node.children
    .map((c) => {
      if (c.type === 'text') return c.value
      if (c.type === 'emphasis' || c.type === 'strong') {
        return (c.children as Array<{ type: string; value?: string }>)
          .map((x) => x.value ?? '')
          .join('')
      }
      if (c.type === 'inlineCode') return c.value
      return ''
    })
    .join('')
}

function headingText(node: Heading): string {
  return node.children.map((c) => ('value' in c ? String(c.value) : '')).join('')
}

function foldLines(text: string): string {
  return text.replace(/\s+/g, ' ')
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function attentionError(refs: string[]): MigrationError {
  return new MigrationError('migration_semantic_fidelity_failed', {
    detail: {
      code: 'migration_semantic_fidelity_failed',
      message_code: 'migration_semantic_fidelity_failed',
      refs,
    },
  })
}

/** SHA-256 of attention file bytes. */
export function attentionFileDigest(content: string): string {
  return sha256Text(content)
}

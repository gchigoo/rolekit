/**
 * CommonMark AST heading extraction for Superpowers profile fragments (D12b).
 */

import type { Content, Heading, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parseMarkdownDocument, unicodeTrim } from '../../markdown.ts'
import type { DiscardedRecord } from '../../types.ts'
import { MigrationError } from '../../types.ts'
import type { HeadingRef } from './templates.ts'

export const FORBIDDEN_BLOCK_RE =
  /superpowers:|Skill tool|TodoWrite|<HARD-GATE>|docs\/superpowers|\bsubagents?\b|\bdispatch(ing)?\b|Task tool|implementer-prompt|spec-reviewer-prompt|git checkout|gh pr/i

export interface ExtractOptions {
  sourcePath: string
  sourceSha256: string
  skillSlug: string
}

export interface ExtractResult {
  text: string
  discarded: DiscardedRecord[]
}

interface RealHeading {
  depth: number
  text: string
  start: number
  end: number
}

/**
 * Extracts and normalizes markdown sections per frozen heading refs.
 */
export function extractFragmentSections(
  markdown: string,
  headingRefs: HeadingRef[],
  options: ExtractOptions,
): ExtractResult {
  const parsed = parseMarkdownDocument(markdown)
  const body = parsed.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const tree = fromMarkdown(body) as Root
  const realHeadings = collectRealHeadings(tree)
  const discarded: DiscardedRecord[] = []
  const parts: string[] = []

  for (const ref of headingRefs) {
    if (ref.kind === 'preamble') {
      const slice = extractPreamble(body, tree, realHeadings)
      const cleaned = lintBlocks(slice, {
        ...options,
        heading: '@preamble',
        discarded,
      })
      if (cleaned.length > 0) parts.push(cleaned)
      continue
    }

    const matches = realHeadings.filter((h) => h.depth === 2 && h.text === ref.text)
    if (matches.length === 0) {
      throwSemanticFidelity(`missing heading H2:${ref.text}`, [options.sourcePath])
    }
    if (matches.length > 1) {
      throwSemanticFidelity(`duplicate heading H2:${ref.text}`, [options.sourcePath])
    }
    const match = matches[0]
    if (!match) {
      throwSemanticFidelity(`missing heading H2:${ref.text}`, [options.sourcePath])
    }
    const slice = extractHeadingBlock(body, match, realHeadings)
    const cleaned = lintBlocks(slice, {
      ...options,
      heading: ref.text,
      discarded,
    })
    if (cleaned.length > 0) parts.push(cleaned)
  }

  const text = parts.join('\n\n').trim()
  if (text.length === 0) {
    throwSemanticFidelity('empty fragment', [options.sourcePath])
  }
  return { text: `${text}\n`, discarded }
}

/**
 * Lists all real H2 headings outside code/HTML blocks.
 */
export function listRealH2Headings(markdown: string): string[] {
  const parsed = parseMarkdownDocument(markdown)
  const body = parsed.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const tree = fromMarkdown(body) as Root
  return collectRealHeadings(tree)
    .filter((h) => h.depth === 2)
    .map((h) => h.text)
}

function collectRealHeadings(tree: Root): RealHeading[] {
  const out: RealHeading[] = []
  walkOutsideCodeHtml(tree, (node) => {
    if (node.type !== 'heading') return
    const heading = node as Heading
    const pos = heading.position
    if (!pos) return
    out.push({
      depth: heading.depth,
      text: unicodeTrim(headingText(heading)),
      start: pos.start.offset ?? 0,
      end: pos.end.offset ?? 0,
    })
  })
  return out
}

function walkOutsideCodeHtml(node: Content | Root, visit: (node: Content) => void): void {
  if (node.type === 'code' || node.type === 'html') return
  if (node.type !== 'root') visit(node)
  if (!('children' in node) || !Array.isArray(node.children)) return
  for (const child of node.children as Content[]) {
    walkOutsideCodeHtml(child, visit)
  }
}

function headingText(node: Heading): string {
  return flattenPhrasing(node.children).trim()
}

function flattenPhrasing(nodes: Content[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value
        break
      case 'inlineCode':
        out += node.value
        break
      case 'emphasis':
      case 'strong':
      case 'delete':
        out += flattenPhrasing(node.children as Content[])
        break
      case 'link':
        out += flattenPhrasing(node.children as Content[])
        break
      default:
        break
    }
  }
  return out
}

function extractPreamble(body: string, tree: Root, headings: RealHeading[]): string {
  const firstH2 = headings.find((h) => h.depth === 2)
  const end = firstH2?.start ?? body.length
  const chunks: string[] = []
  for (const child of tree.children) {
    if (child.type === 'code' || child.type === 'html') continue
    const pos = child.position
    if (!pos || (pos.start.offset ?? 0) >= end) continue
    const sliceEnd = Math.min(pos.end.offset ?? end, end)
    chunks.push(body.slice(pos.start.offset ?? 0, sliceEnd))
  }
  return normalizeLf(chunks.join('\n').trim())
}

function extractHeadingBlock(body: string, heading: RealHeading, headings: RealHeading[]): string {
  const next = headings.find((h) => h.start > heading.start && h.depth <= heading.depth)
  const end = next?.start ?? body.length
  return normalizeLf(body.slice(heading.start, end).trim())
}

function lintBlocks(
  text: string,
  ctx: ExtractOptions & { heading: string; discarded: DiscardedRecord[] },
): string {
  const blocks = splitBlocks(text)
  const kept: string[] = []
  for (const block of blocks) {
    if (FORBIDDEN_BLOCK_RE.test(block)) {
      ctx.discarded.push({
        source_path: ctx.sourcePath,
        heading: ctx.heading,
        source_sha256: ctx.sourceSha256,
        reason: 'forbidden-block',
      })
      continue
    }
    kept.push(block)
  }
  return normalizeLf(kept.join('\n\n').trim())
}

function splitBlocks(text: string): string[] {
  const normalized = normalizeLf(text)
  if (normalized.length === 0) return []
  const lines = normalized.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let inFence = false
  let fenceChar = ''
  for (const line of lines) {
    const fence = line.match(/^(`{3,}|~{3,})/)
    if (fence?.[1]) {
      const marker = fence[1]
      if (!inFence) {
        if (current.length > 0) {
          blocks.push(current.join('\n').trim())
          current = []
        }
        inFence = true
        fenceChar = marker[0] ?? '`'
        current.push(line)
        continue
      }
      if (line.startsWith(fenceChar.repeat(3))) {
        current.push(line)
        blocks.push(current.join('\n').trim())
        current = []
        inFence = false
        continue
      }
    }
    if (inFence) {
      current.push(line)
      continue
    }
    if (line.trim().length === 0) {
      if (current.length > 0) {
        blocks.push(current.join('\n').trim())
        current = []
      }
      continue
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current.join('\n').trim())
  return blocks.filter((b) => b.length > 0)
}

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Throws semantic fidelity failure with stable migrate error code.
 */
export function throwSemanticFidelity(message: string, refs: string[]): never {
  throw new MigrationError('migration_semantic_fidelity_failed', {
    detail: {
      code: 'migration_semantic_fidelity_failed',
      message_code: 'migration_semantic_fidelity_failed',
      refs: [...refs, message],
    },
  })
}

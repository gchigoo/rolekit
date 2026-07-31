import { readFileSync } from 'node:fs'
import type { KnowledgeDocument, KnowledgeEntry } from '@rolekit/core'
import { KnowledgeCliError } from './errors.ts'
import { FileKnowledgeStore } from './store.ts'

const TYPES = new Set(['rule', 'adr', 'learning', 'note'])
const STATUSES = new Set(['active', 'superseded', 'deprecated'])

/**
 * Dispatch rolekit knowledge <sub> ...
 */
export async function cmdKnowledge(
  args: string[],
  json: boolean,
  projectRoot: string,
): Promise<void> {
  const sub = args[0]
  if (!sub || sub === '--help' || sub === '-h') {
    usageKnowledge()
    return
  }
  const store = new FileKnowledgeStore(projectRoot)
  const rest = args.slice(1)

  if (sub === 'create') {
    const parsed = parseCreate(rest)
    const body = readBody(parsed.bodyFile)
    const entry = await store.create({
      type: parsed.type,
      title: parsed.title,
      body,
      tags: parsed.tags,
      status: parsed.status,
    })
    emitEntry(json, entry)
    return
  }
  if (sub === 'get') {
    const id = requirePositional(rest, 'id')
    rejectUnknownFlags(rest.slice(1), [])
    const entry = await store.get(id)
    emitEntry(json, entry)
    return
  }
  if (sub === 'search') {
    const query = parseSearch(rest)
    const entries = await store.search(query)
    if (json) emitJson({ entries: entries.map(toPayload) })
    else {
      for (const e of entries) {
        process.stdout.write(
          `${e.frontmatter.id}\t${e.frontmatter.type}\t${e.frontmatter.status}\t${e.frontmatter.title}\n`,
        )
      }
    }
    process.exitCode = 0
    return
  }
  if (sub === 'edit') {
    const id = requirePositional(rest, 'id')
    const patch = parseEdit(rest.slice(1))
    if (patch.bodyFile !== undefined) {
      patch.body = readBody(patch.bodyFile)
    }
    const entry = await store.edit(id, {
      title: patch.title,
      tags: patch.tags,
      clearTags: patch.clearTags,
      body: patch.body,
    })
    emitEntry(json, entry)
    return
  }
  if (sub === 'set-status') {
    const id = requirePositional(rest, 'id')
    const status = parseSetStatus(rest.slice(1))
    const entry = await store.setStatus(id, status)
    emitEntry(json, entry)
    return
  }
  usageKnowledge(`unknown knowledge subcommand: ${sub}`)
}

function parseCreate(args: string[]): {
  type: KnowledgeEntry['type']
  title: string
  bodyFile: string
  tags: string[]
  status: KnowledgeEntry['status']
} {
  let type: KnowledgeEntry['type'] | undefined
  let title: string | undefined
  let bodyFile: string | undefined
  let status: KnowledgeEntry['status'] = 'active'
  const tags: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--type') {
      type = requireEnum(args[++i], TYPES, 'type') as KnowledgeEntry['type']
      continue
    }
    if (a === '--title') {
      title = requireValue(args[++i], 'title')
      continue
    }
    if (a === '--body-file') {
      bodyFile = requireValue(args[++i], 'body-file')
      continue
    }
    if (a === '--tag') {
      tags.push(requireValue(args[++i], 'tag'))
      continue
    }
    if (a === '--status') {
      status = requireEnum(args[++i], STATUSES, 'status') as KnowledgeEntry['status']
      continue
    }
    if (a.startsWith('-')) {
      throw new KnowledgeCliError('usage_error', {
        exitCode: 2,
        detail: `unknown flag: ${a}`,
      })
    }
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `unexpected argument: ${a}`,
    })
  }
  if (!type || !title || !bodyFile) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: 'create requires --type --title --body-file',
    })
  }
  return { type, title, bodyFile, tags, status }
}

function parseSearch(args: string[]): {
  type?: KnowledgeEntry['type']
  status?: KnowledgeEntry['status']
  tags?: string[]
} {
  let type: KnowledgeEntry['type'] | undefined
  let status: KnowledgeEntry['status'] | undefined
  const tags: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--type') {
      type = requireEnum(args[++i], TYPES, 'type') as KnowledgeEntry['type']
      continue
    }
    if (a === '--status') {
      status = requireEnum(args[++i], STATUSES, 'status') as KnowledgeEntry['status']
      continue
    }
    if (a === '--tag') {
      tags.push(requireValue(args[++i], 'tag'))
      continue
    }
    if (a.startsWith('-')) {
      throw new KnowledgeCliError('usage_error', {
        exitCode: 2,
        detail: `unknown flag: ${a}`,
      })
    }
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `unexpected argument: ${a}`,
    })
  }
  return {
    type,
    status,
    tags: tags.length > 0 ? tags : undefined,
  }
}

function parseEdit(args: string[]): {
  title?: string
  tags?: string[]
  clearTags?: boolean
  bodyFile?: string
  body?: string
} {
  let title: string | undefined
  let bodyFile: string | undefined
  let clearTags = false
  const tags: string[] = []
  let sawTag = false
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--title') {
      title = requireValue(args[++i], 'title')
      continue
    }
    if (a === '--body-file') {
      bodyFile = requireValue(args[++i], 'body-file')
      continue
    }
    if (a === '--tag') {
      sawTag = true
      tags.push(requireValue(args[++i], 'tag'))
      continue
    }
    if (a === '--clear-tags') {
      clearTags = true
      continue
    }
    if (
      a === '--id' ||
      a === '--type' ||
      a === '--created' ||
      a === '--source' ||
      a === '--status'
    ) {
      throw new KnowledgeCliError('usage_error', {
        exitCode: 2,
        detail: `immutable or unsupported edit flag: ${a}`,
      })
    }
    if (a.startsWith('-')) {
      throw new KnowledgeCliError('usage_error', {
        exitCode: 2,
        detail: `unknown flag: ${a}`,
      })
    }
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `unexpected argument: ${a}`,
    })
  }
  if (clearTags && sawTag) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: '--clear-tags and --tag are mutually exclusive',
    })
  }
  if (title === undefined && !sawTag && !clearTags && bodyFile === undefined) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: 'edit requires at least one of --title|--tag|--clear-tags|--body-file',
    })
  }
  return {
    title,
    tags: sawTag ? tags : undefined,
    clearTags: clearTags || undefined,
    bodyFile,
  }
}

function parseSetStatus(args: string[]): KnowledgeEntry['status'] {
  let status: KnowledgeEntry['status'] | undefined
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--status') {
      status = requireEnum(args[++i], STATUSES, 'status') as KnowledgeEntry['status']
      continue
    }
    if (a.startsWith('-')) {
      throw new KnowledgeCliError('usage_error', {
        exitCode: 2,
        detail: `unknown flag: ${a}`,
      })
    }
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `unexpected argument: ${a}`,
    })
  }
  if (!status) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: 'set-status requires --status',
    })
  }
  return status
}

function readBody(bodyFile: string): string {
  try {
    if (bodyFile === '-') {
      return readFileSync(0, 'utf8')
    }
    return readFileSync(bodyFile, 'utf8')
  } catch (error) {
    throw new KnowledgeCliError('knowledge_input_read_failed', {
      detail: error instanceof Error ? error.message : 'body read failed',
    })
  }
}

function requirePositional(args: string[], name: string): string {
  const id = args[0]
  if (!id || id.startsWith('-')) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `missing ${name}`,
    })
  }
  return id
}

function rejectUnknownFlags(args: string[], allowed: string[]): void {
  for (const a of args) {
    if (a.startsWith('-') && !allowed.includes(a)) {
      throw new KnowledgeCliError('usage_error', {
        exitCode: 2,
        detail: `unknown flag: ${a}`,
      })
    }
  }
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined || value.startsWith('-')) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `missing value for --${name}`,
    })
  }
  return value
}

function requireEnum(value: string | undefined, allowed: Set<string>, name: string): string {
  const v = requireValue(value, name)
  if (!allowed.has(v)) {
    throw new KnowledgeCliError('usage_error', {
      exitCode: 2,
      detail: `invalid ${name}: ${v}`,
    })
  }
  return v
}

function toPayload(doc: KnowledgeDocument): { frontmatter: KnowledgeEntry; body: string } {
  return { frontmatter: doc.frontmatter, body: doc.body }
}

function emitEntry(json: boolean, entry: KnowledgeDocument): void {
  if (json) emitJson({ entry: toPayload(entry) })
  else process.stdout.write(`${entry.frontmatter.id}\t${entry.frontmatter.title}\n`)
  process.exitCode = 0
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function usageKnowledge(detail?: string): void {
  if (detail) {
    throw new KnowledgeCliError('usage_error', { exitCode: 2, detail })
  }
  process.stderr.write(
    'usage:\n' +
      '  rolekit knowledge create --type <rule|adr|learning|note> --title <t> --body-file <path|-> [--tag <t>]... [--status <status>] [--json]\n' +
      '  rolekit knowledge get <id> [--json]\n' +
      '  rolekit knowledge search [--type <type>] [--status <status>] [--tag <t>]... [--json]\n' +
      '  rolekit knowledge edit <id> [--title <t>] [--tag <t>]... [--clear-tags] [--body-file <path|->] [--json]\n' +
      '  rolekit knowledge set-status <id> --status <active|superseded|deprecated> [--json]\n',
  )
  process.exitCode = 2
}

/**
 * Emit knowledge CLI error JSON/text.
 */
export function emitKnowledgeError(error: KnowledgeCliError, json: boolean): void {
  const payload: Record<string, unknown> = { error: error.code }
  if (error.id) payload.id = error.id
  if (error.detail) payload.detail = error.detail
  if (error.issues) payload.issues = error.issues
  if (json) process.stdout.write(`${JSON.stringify(payload)}\n`)
  else {
    process.stderr.write(
      `${error.code}${error.id ? ` id=${error.id}` : ''}${error.detail ? `: ${error.detail}` : ''}\n`,
    )
  }
  process.exitCode = error.exitCode
}

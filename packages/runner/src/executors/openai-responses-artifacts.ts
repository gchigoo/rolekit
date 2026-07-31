/**
 * Research artifact builders — activity.json (D4) + report.md (D5).
 * Index encoding baseline: UTF-16 code units (JS string indexing), pending live spike confirm.
 */

export interface UrlCitationAnnotation {
  type: 'url_citation'
  start_index: number
  end_index: number
  url: string
  title: string
}

export interface ActivityToolCall {
  id: string
  type: string
  query?: string
  status: string
}

export interface ActivityJson {
  response_id: string | null
  model: string | null
  status: string | null
  tool_calls: ActivityToolCall[]
  annotations: UrlCitationAnnotation[]
  usage?: unknown
}

/**
 * Builds D4 activity.json (null scalars + empty arrays allowed for non-completed).
 */
export function buildActivityJson(input: {
  response_id?: string | null
  model?: string | null
  status?: string | null
  tool_calls?: ActivityToolCall[]
  annotations?: UrlCitationAnnotation[]
  usage?: unknown
}): ActivityJson {
  const activity: ActivityJson = {
    response_id: input.response_id ?? null,
    model: input.model ?? null,
    status: input.status ?? null,
    tool_calls: input.tool_calls ?? [],
    annotations: input.annotations ?? [],
  }
  if (input.usage !== undefined) {
    activity.usage = input.usage
  }
  return activity
}

/**
 * Injects [^n] footnotes from url_citation annotations and appends citation index (D5).
 * Same url+title reuses one number. Indices are UTF-16 code units.
 */
/**
 * Normalizes citation title; empty title falls back to URL hostname (Codex 常见).
 */
export function normalizeCitationTitle(title: string, url: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  try {
    return new URL(url).hostname || url
  } catch {
    return url || 'source'
  }
}

export function buildReportMarkdown(
  bodyText: string,
  annotations: UrlCitationAnnotation[],
): string {
  const sorted = [...annotations]
    .filter((a) => a.type === 'url_citation' && a.url)
    .map((a) => ({ ...a, title: normalizeCitationTitle(a.title, a.url) }))
    .sort((a, b) => b.end_index - a.end_index || b.start_index - a.start_index)

  const keyToNum = new Map<string, number>()
  const indexEntries: Array<{ n: number; title: string; url: string }> = []
  let next = 1
  let text = bodyText

  for (const ann of sorted) {
    const key = `${ann.url}\0${ann.title}`
    let n = keyToNum.get(key)
    if (n === undefined) {
      n = next
      next += 1
      keyToNum.set(key, n)
      indexEntries.push({ n, title: ann.title, url: ann.url })
    }
    const insertAt = Math.max(0, Math.min(ann.end_index, text.length))
    const marker = `[^${n}]`
    text = text.slice(0, insertAt) + marker + text.slice(insertAt)
  }

  indexEntries.sort((a, b) => a.n - b.n)
  const indexBlock = indexEntries.map((e) => `[^${e.n}]: [${e.title}](${e.url})`).join('\n')
  if (!indexBlock) {
    return text.trimEnd() + '\n'
  }
  return `${text.trimEnd()}\n\n${indexBlock}\n`
}

/**
 * Extracts tool_calls and annotations from a Responses API payload.
 */
export function extractFromResponse(response: unknown): {
  tool_calls: ActivityToolCall[]
  annotations: UrlCitationAnnotation[]
  text: string
  response_id: string | null
  model: string | null
  status: string | null
  usage: unknown
} {
  const root = asRecord(response)
  const output = Array.isArray(root.output) ? root.output : []
  const tool_calls: ActivityToolCall[] = []
  const annotations: UrlCitationAnnotation[] = []
  let text = ''

  for (const item of output) {
    const rec = asRecord(item)
    if (rec.type === 'web_search_call') {
      const action = asRecord(rec.action)
      let query = typeof action.query === 'string' ? action.query : undefined
      if (!query && Array.isArray(action.queries)) {
        const first = action.queries.find((q) => typeof q === 'string')
        if (typeof first === 'string') query = first
      }
      tool_calls.push({
        id: typeof rec.id === 'string' ? rec.id : `ws_${tool_calls.length}`,
        type: 'web_search_call',
        ...(query !== undefined ? { query } : {}),
        status: typeof rec.status === 'string' ? rec.status : 'unknown',
      })
    }
    if (rec.type === 'message') {
      const content = Array.isArray(rec.content) ? rec.content : []
      for (const part of content) {
        const p = asRecord(part)
        if (typeof p.text === 'string') {
          text = p.text
        }
        const anns = Array.isArray(p.annotations) ? p.annotations : []
        for (const raw of anns) {
          const a = asRecord(raw)
          if (a.type !== 'url_citation') continue
          const url = String(a.url ?? '')
          if (!url) continue
          annotations.push({
            type: 'url_citation',
            start_index: Number(a.start_index ?? 0),
            end_index: Number(a.end_index ?? 0),
            url,
            title: normalizeCitationTitle(String(a.title ?? ''), url),
          })
        }
      }
    }
  }

  if (!text && typeof root.output_text === 'string') {
    text = root.output_text
  }

  return {
    tool_calls,
    annotations,
    text,
    response_id: typeof root.id === 'string' ? root.id : null,
    model: typeof root.model === 'string' ? root.model : null,
    status: typeof root.status === 'string' ? root.status : null,
    usage: root.usage,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

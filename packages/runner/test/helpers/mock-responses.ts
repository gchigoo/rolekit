/**
 * MockResponses — injectable fetch double for OpenAiResponsesExecutor tests.
 */

export interface MockResponsesOptions {
  /** Status sequence returned by GET polls (last value sticks). */
  statusSequence?: string[]
  /** Final completed payload fields. */
  completed?: {
    text: string
    annotations?: Array<{
      type: 'url_citation'
      start_index: number
      end_index: number
      url: string
      title: string
    }>
    tool_calls?: Array<{ id: string; query?: string; status?: string }>
  }
  /** Fail create with HTTP status. */
  createStatus?: number
  /** Lose response on poll (404). */
  lostOnPoll?: boolean
}

export interface MockResponsesClient {
  fetch: typeof globalThis.fetch
  calls: Array<{ method: string; url: string; body?: unknown }>
  cancelCount: number
  advance(): void
}

/**
 * Builds a MockResponses fetch client with controllable status machine.
 */
export function createMockResponses(options: MockResponsesOptions = {}): MockResponsesClient {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  let cancelCount = 0
  let pollIndex = 0
  const sequence = options.statusSequence ?? ['queued', 'in_progress', 'completed']
  let responseId = 'resp_mock_1'
  let cancelled = false

  const client: MockResponsesClient = {
    calls,
    get cancelCount() {
      return cancelCount
    },
    advance() {
      pollIndex = Math.min(pollIndex + 1, sequence.length - 1)
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      let body: unknown
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      calls.push({ method, url, body })

      if (method === 'POST' && url.endsWith('/responses') && !url.endsWith('/cancel')) {
        if (options.createStatus && options.createStatus >= 400) {
          return jsonResponse({ error: 'create failed' }, options.createStatus)
        }
        responseId = 'resp_mock_1'
        return jsonResponse({
          id: responseId,
          model: 'gpt-5.6',
          status: sequence[0] ?? 'queued',
          output: [],
        })
      }

      if (method === 'POST' && url.includes('/cancel')) {
        cancelCount += 1
        cancelled = true
        return jsonResponse({
          id: responseId,
          model: 'gpt-5.6',
          status: 'cancelled',
          output: [],
        })
      }

      if (method === 'GET' && url.includes('/responses/')) {
        if (options.lostOnPoll) {
          return jsonResponse({ error: 'not found' }, 404)
        }
        const status = cancelled
          ? 'cancelled'
          : (sequence[Math.min(pollIndex, sequence.length - 1)] ?? 'completed')
        if (!cancelled && pollIndex < sequence.length - 1) {
          pollIndex += 1
        }
        if (status === 'completed') {
          return jsonResponse(buildCompleted(responseId, options))
        }
        if (status === 'failed' || status === 'incomplete') {
          return jsonResponse({
            id: responseId,
            model: 'gpt-5.6',
            status,
            output: toolOutput(options),
          })
        }
        return jsonResponse({
          id: responseId,
          model: 'gpt-5.6',
          status,
          output: toolOutput(options),
        })
      }

      return jsonResponse({ error: 'unhandled' }, 500)
    }) as typeof fetch,
  }

  return client
}

function buildCompleted(responseId: string, options: MockResponsesOptions): unknown {
  const text = options.completed?.text ?? 'Research findings about Node.js.'
  const annotations = options.completed?.annotations ?? [
    {
      type: 'url_citation' as const,
      start_index: 0,
      end_index: Math.min(16, text.length),
      url: 'https://nodejs.org/en/blog',
      title: 'Node.js Blog',
    },
  ]
  return {
    id: responseId,
    model: 'gpt-5.6',
    status: 'completed',
    usage: { input_tokens: 10, output_tokens: 20 },
    output: [
      ...toolOutput(options),
      {
        id: 'msg_1',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations,
          },
        ],
      },
    ],
  }
}

function toolOutput(options: MockResponsesOptions): unknown[] {
  const calls = options.completed?.tool_calls ?? [
    { id: 'ws_1', query: 'Node.js latest version', status: 'completed' },
  ]
  return calls.map((c) => ({
    type: 'web_search_call',
    id: c.id,
    status: c.status ?? 'completed',
    action: { type: 'search', query: c.query ?? 'query' },
  }))
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

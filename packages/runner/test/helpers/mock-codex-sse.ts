/**
 * Builds a mock fetch for chatgpt-codex SSE (Platform-shaped snapshots in events).
 */
export function createMockCodexSse(options: {
  completed?: {
    text: string
    annotations: Array<{
      type: 'url_citation'
      start_index: number
      end_index: number
      url: string
      title: string
    }>
    tool_calls?: Array<{ id: string; query?: string }>
  }
  mode?: 'completed' | 'fail-http' | 'slow-then-complete'
  onAbort?: () => void
}): typeof fetch {
  const mode = options.mode ?? 'completed'
  return async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(_input)
    if (url.includes('auth.openai.com')) {
      return new Response(
        JSON.stringify({
          access_token: makeJwt(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: 'rt-test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (!url.includes('chatgpt.com/backend-api/codex/responses')) {
      return new Response('not found', { status: 404 })
    }
    if (mode === 'fail-http') {
      return new Response('nope', { status: 500 })
    }

    const signal = init?.signal
    const completed = options.completed ?? {
      text: 'Hello world research.',
      annotations: [
        {
          type: 'url_citation' as const,
          start_index: 0,
          end_index: 5,
          url: 'https://example.com/',
          title: 'Example',
        },
      ],
      tool_calls: [{ id: 'ws_1', query: 'example' }],
    }

    const snapshot = {
      id: 'resp_test',
      model: 'gpt-5.6',
      status: 'completed',
      output: [
        ...(completed.tool_calls ?? []).map((t) => ({
          type: 'web_search_call',
          id: t.id,
          status: 'completed',
          action: { query: t.query ?? '' },
        })),
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: completed.text,
              annotations: completed.annotations,
            },
          ],
        },
      ],
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        const push = (obj: unknown) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
        }
        push({ type: 'response.created', response: { ...snapshot, status: 'queued', output: [] } })
        push({
          type: 'response.in_progress',
          response: {
            ...snapshot,
            status: 'in_progress',
            output: snapshot.output.filter((o) => o.type === 'web_search_call'),
          },
        })

        const finish = () => {
          if (signal?.aborted) {
            options.onAbort?.()
            controller.close()
            return
          }
          push({ type: 'response.completed', response: snapshot })
          controller.enqueue(enc.encode('data: [DONE]\n\n'))
          controller.close()
        }

        if (mode === 'slow-then-complete') {
          const t = setTimeout(finish, 200)
          signal?.addEventListener('abort', () => {
            clearTimeout(t)
            options.onAbort?.()
            try {
              controller.close()
            } catch {
              // ignore
            }
          })
          return
        }
        finish()
      },
    })

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
}

function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  return `${header}.${payload}.sig`
}

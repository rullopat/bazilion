import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

type MockHandler = unknown | ((req: IncomingMessage, res: ServerResponse) => void)

export interface MockLlm {
  url: string
  push(responses: MockHandler[]): void
  /** Persistent handler used when the queue is empty (instead of a 500). */
  setFallback(handler: MockHandler): void
  reset(): void
  callCount(): number
  stop(): Promise<void>
}

export interface CannedMessage {
  role?: string
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
}
interface CannedChoice {
  message: CannedMessage
  finish_reason?: string
}
export interface CannedResponse {
  choices: CannedChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

/**
 * Translate a canned non-streaming OpenAI-shaped response into OpenAI SSE
 * chunks and write them to `res`. Pi-ai's openai-completions client always
 * runs in `stream: true` mode, so LMStudio-style JSON bodies need to be
 * re-chunked into `data: {...}\n\n` lines terminated by `data: [DONE]`.
 */
export function sseFromCanned(res: ServerResponse, canned: CannedResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const choice = canned.choices[0]
  const message = choice?.message ?? {}
  const finish = choice?.finish_reason ?? 'stop'

  // Role delta (always first in OpenAI's SSE protocol).
  const roleChunk = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  }
  res.write(`data: ${JSON.stringify(roleChunk)}\n\n`)

  if (typeof message.content === 'string' && message.content.length > 0) {
    const textChunk = {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }],
    }
    res.write(`data: ${JSON.stringify(textChunk)}\n\n`)
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolChunk = {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: message.tool_calls.map((tc, i) => ({
              index: i,
              id: tc.id,
              type: tc.type,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          },
          finish_reason: null,
        },
      ],
    }
    res.write(`data: ${JSON.stringify(toolChunk)}\n\n`)
  }

  const finalChunk = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
    usage: canned.usage,
  }
  res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

/**
 * Start a node:http server that serves LMStudio-style /v1/chat/completions
 * responses from an in-memory queue. Push responses before each turn — the
 * server consumes them in order. Queue items may be objects (OpenAI-shaped
 * non-streaming responses, translated to SSE on the wire) or functions
 * `(req, res) => void` for custom behavior such as routing by request body
 * (e.g. inbox-wake vs operator turns) or a handler that never responds.
 */
export function startLmStudioMock(): Promise<MockLlm> {
  const queue: MockHandler[] = []
  let fallback: MockHandler = null
  let calls = 0
  const server = createServer((req, res) => {
    calls++
    const item = queue.length > 0 ? queue.shift() : fallback
    if (!item) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('mock response queue empty')
      return
    }
    if (typeof item === 'function') {
      ;(item as (req: IncomingMessage, res: ServerResponse) => void)(req, res)
      return
    }
    sseFromCanned(res, item as CannedResponse)
  })
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('unexpected server address')
      resolve({
        url: `http://localhost:${addr.port}/v1`,
        push(items) {
          queue.push(...items)
        },
        setFallback(handler) {
          fallback = handler
        },
        reset() {
          queue.length = 0
          fallback = null
          calls = 0
        },
        callCount: () => calls,
        stop: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

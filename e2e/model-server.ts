// A stand-in OpenAI-compatible model server for the browser tests and the website's pictures. It
// answers each chat turn from a script chosen by the last user message, one step per model call:
// a step's text is the reply, its tools are tool calls the Agent then runs. Nothing is sent to a
// real provider.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface ToolCall {
  name: string
  args: unknown
}

export interface Step {
  text?: string
  tools?: ToolCall[]
  /** Hold the reply back this long, so a turn stays in progress. */
  delay?: number
}

export interface Script {
  match: RegExp
  steps: () => Step[]
}

export interface ModelServer {
  /** The OpenAI-compatible base URL, ending in /v1. */
  url: string
  /** The model id it lists. */
  model: string
  close(): Promise<void>
}

const WAKE = [
  'Got it. Starting on this now; I will report back when it is ready for review.',
  'Understood. I have what I need and will deliver before the checkpoint.',
]

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
  return ''
}

/** The step a request asks for: the script of its last user message, at the step it reached. */
export function answer(
  scripts: readonly Script[],
  messages: readonly { role: string; content?: unknown }[],
  wakes = { count: 0 },
): Step {
  const lastUser = messages.findLastIndex((message) => message.role === 'user')
  const prompt = lastUser >= 0 ? textOf(messages[lastUser]?.content) : ''
  const step = messages.slice(lastUser + 1).filter((message) => message.role === 'assistant').length
  if (prompt.includes('[[bazilion:inbox-wake]]'))
    return step === 0 ? { text: WAKE[wakes.count++ % WAKE.length] } : { text: 'Noted.' }
  const script = scripts.find((entry) => entry.match.test(prompt))
  if (!script) return { text: 'Noted. Tell me what you would like me to do next.' }
  return script.steps()[step] ?? { text: 'Done.' }
}

export async function startModelServer(
  scripts: readonly Script[],
  { port = 0, model = 'paper-coder-32b' }: { port?: number; model?: string } = {},
): Promise<ModelServer> {
  const wakes = { count: 0 }
  const held = new Set<NodeJS.Timeout>()
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(request.url?.endsWith('/models') ? 200 : 404, {
          'content-type': 'application/json',
        })
        response.end(JSON.stringify({ data: [{ id: model }] }))
        return
      }
      const body = JSON.parse(raw) as { model: string; messages?: { role: string }[] }
      const reply = answer(scripts, body.messages ?? [], wakes)
      const chunk = (delta: unknown, finishReason: string | null = null) =>
        `data: ${JSON.stringify({ id: 'stand-in', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
      let out = chunk({ role: 'assistant', content: reply.text ?? '' })
      const tools = reply.tools ?? []
      tools.forEach((tool, index) => {
        out += chunk({
          tool_calls: [
            {
              index,
              id: `call_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'function',
              function: { name: tool.name, arguments: JSON.stringify(tool.args) },
            },
          ],
        })
      })
      out += chunk({}, tools.length > 0 ? 'tool_calls' : 'stop')
      out += `data: ${JSON.stringify({ id: 'stand-in', object: 'chat.completion.chunk', model: body.model, choices: [], usage: { prompt_tokens: 1200, completion_tokens: 180, total_tokens: 1380 } })}\n\n`
      const send = () => {
        if (response.destroyed) return
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(`${out}data: [DONE]\n\n`)
      }
      if (!reply.delay) return send()
      const timer = setTimeout(() => {
        held.delete(timer)
        send()
      }, reply.delay)
      held.add(timer)
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const { port: bound } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${bound}/v1`,
    model,
    close: () =>
      new Promise((resolve) => {
        for (const timer of held) clearTimeout(timer)
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

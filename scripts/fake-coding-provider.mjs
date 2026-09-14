// Deterministic fake provider for coding-progress acceptance (BAZ-041).
//
// Serves an OpenAI-compatible endpoint that can be pointed at with
// `LMSTUDIO_URL`, so live progress, retention and disclosure can be exercised
// end to end without a real model, API key or network egress.
//
// It scripts one fixed sequence instead of calling a model:
//   round 1 (last message is not a tool result) -> emit a `coding_command` call
//   round 2 (last message IS a tool result)     -> emit a short final answer
//
// Keying off the *last* message matters: pi replays earlier turns' tool results
// in the history, so "has any tool result ever" would skip the command on the
// second turn.
//
// Usage:
//   node scripts/fake-coding-provider.mjs [port] [command]
//   node scripts/fake-coding-provider.mjs 18080 'for i in $(seq 1 8); do echo "tick $i"; sleep 0.4; done'
//
// Defaults to port 18080 and a streaming bash command. Inside the Docker
// sandbox the image is debian:bookworm-slim, which has bash/coreutils but no
// node or pnpm — keep default commands to POSIX shell tools.
//
// Then, with a disposable daemon:
//   BAZILION_HOME=/tmp/baz041-home PORT=4399 \
//     LMSTUDIO_URL=http://127.0.0.1:18080/v1 \
//     BAZILION_BASH_SANDBOX=docker BAZILION_BASH_SANDBOX_IMAGE=debian:bookworm-slim \
//     pnpm tsx apps/cli/src/index.ts serve
//
// See docs/backlog/BAZ-041-acceptance.md for the full procedure.

import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 18080)
const command =
  process.argv[3] ?? 'for i in $(seq 1 8); do echo "tick $i"; sleep 0.4; done; echo "done"'

const MODEL = 'baz041-stub'

function chunk(delta, finishReason = null) {
  return {
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function toolCallMessage() {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_stub_1',
        type: 'function',
        function: {
          name: 'coding_command',
          arguments: JSON.stringify({ command, cwd: '.', purpose: 'test', timeoutSeconds: 60 }),
        },
      },
    ],
  }
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url?.startsWith('/v1/models')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }))
    return
  }
  if (request.method !== 'POST' || !request.url?.startsWith('/v1/chat/completions')) {
    response.writeHead(404)
    response.end()
    return
  }

  let body = ''
  request.on('data', (piece) => {
    body += piece
  })
  request.on('end', () => {
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {}
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const continuingTurn = messages[messages.length - 1]?.role === 'tool'

    if (parsed.stream === false) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'chatcmpl-stub',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [
            {
              index: 0,
              message: continuingTurn
                ? { role: 'assistant', content: 'The command finished; I inspected the output.' }
                : toolCallMessage(),
              finish_reason: continuingTurn ? 'stop' : 'tool_calls',
            },
          ],
        }),
      )
      return
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (frame) => response.write(`data: ${JSON.stringify(frame)}\n\n`)

    if (!continuingTurn) {
      send(chunk({ role: 'assistant', content: 'Running the test.' }))
      send(
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_stub_1',
              type: 'function',
              function: { name: 'coding_command', arguments: '' },
            },
          ],
        }),
      )
      // Split across chunks: clients must accumulate argument deltas.
      const args = JSON.stringify({ command, cwd: '.', purpose: 'test', timeoutSeconds: 60 })
      for (const piece of [args.slice(0, 20), args.slice(20)]) {
        send(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }))
      }
      send(chunk({}, 'tool_calls'))
    } else {
      for (const token of ['The ', 'command ', 'finished; ', 'I inspected ', 'the output.']) {
        send(chunk({ content: token }))
      }
      send(chunk({}, 'stop'))
    }
    response.end('data: [DONE]\n\n')
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`fake coding provider on http://127.0.0.1:${port}/v1 (model ${MODEL})`)
  console.log(`coding_command: ${command}`)
})

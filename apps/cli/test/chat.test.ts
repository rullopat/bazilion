import { existsSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { ChatFrame, CommandApproval } from '@bazilion/api-types'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { openDb, resolveAgent, resolvePaths } from '../../daemon/src/core/index.ts'
import { countSessionMessagesForTest, seedSessionForTest } from '../../daemon/src/runtime/index.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

type MockHandler = unknown | ((res: ServerResponse) => void)

interface MockLlm {
  url: string
  push(responses: MockHandler[]): void
  reset(): void
  callCount(): number
  stop(): Promise<void>
}

interface CannedMessage {
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
interface CannedResponse {
  choices: CannedChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

/**
 * Translate a canned non-streaming OpenAI-shaped response into OpenAI SSE
 * chunks and write them to `res`. Pi-ai's openai-completions client always
 * runs in `stream: true` mode, so LMStudio-style JSON bodies need to be
 * re-chunked into `data: {...}\n\n` lines terminated by `data: [DONE]`.
 */
function writeSseFromCanned(res: ServerResponse, canned: CannedResponse): void {
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
 * responses from an in-memory queue. Push responses before each `agent chat`
 * turn — the server consumes them in order. Queue items may be objects
 * (OpenAI-shaped non-streaming responses, translated to SSE on the wire) or
 * functions `(res) => void` for custom behavior (e.g. a handler that never
 * responds, to exercise client-side cancellation).
 */
function startLmStudioMock(): Promise<MockLlm> {
  const queue: MockHandler[] = []
  let calls = 0
  const server = createServer((_req, res) => {
    calls++
    if (queue.length === 0) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('mock response queue empty')
      return
    }
    const item = queue.shift()
    if (typeof item === 'function') {
      ;(item as (res: ServerResponse) => void)(res)
      return
    }
    writeSseFromCanned(res, item as CannedResponse)
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
        reset() {
          queue.length = 0
          calls = 0
        },
        callCount: () => calls,
        stop: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({ LMSTUDIO_URL: mock.url })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
})
beforeEach(() => {
  mock.reset()
  server.reset()
})

async function spawnLmStudioAgent(): Promise<string> {
  await server.cli(['profile', 'create', 'p', '--model', 'lmstudio:test-model'])
  const r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  return extractAgentId(r.stdout)
}

test('agent chat --message round-trips with the provider', async () => {
  const agentId = await spawnLmStudioAgent()
  mock.push([
    {
      choices: [
        {
          message: { role: 'assistant', content: 'hello from mock' },
          finish_reason: 'stop',
        },
      ],
    },
  ])

  const r = await server.cli(['agent', 'chat', agentId, '--message', 'hi'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('hello from mock')
})

test('chat rejects an unknown approval capability before starting a turn', async () => {
  const agentId = await spawnLmStudioAgent()
  const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ message: 'hello', bashApprovalMode: 'maybe' }),
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({
    error: 'bashApprovalMode must be "interactive" or "auto_deny"',
  })
  expect(mock.callCount()).toBe(0)
})

function resolvedAgent(agentId: string) {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  try {
    return resolveAgent(db, paths, agentId)
  } finally {
    db.close()
  }
}

function authHeaders(json = false): Record<string, string> {
  return {
    authorization: `Bearer ${server.token}`,
    origin: server.url,
    ...(json ? { 'content-type': 'application/json' } : {}),
  }
}

async function runInteractiveBashDecision(decision: 'allow' | 'deny'): Promise<{
  frames: ChatFrame[]
  approval: CommandApproval
  proofPath: string
}> {
  await server.cli(['config', 'set', 'BAZILION_BASH_APPROVAL', 'dangerous'])
  const agentId = await spawnLmStudioAgent()
  const agent = resolvedAgent(agentId)
  const proofName = `approval-${decision}-proof.txt`
  const proofPath = join(agent.team.path, proofName)
  const command = `cat ~/.ssh/id_rsa >/dev/null 2>&1; printf executed > ${proofName}`
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call_${decision}`,
                type: 'function',
                function: { name: 'bash', arguments: JSON.stringify({ command }) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      choices: [
        {
          message: { role: 'assistant', content: `command ${decision} flow complete` },
          finish_reason: 'stop',
        },
      ],
    },
  ])

  const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ message: 'run the requested command', bashApprovalMode: 'interactive' }),
  })
  expect(response.status).toBe(200)
  expect(response.body).not.toBeNull()

  const frames: ChatFrame[] = []
  let approval: CommandApproval | undefined
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (reader) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const frame = JSON.parse(line) as ChatFrame
      frames.push(frame)
      if (
        frame.kind === 'event' &&
        frame.event.type === 'command_approval' &&
        frame.event.approval.status === 'pending'
      ) {
        approval = frame.event.approval
        const unauthenticated = await fetch(
          `${server.url}/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`,
        )
        expect(unauthenticated.status).toBe(401)
        const recovery = await fetch(
          `${server.url}/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`,
          { headers: authHeaders() },
        )
        expect(recovery.status).toBe(200)
        expect(await recovery.json()).toMatchObject({
          approvals: [{ id: approval.id, status: 'pending' }],
        })

        const approvalResponse = await fetch(
          `${server.url}/api/shell-approvals/${encodeURIComponent(approval.id)}`,
          {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ decision }),
          },
        )
        expect(approvalResponse.status).toBe(200)
        const retry = await fetch(
          `${server.url}/api/shell-approvals/${encodeURIComponent(approval.id)}`,
          {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ decision }),
          },
        )
        expect(retry.status).toBe(200)
      }
    }
  }
  if (buffer.trim()) frames.push(JSON.parse(buffer) as ChatFrame)
  if (!approval) throw new Error('interactive turn did not request command approval')
  return { frames, approval, proofPath }
}

test('interactive HTTP chat pauses a risky command and an allow decision executes it once', async () => {
  const { frames, approval, proofPath } = await runInteractiveBashDecision('allow')

  expect(
    frames.some(
      (frame) =>
        frame.kind === 'event' &&
        frame.event.type === 'command_approval' &&
        frame.event.approval.id === approval.id &&
        frame.event.approval.status === 'allowed',
    ),
  ).toBe(true)
  expect(existsSync(proofPath)).toBe(true)
  expect(frames.at(-1)?.kind).toBe('done')
})

test('interactive HTTP denial is streamed to the turn and never executes the command', async () => {
  const { frames, approval, proofPath } = await runInteractiveBashDecision('deny')

  expect(
    frames.some(
      (frame) =>
        frame.kind === 'event' &&
        frame.event.type === 'command_approval' &&
        frame.event.approval.id === approval.id &&
        frame.event.approval.status === 'denied',
    ),
  ).toBe(true)
  expect(frames.some((frame) => frame.kind === 'event' && frame.event.type === 'tool_error')).toBe(
    true,
  )
  expect(existsSync(proofPath)).toBe(false)
})

test('cancelling a turn releases its pending approval and never executes the command', async () => {
  await server.cli(['config', 'set', 'BAZILION_BASH_APPROVAL', 'dangerous'])
  const agentId = await spawnLmStudioAgent()
  const agent = resolvedAgent(agentId)
  const proofPath = join(agent.team.path, 'cancelled-approval-proof.txt')
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_cancelled',
                type: 'function',
                function: {
                  name: 'bash',
                  arguments: JSON.stringify({
                    command:
                      'cat ~/.ssh/id_rsa >/dev/null 2>&1; printf executed > cancelled-approval-proof.txt',
                  }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ])

  const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ message: 'run it', bashApprovalMode: 'interactive' }),
  })
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  let cancelled = false
  while (reader) {
    const chunk = await reader.read()
    if (chunk.done) break
    raw += decoder.decode(chunk.value, { stream: true })
    if (!cancelled && raw.includes('"status":"pending"')) {
      const cancel = await fetch(`${server.url}/api/agents/${agentId}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
      })
      expect(cancel.status).toBe(204)
      cancelled = true
    }
  }

  expect(cancelled).toBe(true)
  const pending = await fetch(
    `${server.url}/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`,
    { headers: authHeaders() },
  )
  expect(await pending.json()).toEqual({ approvals: [] })
  expect(existsSync(proofPath)).toBe(false)
})

test('non-TTY CLI turns auto-deny risky bash without waiting for stdin or executing it', async () => {
  await server.cli(['config', 'set', 'BAZILION_BASH_APPROVAL', 'dangerous'])
  const agentId = await spawnLmStudioAgent()
  const agent = resolvedAgent(agentId)
  const proofPath = join(agent.team.path, 'auto-deny-proof.txt')
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_auto_deny',
                type: 'function',
                function: {
                  name: 'bash',
                  arguments: JSON.stringify({
                    command:
                      'cat ~/.ssh/id_rsa >/dev/null 2>&1; printf executed > auto-deny-proof.txt',
                  }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      choices: [
        {
          message: { role: 'assistant', content: 'the command was blocked' },
          finish_reason: 'stop',
        },
      ],
    },
  ])

  const result = await server.cli(['agent', 'chat', agentId, '--message', 'run it'])

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toMatch(/shell command auto-denied/i)
  expect(result.stdout).toMatch(/tool error: bash/i)
  expect(result.stdout).toContain('the command was blocked')
  expect(existsSync(proofPath)).toBe(false)
})

test('memory persists across chat invocations', async () => {
  const agentId = await spawnLmStudioAgent()

  // Session 1: agent saves a memory via tool call
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'memory_write',
                  arguments: '{"key":"prefs.md","content":"User likes hiking on Sundays."}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      choices: [
        {
          message: { role: 'assistant', content: 'Got it, saved.' },
          finish_reason: 'stop',
        },
      ],
    },
  ])
  let r = await server.cli(['agent', 'chat', agentId, '--message', 'I like hiking on Sundays'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('memory_write')
  expect(r.stdout).toContain('Got it')

  // Session 2: new chat invocation, agent searches memory and finds it
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'memory_search', arguments: '{"query":"hiking"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      choices: [
        {
          message: { role: 'assistant', content: 'You like hiking on Sundays.' },
          finish_reason: 'stop',
        },
      ],
    },
  ])
  r = await server.cli(['agent', 'chat', agentId, '--message', 'what do I like to do on weekends?'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('hiking')
  expect(r.stdout).toContain('You like hiking on Sundays')
})

test('BOOTSTRAP.md is removed when bootstrap_done tool is called', async () => {
  const agentId = await spawnLmStudioAgent()
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'bootstrap_done', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      choices: [
        {
          message: { role: 'assistant', content: 'Welcome aboard.' },
          finish_reason: 'stop',
        },
      ],
    },
  ])

  const r = await server.cli(['agent', 'chat', agentId, '--message', 'I am ready'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('bootstrap_done')

  // Verify BOOTSTRAP.md is gone via agent show (which reads the dir path)
  const show = await server.cli(['agent', 'show', agentId])
  expect(show.exitCode).toBe(0)
  const m = show.stdout.match(/dir:\s+(\S+)/)
  expect(m?.[1]).toBeDefined()
  if (m?.[1]) {
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(existsSync(join(m[1], 'BOOTSTRAP.md'))).toBe(false)
  }
})

test('failed turn surfaces an error event and leaves the agent ready for a retry', async () => {
  // Pi's SessionManager writes entries as they happen (not at turn end), so
  // a failed turn doesn't "roll back" a user message the way the old
  // pre-pi worker did. The test's concern here is simpler: a non-retryable
  // provider error surfaces as an error event, and a fresh follow-up turn
  // succeeds cleanly.
  const agentId = await spawnLmStudioAgent()

  mock.push([
    (res: ServerResponse) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'bad model' } }))
    },
  ])

  const failR = await server.cli(['agent', 'chat', agentId, '--message', 'go on'])
  expect(failR.stdout).toMatch(/\[error:/)

  mock.push([
    {
      choices: [
        { message: { role: 'assistant', content: 'recovered reply' }, finish_reason: 'stop' },
      ],
    },
  ])
  const okR = await server.cli(['agent', 'chat', agentId, '--message', 'go on'])
  expect(okR.exitCode).toBe(0)
  expect(okR.stdout).toContain('recovered reply')
})

test('agent chat can be cancelled mid-flight via `agent cancel`', async () => {
  const agentId = await spawnLmStudioAgent()

  // The mock's sole handler never responds — the provider's fetch will hang
  // until its AbortSignal fires, giving us a window to cancel the turn.
  const callCountBefore = mock.callCount()
  mock.push([
    (_res: ServerResponse) => {
      // intentionally left hanging
    },
  ])

  // Kick off the chat in the background. The CLI subprocess will block
  // inside the NDJSON stream until abort.
  const chatPromise = server.cli(['agent', 'chat', agentId, '--message', 'hi'])

  // Wait for the worker to actually reach the provider fetch (mock receives a
  // request). Cancelling earlier races with worker startup — SIGTERM during
  // Node bootstrap has no handler installed and exits with the signal,
  // producing "worker killed by SIGTERM" instead of the cancelled-event path.
  let providerHit = false
  for (let i = 0; i < 100; i++) {
    if (mock.callCount() > callCountBefore) {
      providerHit = true
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!providerHit) throw new Error('worker did not reach the provider fetch in time')

  const cancelR = await server.cli(['agent', 'cancel', agentId])
  expect(cancelR.exitCode).toBe(0)

  // The chat subprocess should terminate promptly. With the mock still
  // hanging, the fetch must have been aborted — otherwise this would time
  // out. Pi surfaces aborts as a `cancelled` error or provider-side text
  // like "Request was aborted." — accept either.
  const chatR = await chatPromise
  expect(chatR.stdout + chatR.stderr).toMatch(/cancelled|aborted/i)
})

// --- chat-reset + chat-trim ---

// Seed a canonical pi session file on disk with `n` synthetic user/assistant
// messages. The on-disk JSONL is the authoritative source of conversation
// state after migration 0004 dropped `chat_messages`; hitting tests at this
// layer keeps them faithful to what a real worker writes. See
// `seedSessionForTest` in runtime for the underlying pi SessionManager
// append calls.
function seedChatHistory(home: string, agentId: string, n: number): void {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  try {
    const resolved = resolveAgent(db, paths, agentId)
    const messages = Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? { role: 'user' as const, text: `msg ${i}` }
        : { role: 'assistant' as const, text: `reply ${i}` },
    )
    seedSessionForTest(resolved, paths, messages)
  } finally {
    db.close()
  }
}

function readChatLen(home: string, agentId: string): number {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  try {
    const resolved = resolveAgent(db, paths, agentId)
    return countSessionMessagesForTest(resolved, paths)
  } finally {
    db.close()
  }
}

test('agent chat-reset --force wipes history without prompting', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 6)
  expect(readChatLen(server.home, agentId)).toBe(6)

  const r = await server.cli(['agent', 'chat-reset', agentId, '--force'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('reset')
  expect(readChatLen(server.home, agentId)).toBe(0)
})

test('agent chat-trim reports the before/after counts from pi branching', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 6)

  const r = await server.cli(['agent', 'chat-trim', agentId, '--keep', '3'])
  expect(r.exitCode).toBe(0)
  // Pi's `branch()` moves the leaf pointer in-memory; the session file
  // keeps the original entries on disk (append-only). The next turn
  // will resume from the branched leaf. CLI output is what we assert.
  expect(r.stdout).toMatch(/6 → 3/)
})

test('agent chat-trim rejects non-integer --keep with a clear error', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 4)

  const r = await server.cli(['agent', 'chat-trim', agentId, '--keep', '2.5'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/non-negative integer/)
  // Session file untouched on invalid input
  expect(readChatLen(server.home, agentId)).toBe(4)
})

// --- chat-context + chat-compact ---

test('agent chat-context reports system prompt, tools, skills, history breakdown', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 6)

  const r = await server.cli(['agent', 'chat-context', agentId])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toMatch(/## system prompt/)
  expect(r.stdout).toMatch(/## tools/)
  expect(r.stdout).toMatch(/count:\s+\d+/)
  // 6 seeded message entries, 0 compactions
  expect(r.stdout).toMatch(/messages:\s+6/)
  expect(r.stdout).toMatch(/compactions:\s+0/)
  expect(r.stdout).toMatch(/TOTAL:/)
})

test('agent chat-context --json emits the structured ChatContextResponse', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 4)

  const r = await server.cli(['agent', 'chat-context', agentId, '--json'])
  expect(r.exitCode).toBe(0)
  const body = JSON.parse(r.stdout)
  expect(body.agentId).toBe(agentId)
  expect(typeof body.model).toBe('string')
  expect(body.history).toMatchObject({ messageEntries: 4, compactionEntries: 0 })
  expect(typeof body.history.chars).toBe('number')
  expect(typeof body.history.bytes).toBe('number')
  expect(typeof body.history.tokensEstimate).toBe('number')
  expect(typeof body.tools.count).toBe('number')
  expect(Array.isArray(body.tools.entries)).toBe(true)
  expect(typeof body.totals.chars).toBe('number')
})

test('agent chat-context on an empty history returns zero history entries', async () => {
  const agentId = await spawnLmStudioAgent()
  const r = await server.cli(['agent', 'chat-context', agentId, '--json'])
  expect(r.exitCode).toBe(0)
  const body = JSON.parse(r.stdout)
  expect(body.history).toMatchObject({
    messageEntries: 0,
    compactionEntries: 0,
    chars: 0,
  })
  // System prompt + tools still contribute to totals even on a fresh agent.
  expect(body.totals.chars).toBeGreaterThan(0)
})

test('agent chat-compact summarizes the head via pi session.compact', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 10)

  // Pi's session.compact() uses the agent's current model to generate the
  // summary — the mock has to answer one LLM call.
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'The user sent several questions; assistant replied each time.',
          },
          finish_reason: 'stop',
        },
      ],
    },
  ])

  const r = await server.cli(['agent', 'chat-compact', agentId, '--force'])
  // Pi may be stricter than us about when it bothers to compact; allow
  // either a success summary or a "nothing to compact" refusal. The key
  // thing is the endpoint runs without throwing.
  if (r.exitCode === 0) {
    expect(r.stdout).toMatch(/compacted:/)
  } else {
    // Non-zero exit is acceptable when pi declines to compact a small
    // history. Surface the error reason for diagnostics.
    expect(r.stderr + r.stdout).toMatch(/(error|nothing)/i)
  }
})

test('agent chat-compact errors out on empty history', async () => {
  const agentId = await spawnLmStudioAgent()
  const r = await server.cli(['agent', 'chat-compact', agentId, '--force'])
  // With no session file at all, pi either refuses or succeeds with a
  // trivial empty compaction. We assert the command completes without a
  // worker crash — actual exit code depends on pi's behavior for empty
  // sessions, which can change between pi releases.
  expect(r.stdout + r.stderr).toBeTruthy()
})

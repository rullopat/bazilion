import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatFrame, CommandApproval } from '@bazilion/api-types'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { openDb, resolveAgent, resolvePaths } from '../../daemon/src/core/index.ts'
import {
  resolveConversationTarget,
  selectedConversationTarget,
} from '../../daemon/src/lib/conversation-target.ts'
import {
  countSessionMessages,
  seedSessionMessages,
} from '../../daemon/test/fixtures/conversation.ts'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    LMSTUDIO_API_KEY: 'synthetic-lmstudio-fixture-key',
  })
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

test('provider test sends one request to an enabled provider and refuses a disabled one', async () => {
  await spawnLmStudioAgent()
  mock.push([
    { choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }] },
  ])
  const r = await server.cli(['provider', 'test', 'lmstudio:test-model', '--message', 'ping'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('<- pong')
  expect(mock.callCount()).toBe(1)

  const disabled = await server.cli(['provider', 'test', 'groq:llama-3.1-8b-instant'])
  expect(disabled.exitCode).not.toBe(0)
  expect(disabled.stderr + disabled.stdout).toMatch(/groq provider is disabled/)
  expect(mock.callCount()).toBe(1)
})

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

test('piped agent chat runs one turn per input line and exits cleanly', async () => {
  const agentId = await spawnLmStudioAgent()
  mock.push([
    {
      choices: [{ message: { role: 'assistant', content: 'first reply' }, finish_reason: 'stop' }],
    },
    {
      choices: [{ message: { role: 'assistant', content: 'second reply' }, finish_reason: 'stop' }],
    },
  ])
  // Spawned by hand because runCli cannot write to stdin.
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  const child = spawn(process.execPath, ['--no-warnings', entry, 'agent', 'chat', agentId], {
    // Not the checkout: the CLI saves delivered files into its working directory.
    cwd: server.home,
    env: {
      ...process.env,
      BAZILION_HOME: server.home,
      BAZILION_SERVER: server.url,
      BAZILION_TOKEN: server.token,
    },
    timeout: 30_000,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  // The input ends while the first turn runs; the second line must still become a turn.
  child.stdin.end('first\nsecond\n')
  const exitCode = await new Promise((resolve) => child.on('close', resolve))
  expect(exitCode, stderr).toBe(0)
  expect(stdout).toContain('first reply')
  expect(stdout).toContain('second reply')
  expect(mock.callCount()).toBe(2)
})

test('large Unicode completion survives real worker exit and releases the next turn', async () => {
  const agentId = await spawnLmStudioAgent()
  const message = '日本語🌍'.repeat(40_000)
  for (const prompt of [message, 'follow-up after large completion']) {
    mock.push([
      { choices: [{ message: { role: 'assistant', content: 'complete' }, finish_reason: 'stop' }] },
    ])
    const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ message: prompt }),
      signal: AbortSignal.timeout(30_000),
    })
    expect(response.status).toBe(200)
    const frames = (await response.text())
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ChatFrame)
    expect(frames.filter((frame) => frame.kind === 'fatal')).toEqual([])
    const done = frames.find((frame) => frame.kind === 'done')
    expect(done?.kind).toBe('done')
    if (done?.kind !== 'done') throw new Error('missing terminal completion')
    expect(done.messages.some((m) => m.role === 'user' && m.content === message)).toBe(true)
    expect(done.messages.at(-1)?.content).toBe('complete')
  }
  expect(mock.callCount()).toBe(2)
}, 90_000)

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

function riskyFixtureCommand(agent: ReturnType<typeof resolvedAgent>, effect: string): string {
  // Exercise a real credential-shaped read, but never an operator's ~/.ssh or other credentials.
  const target = join(agent.agent.dir, '.env')
  writeFileSync(target, 'SYNTHETIC_NON_PERSONAL_APPROVAL_FIXTURE\n')
  const quoted = `'${target.replaceAll("'", `'"'"'`)}'`
  return `cat ${quoted} >/dev/null 2>&1; ${effect}`
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
  const command = riskyFixtureCommand(agent, `printf executed > ${proofName}`)
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
    body: JSON.stringify({
      message: 'run the requested command',
      bashApprovalMode: 'interactive',
    }),
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
        // A second answer finds nothing pending.
        const retry = await fetch(
          `${server.url}/api/shell-approvals/${encodeURIComponent(approval.id)}`,
          {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ decision }),
          },
        )
        expect(retry.status).toBe(404)
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

test('a web chat question waits for an answer from the CLI and the model receives it', async () => {
  const agentId = await spawnLmStudioAgent()
  const question = { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] }
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_ask',
                type: 'function',
                function: { name: 'ask_user', arguments: JSON.stringify(question) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    {
      choices: [{ message: { role: 'assistant', content: 'using JSON' }, finish_reason: 'stop' }],
    },
  ])
  const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      message: 'ask me first',
      questionMode: 'web',
    }),
  })
  expect(response.status).toBe(200)
  const frames: ChatFrame[] = []
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (reader) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines.filter((value) => value.trim())) {
      const frame = JSON.parse(line) as ChatFrame
      frames.push(frame)
      if (frame.kind !== 'event' || frame.event.type !== 'agent_question') continue
      const id = frame.event.question.id
      const listed = await server.cli(['question', 'list', agentId, '--json'])
      expect(JSON.parse(listed.stdout)).toMatchObject([{ id, question }])
      const answered = await server.cli(['question', 'answer', agentId, id, '--choice', '2'])
      expect(answered.stdout).toContain('Answered.')
      expect((await server.cli(['question', 'answer', agentId, id, '--skip'])).exitCode).not.toBe(0)
    }
  }
  const result = frames.find(
    (frame) =>
      frame.kind === 'event' &&
      frame.event.type === 'tool_result' &&
      frame.event.name === 'ask_user',
  )
  expect(
    result?.kind === 'event' && result.event.type === 'tool_result' && result.event.result,
  ).toContain('"answer":{"kind":"choice","index":1}')
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
                    command: riskyFixtureCommand(
                      agent,
                      'printf executed > cancelled-approval-proof.txt',
                    ),
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
    body: JSON.stringify({
      message: 'run it',
      bashApprovalMode: 'interactive',
    }),
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
      expect(cancel.status).toBe(200)
      expect(await cancel.json()).toEqual({ cancelled: true, queuePaused: false })
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
                    command: riskyFixtureCommand(agent, 'printf executed > auto-deny-proof.txt'),
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
    (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'bad model' } }))
    },
  ])

  const failR = await server.cli(['agent', 'chat', agentId, '--message', 'go on'])
  expect(failR.stdout).toMatch(/\[error:/)
  expect(failR.exitCode).toBe(1)

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
    () => {
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
  expect(chatR.exitCode).not.toBe(0)
})

// --- chat-reset + chat-trim ---

// Seed a canonical pi session file on disk with `n` synthetic user/assistant
// messages. The on-disk JSONL is the authoritative source of conversation
// state; hitting tests at this layer keeps them faithful to what a real worker
// writes. See `seedSessionMessages` in the daemon conversation fixture.
function seedChatHistory(home: string, agentId: string, n: number, padding = ''): void {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  try {
    const resolved = resolveAgent(db, paths, agentId)
    const messages = Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? { role: 'user' as const, text: `msg ${i}${padding}` }
        : { role: 'assistant' as const, text: `reply ${i}${padding}` },
    )
    seedSessionMessages(resolved, paths, messages, resolveConversationTarget(db, paths, agentId))
  } finally {
    db.close()
  }
}

function readChatLen(home: string, agentId: string): number {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  try {
    const resolved = resolveAgent(db, paths, agentId)
    return countSessionMessages(resolved, paths, selectedConversationTarget(db, agentId))
  } finally {
    db.close()
  }
}

test('New conversation retains prior history while starting empty', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 6)
  expect(readChatLen(server.home, agentId)).toBe(6)

  const old = JSON.parse(
    (await server.cli(['conversation', 'list', agentId, '--json'])).stdout,
  ).selectedId
  const r = await server.cli(['conversation', 'new', agentId])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('Conversation')
  const retained = await server.cli(['conversation', 'show', agentId, old, '--json'])
  expect(JSON.parse(retained.stdout).messages).toHaveLength(6)
  expect(readChatLen(server.home, agentId)).toBe(0)
})

test('agent chat-trim keeps the first N messages for the next turn', async () => {
  const agentId = await spawnLmStudioAgent()
  seedChatHistory(server.home, agentId, 6)

  const r = await server.cli(['agent', 'chat-trim', agentId, '--keep', '3'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toMatch(/6 → 3/)
  // The file keeps every entry (append-only); what the next turn reads is the trimmed branch.
  expect(readChatLen(server.home, agentId)).toBe(3)

  mock.push([
    { choices: [{ message: { role: 'assistant', content: 'after trim' }, finish_reason: 'stop' }] },
  ])
  const turn = await server.cli(['agent', 'chat', agentId, '--message', 'again'])
  expect(turn.exitCode).toBe(0)
  expect(readChatLen(server.home, agentId)).toBe(5)

  const cleared = await server.cli(['agent', 'chat-trim', agentId, '--keep', '0'])
  expect(cleared.stdout).toMatch(/5 → 0/)
  expect(readChatLen(server.home, agentId)).toBe(0)
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
  seedChatHistory(server.home, agentId, 0)
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

test('agent chat-compact summarizes the old head and keeps the recent tail', async () => {
  const agentId = await spawnLmStudioAgent()
  // A short history fits in what compaction keeps verbatim: nothing to summarize, no model call.
  seedChatHistory(server.home, agentId, 4)
  const small = await server.cli(['agent', 'chat-compact', agentId, '--force'])
  expect(small.exitCode).toBe(1)
  expect(small.stderr).toContain('Nothing to compact')
  expect(mock.callCount()).toBe(0)

  // About 40k tokens of history: the oldest part becomes one summary from the Agent's model.
  seedChatHistory(server.home, agentId, 16, 'x'.repeat(10_000))
  mock.setFallback({
    choices: [{ message: { role: 'assistant', content: 'SUMMARY OF EARLIER TURNS' } }],
  })
  const r = await server.cli(['agent', 'chat-compact', agentId, '--force'])
  expect(r.exitCode, r.stderr).toBe(0)
  expect(r.stdout).toMatch(/compacted: \d+ → \d+ entries/)
  expect(r.stdout).toContain('SUMMARY OF EARLIER TURNS')
  expect(mock.callCount()).toBeGreaterThan(0)
})

test('agent chat-compact refuses an Agent with no conversation yet', async () => {
  const agentId = await spawnLmStudioAgent()
  const r = await server.cli(['agent', 'chat-compact', agentId, '--force'])
  expect(r.exitCode).toBe(3)
  expect(r.stderr).toContain('error: Start a conversation before using this action.')
})

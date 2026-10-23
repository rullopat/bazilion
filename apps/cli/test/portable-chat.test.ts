import { writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, sseFromCanned, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// Runs on actual Linux and macOS. No mocked process.platform and no real provider credentials.
let server: TestServer
let provider: MockLlm
let agentId: string
beforeAll(async () => {
  provider = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: provider.url,
    BAZILION_BASH_SANDBOX: 'off',
    BAZILION_SCHEDULER: 'off',
    BROWSER_ENABLED: 'false',
  })
  const profile = await server.cli([
    'profile',
    'create',
    'portable',
    '--model',
    'lmstudio:test-model',
  ])
  expect(profile.exitCode).toBe(0)
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'portable'])
  expect(spawned.exitCode).toBe(0)
  agentId = extractAgentId(spawned.stdout)
})
afterAll(async () => {
  await server?.stop()
  await provider?.stop()
})

function answer(text: string, marker?: string): void {
  provider.push([
    async (request: IncomingMessage, response: ServerResponse) => {
      const body: Buffer[] = []
      for await (const chunk of request) body.push(Buffer.from(chunk))
      const payload = Buffer.concat(body).toString()
      if (marker && !payload.includes(marker)) {
        response.writeHead(400).end('repository instructions were not supplied')
        return
      }
      sseFromCanned(response, {
        choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      })
    },
  ])
}

async function apiTurn(message: string): Promise<ChatFrame[]> {
  const auth = { authorization: `Bearer ${server.token}` }
  const selected = (await fetch(`${server.url}/api/agents/${agentId}/conversations`, {
    headers: auth,
  }).then((r) => r.json())) as { selection: unknown }
  const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { ...auth, origin: server.url, 'content-type': 'application/json' },
    body: JSON.stringify({ message, expectedSelection: selected.selection }),
    signal: AbortSignal.timeout(20_000),
  })
  expect(response.status).toBe(200)
  return (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ChatFrame)
}

function complete(frames: ChatFrame[], text: string): void {
  expect(frames.filter((frame) => frame.kind === 'fatal')).toEqual([])
  expect(frames.some((frame) => frame.kind === 'done')).toBe(true)
  expect(JSON.stringify(frames)).toContain(text)
  expect(JSON.stringify(frames)).not.toContain('safe_reads_unavailable')
  expect(JSON.stringify(frames)).not.toContain('cleanup unconfirmed')
}

test('empty Team completes CLI chat and releases ownership for a subsequent API turn', async () => {
  answer('portable empty Team CLI completion')
  const turn = await server.cli(['agent', 'chat', agentId, '--message', 'empty Team trial'])
  expect(turn.exitCode, turn.stderr).toBe(0)
  expect(turn.stdout).toContain('portable empty Team CLI completion')
  answer('portable empty Team API completion')
  complete(await apiTurn('follow-up after CLI exit'), 'portable empty Team API completion')
})

test('repository instructions reach the actual worker/provider for CLI and API turns', async () => {
  const marker = 'BAZ057_EXACT_TEAM_INSTRUCTIONS_71d86'
  writeFileSync(join(server.home, 'teams', 'default', 'AGENTS.md'), `${marker}\n`)
  answer('portable instructed CLI completion', marker)
  const turn = await server.cli(['agent', 'chat', agentId, '--message', 'instructed Team trial'])
  expect(turn.exitCode, turn.stderr).toBe(0)
  expect(turn.stdout).toContain('portable instructed CLI completion')
  answer('portable instructed API completion', marker)
  complete(await apiTurn('instructed API follow-up'), 'portable instructed API completion')
  expect(provider.callCount()).toBe(4)
})

import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChatFrame } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { restartTestServer, startTestServer, type TestServer } from './server-fixture.ts'

const serverEnv = (provider: MockLlm) => ({
  LMSTUDIO_URL: provider.url,
  BAZILION_BASH_SANDBOX: 'off',
  BAZILION_SCHEDULER: 'off',
  BROWSER_ENABLED: 'false',
})
let server: TestServer
let provider: MockLlm
let agentId: string
beforeAll(async () => {
  provider = await startLmStudioMock()
  server = await startTestServer(serverEnv(provider))
  const profile = await server.cli([
    'profile',
    'create',
    'shutdown',
    '--model',
    'lmstudio:test-model',
  ])
  expect(profile.exitCode).toBe(0)
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'shutdown'])
  expect(spawned.exitCode).toBe(0)
  agentId = extractAgentId(spawned.stdout)
})
afterAll(async () => {
  await server?.stop()
  await provider?.stop()
})

async function apiTurn(message: string): Promise<ChatFrame[]> {
  const auth = { authorization: `Bearer ${server.token}` }
  const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { ...auth, origin: server.url, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(20_000),
  })
  expect(response.status).toBe(200)
  return (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ChatFrame)
}

test('daemon shutdown settles an active real worker before DB close and permits a fresh turn after restart', async () => {
  let entered!: () => void
  const requested = new Promise<void>((resolve) => {
    entered = resolve
  })
  provider.push([
    async (request: IncomingMessage, response: ServerResponse) => {
      for await (const _chunk of request) {
        /* drain this controlled request */
      }
      const closed = once(response, 'close')
      entered()
      await closed
    },
  ])
  const turn = apiTurn('wait in the controlled provider until daemon shutdown')
  await requested
  await server.stop({ keepHome: true, signal: 'SIGTERM' })
  await turn
  server = await restartTestServer(server, serverEnv(provider))
  provider.push([
    {
      choices: [
        {
          message: { role: 'assistant', content: 'completion after settled daemon restart' },
          finish_reason: 'stop',
        },
      ],
    },
  ])
  const frames = await apiTurn('new explicitly requested turn after restart')
  expect(frames.filter((frame) => frame.kind === 'fatal')).toEqual([])
  expect(frames.some((frame) => frame.kind === 'done')).toBe(true)
  expect(JSON.stringify(frames)).toContain('completion after settled daemon restart')
  expect(JSON.stringify(frames)).not.toContain('cleanup unconfirmed')
})

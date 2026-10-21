import { afterEach, expect, test, vi } from 'vitest'
import { type ApiClientError, createClient } from '../src/index.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

test('agent browser client methods use the canonical HTTP status/stop/reset contracts', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    })
    if (init?.method === 'GET') {
      return new Response(
        JSON.stringify({
          agentId: 'agent/one',
          enabled: true,
          availability: 'configured',
          state: 'stopped',
          profilePresent: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(null, { status: 204 })
  }) as typeof fetch

  const client = createClient({ serverUrl: 'http://daemon.test', token: 'device-token' })
  const status = await client.getAgentBrowser('agent/one')
  expect(status).toMatchObject({ agentId: 'agent/one', state: 'stopped' })
  await client.stopAgentBrowser('agent/one')
  await client.resetAgentBrowser('agent/one')

  expect(calls.map(({ method, url }) => [method, url])).toEqual([
    ['GET', 'http://daemon.test/api/agents/agent%2Fone/browser'],
    ['POST', 'http://daemon.test/api/agents/agent%2Fone/browser/stop'],
    [
      'DELETE',
      'http://daemon.test/api/agents/agent%2Fone/browser/profile?confirm=reset-browser-profile',
    ],
  ])
  for (const call of calls) {
    expect(call.url).not.toMatch(/cookie|cdp|profile-path/i)
  }
})

test('agent browser client preserves typed refusal codes', async () => {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ error: 'browser has in-flight actions', code: 'browser_busy' }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        },
      ),
  ) as typeof fetch

  const client = createClient({ serverUrl: 'http://daemon.test', token: 'device-token' })
  await expect(client.stopAgentBrowser('a')).rejects.toMatchObject<ApiClientError>({
    status: 409,
    body: { code: 'browser_busy' },
  })
})

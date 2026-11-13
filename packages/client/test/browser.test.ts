import type { BrowserStatus } from '@bazilion/api-types'
import { afterEach, expect, test, vi } from 'vitest'
import { createClient } from '../src/index.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('the agent browser methods call status, stop and reset on the agent browser routes', async () => {
  const status: BrowserStatus = {
    agentId: 'agent/one',
    enabled: true,
    running: false,
    profilePresent: false,
  }
  const calls: Array<[string, string]> = []
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push([method, String(input)])
    return method === 'GET' ? Response.json(status) : new Response(null, { status: 204 })
  }) as typeof fetch

  const client = createClient({ serverUrl: 'http://daemon.test', token: 'device-token' })
  expect(await client.getAgentBrowser('agent/one')).toEqual(status)
  await client.stopAgentBrowser('agent/one')
  await client.resetAgentBrowser('agent/one')
  expect(calls).toEqual([
    ['GET', 'http://daemon.test/api/agents/agent%2Fone/browser'],
    ['POST', 'http://daemon.test/api/agents/agent%2Fone/browser/stop'],
    ['DELETE', 'http://daemon.test/api/agents/agent%2Fone/browser/profile'],
  ])
})

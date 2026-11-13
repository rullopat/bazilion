import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, api, apiFetch } from '../src/lib/api.ts'

function stubBrowser(cookie: string, response: Response) {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => response.clone())
  vi.stubGlobal('document', { cookie })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function sentHeaders(fetch: ReturnType<typeof stubBrowser>): Record<string, string> {
  return (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the browser API helper', () => {
  test('a state-changing request echoes the CSRF cookie and sends JSON', async () => {
    const fetch = stubBrowser('theme=dark; bz_csrf_dev=token-1', Response.json({ ok: true }))
    await expect(api('/api/agents', { body: { name: 'a' } })).resolves.toEqual({ ok: true })
    const [path, init] = fetch.mock.calls[0] ?? []
    expect(path).toBe('/api/agents')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"name":"a"}')
    expect(sentHeaders(fetch)).toEqual({
      'x-bazilion-csrf': 'token-1',
      'content-type': 'application/json',
    })
  })

  test('the production cookie name is read too', async () => {
    const fetch = stubBrowser('__Host-bz_csrf=token-2', new Response(null, { status: 204 }))
    await expect(api('/api/agents/a', { method: 'DELETE' })).resolves.toBeUndefined()
    expect(sentHeaders(fetch)).toEqual({ 'x-bazilion-csrf': 'token-2' })
  })

  test('a read sends no CSRF header, and FormData keeps its own content type', async () => {
    const fetch = stubBrowser('bz_csrf_dev=token-1', Response.json([]))
    await api('/api/skills')
    expect(sentHeaders(fetch)).toEqual({})
    const form = new FormData()
    await api('/api/skills/import', { body: form })
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(form)
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({ 'x-bazilion-csrf': 'token-1' })
  })

  test("a refusal throws the daemon's message, code and body", async () => {
    stubBrowser(
      '',
      Response.json({ error: 'agent is busy', code: 'agent_turn_active' }, { status: 409 }),
    )
    const error = await apiFetch('/api/agents/a/chat', { body: {} }).catch((cause) => cause)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      message: 'agent is busy',
      status: 409,
      code: 'agent_turn_active',
    })
    expect((error as ApiError).body).toEqual({ error: 'agent is busy', code: 'agent_turn_active' })
  })

  test("the gateway's plain-text refusal becomes the message", async () => {
    stubBrowser('', new Response('csrf validation failed', { status: 403 }))
    await expect(api('/api/logout', { method: 'POST' })).rejects.toMatchObject({
      message: 'csrf validation failed',
      status: 403,
      code: undefined,
    })
  })
})

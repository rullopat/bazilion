import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const dns = vi.hoisted(() => ({ answers: [] as string[][], calls: [] as string[] }))

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    dns.calls.push(hostname)
    const answers = dns.answers.shift() ?? ['198.51.100.10']
    return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  },
}))

import { guardedFetch, SsrFBlockedError } from '../../src/runtime/tools/web-ssrf.ts'

beforeEach(() => {
  dns.answers = []
  dns.calls = []
})

afterEach(() => vi.restoreAllMocks())

test('guardedFetch revalidates every redirect and blocks a deterministic DNS-rebinding answer', async () => {
  dns.answers = [['198.51.100.10'], ['127.0.0.1']]
  const requested: string[] = []
  const fetchImpl = vi.fn(async (url: string | URL) => {
    requested.push(String(url))
    return new Response(null, {
      status: 302,
      headers: { location: 'https://rebind.example/private' },
    })
  })

  await expect(
    guardedFetch({ url: 'https://rebind.example/start', fetchImpl }),
  ).rejects.toBeInstanceOf(SsrFBlockedError)
  expect(dns.calls).toEqual(['rebind.example', 'rebind.example'])
  expect(requested).toEqual(['https://rebind.example/start'])
})

test('guardedFetch rejects a redirect to metadata before issuing the redirected request', async () => {
  dns.answers = [['198.51.100.10']]
  const fetchImpl = vi.fn(
    async () =>
      new Response(null, {
        status: 307,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
  )

  await expect(guardedFetch({ url: 'https://public.example/start', fetchImpl })).rejects.toThrow(
    'Blocked: private IP literal',
  )
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

test('guardedFetch strips credentials on cross-origin redirects while retaining benign headers', async () => {
  dns.answers = [['198.51.100.10'], ['203.0.113.20']]
  const observed: Headers[] = []
  const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    observed.push(new Headers(init?.headers))
    if (observed.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://other.example/final' },
      })
    }
    return new Response('ok')
  })

  const result = await guardedFetch({
    url: 'https://public.example/start',
    fetchImpl,
    init: {
      headers: {
        authorization: 'Bearer credential-sentinel',
        cookie: 'session=credential-sentinel',
        'proxy-authorization': 'Basic credential-sentinel',
        'x-benign': 'preserved',
      },
    },
  })
  await result.release()

  expect(observed[0]?.get('authorization')).toContain('credential-sentinel')
  expect(observed[1]?.get('authorization')).toBeNull()
  expect(observed[1]?.get('cookie')).toBeNull()
  expect(observed[1]?.get('proxy-authorization')).toBeNull()
  expect(observed[1]?.get('x-benign')).toBe('preserved')
})

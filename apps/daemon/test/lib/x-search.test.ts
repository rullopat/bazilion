// x_search (BAZ-107): xAI's X search on its Responses API, called by the daemon with the xAI key.

import { expect, test, vi } from 'vitest'
import { createXSearchHost, xSearchReady } from '../../src/lib/x-search.ts'
import { xSearchTool } from '../../src/runtime/tools/x-search.ts'

const answer = {
  output: [
    { type: 'custom_tool_call', call_id: 'xs_1', name: 'x_keyword_search' },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: 'NASA says Artemis III launches in May [[1]](https://x.com/NASA/status/1).',
          annotations: [
            { type: 'url_citation', url: 'https://x.com/NASA/status/1', title: '1' },
            { type: 'url_citation', url: 'https://x.com/NASA/status/1', title: '1' },
            { type: 'url_citation', url: 'https://x.com/esa/status/2' },
          ],
        },
      ],
    },
  ],
  usage: { server_side_tool_usage_details: { x_search_calls: 2, x_posts_fetched: 14 } },
}

function host(env: NodeJS.ProcessEnv = { XAI_API_KEY: 'xai-key' }) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(answer))
  return {
    fetcher,
    search: createXSearchHost({
      env: () => env,
      signal: new AbortController().signal,
      fetch: fetcher,
    }),
  }
}

test('x_search is there while an xAI key is saved and the switch is not off', () => {
  expect(xSearchReady({})).toBe(false)
  expect(xSearchReady({ XAI_API_KEY: ' ' })).toBe(false)
  expect(xSearchReady({ XAI_API_KEY: 'xai-key' })).toBe(true)
  for (const off of ['false', '0', 'no', 'Off']) {
    expect(xSearchReady({ XAI_API_KEY: 'xai-key', BAZILION_X_SEARCH: off })).toBe(false)
  }
  expect(xSearchReady({ XAI_API_KEY: 'xai-key', BAZILION_X_SEARCH: 'true' })).toBe(true)
})

test('a search asks xAI with its filters and returns the answer, the posts and what was read', async () => {
  const { fetcher, search } = host()
  const output = await search.search({
    query: ' Artemis III launch date ',
    handles: ['@NASA', 'esa', ' '],
    from: '2026-11-01',
    to: '2026-11-28',
  })
  expect(output).toEqual({
    answer: 'NASA says Artemis III launches in May [[1]](https://x.com/NASA/status/1).',
    posts: [
      { url: 'https://x.com/NASA/status/1', title: '1' },
      { url: 'https://x.com/esa/status/2' },
    ],
    postsRead: 14,
  })
  const [url, init] = fetcher.mock.calls[0] ?? []
  expect(String(url)).toBe('https://api.x.ai/v1/responses')
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer xai-key')
  const body = JSON.parse(String(init?.body))
  expect(body.model).toBe('grok-4.7')
  expect(body.input.at(-1)).toEqual({ role: 'user', content: 'Artemis III launch date' })
  expect(body.tools).toEqual([
    {
      type: 'x_search',
      allowed_x_handles: ['NASA', 'esa'],
      from_date: '2026-11-01',
      to_date: '2026-11-28',
    },
  ])

  // Another model when one is set.
  const other = host({ XAI_API_KEY: 'xai-key', BAZILION_X_SEARCH_MODEL: 'grok-4.3' })
  await other.search.search({ query: 'news', excludeHandles: ['spam'] })
  const sent = JSON.parse(String(other.fetcher.mock.calls[0]?.[1]?.body))
  expect(sent.model).toBe('grok-4.3')
  expect(sent.tools).toEqual([{ type: 'x_search', excluded_x_handles: ['spam'] }])
})

test('what xAI would ignore or refuse is refused before asking it', async () => {
  const { fetcher, search } = host()
  await expect(search.search({ query: '' })).rejects.toThrow(/1–512/)
  await expect(
    search.search({ query: 'x', handles: ['a'], excludeHandles: ['b'] }),
  ).rejects.toThrow(/not both/)
  await expect(search.search({ query: 'x', from: '28/11/2026' })).rejects.toThrow(/YYYY-MM-DD/)
  expect(fetcher).not.toHaveBeenCalled()
  const keyless = host({})
  await expect(keyless.search.search({ query: 'x' })).rejects.toThrow(/xAI key/)
})

test('an error from xAI says what it answered', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response('{"error":"model not found"}', { status: 404 }),
  )
  const search = createXSearchHost({
    env: () => ({ XAI_API_KEY: 'xai-key' }),
    signal: new AbortController().signal,
    fetch: fetcher,
  })
  await expect(search.search({ query: 'x' })).rejects.toThrow(/HTTP 404: .*model not found/)
})

test('the tool gives the Agent the answer, numbered post links and the posts read', async () => {
  const { search } = host()
  const tool = xSearchTool(search)
  const text = await tool.invoke({ query: 'Artemis', exclude_handles: ['spam'] })
  expect(text).toBe(
    [
      'NASA says Artemis III launches in May [[1]](https://x.com/NASA/status/1).',
      'Posts:\n1. https://x.com/NASA/status/1 (1)\n2. https://x.com/esa/status/2',
      'xAI read 14 posts.',
    ].join('\n\n'),
  )
})

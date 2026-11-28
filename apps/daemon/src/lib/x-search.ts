// x_search (BAZ-107) runs in the daemon: xAI's own X search, on its Responses API, with the xAI
// key under Models. Grok searches the posts, reads them and answers; the Agent gets that answer,
// the posts it cites, and how many it read, which is what xAI bills.

import type { XSearchArgs, XSearchHost, XSearchOutput } from '../runtime/worker/ipc-protocol.ts'
import { assertOk } from './openai-responses.ts'
import { effectiveValue } from './setting-fields.ts'

export const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses'
/** The Grok model that searches, unless BAZILION_X_SEARCH_MODEL names another. */
export const X_SEARCH_DEFAULT_MODEL = 'grok-4.7'

const INSTRUCTIONS =
  'Search posts on X for the request and answer from what they say. Cite each post you use. Say plainly when the posts do not answer it.'

/** Whether a turn gets x_search: an xAI key is saved and the switch is not off. */
export function xSearchReady(env: NodeJS.ProcessEnv): boolean {
  // Read as the Web search card shows it: `0`, `no` or `off` turn it off too.
  const on = effectiveValue(
    { type: 'switch', on: 'true', off: 'false', default: true },
    env.BAZILION_X_SEARCH ?? '',
  )
  return on === 'true' && Boolean(env.XAI_API_KEY?.trim())
}

interface XSearchHostOptions {
  /** Read when a search runs, so a key changed during the turn is used. */
  env: () => NodeJS.ProcessEnv
  signal: AbortSignal
  fetch?: typeof fetch
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Handles as xAI takes them: without @, none empty. */
function handles(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`x_search: ${name} is a list of X handles`)
  const list = value.map((item) => String(item).trim().replace(/^@/, '')).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function day(value: unknown, name: string): string | undefined {
  if (value === undefined || value === '') return undefined
  // xAI ignores a date in another form without saying so: refuse it here instead.
  if (typeof value !== 'string' || !DAY.test(value)) {
    throw new Error(`x_search: ${name} is a day written YYYY-MM-DD`)
  }
  return value
}

/** The answer text and the cited posts, from a Responses API body. */
export function readXSearchResponse(body: unknown): XSearchOutput {
  const response = (body ?? {}) as Record<string, unknown>
  const output = Array.isArray(response.output) ? response.output : []
  const texts: string[] = []
  const posts = new Map<string, { url: string; title?: string }>()
  for (const item of output as Record<string, unknown>[]) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content as Record<string, unknown>[]) {
      if (part?.type !== 'output_text' || typeof part.text !== 'string') continue
      texts.push(part.text)
      for (const note of Array.isArray(part.annotations) ? part.annotations : []) {
        const { type, url, title } = (note ?? {}) as Record<string, unknown>
        if (type !== 'url_citation' || typeof url !== 'string' || posts.has(url)) continue
        posts.set(url, { url, ...(typeof title === 'string' && title ? { title } : {}) })
      }
    }
  }
  const usage = (response.usage as Record<string, unknown> | undefined)
    ?.server_side_tool_usage_details as Record<string, unknown> | undefined
  const read = usage?.x_posts_fetched
  return {
    answer: texts.join('\n\n'),
    posts: [...posts.values()],
    ...(typeof read === 'number' ? { postsRead: read } : {}),
  }
}

export function createXSearchHost(opts: XSearchHostOptions): XSearchHost {
  const fetchImpl = opts.fetch ?? fetch
  return {
    async search(args: XSearchArgs): Promise<XSearchOutput> {
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (!query || query.length > 512) {
        throw new Error('x_search needs a query of 1–512 characters')
      }
      const only = handles(args.handles, 'handles')
      const except = handles(args.excludeHandles, 'exclude_handles')
      if (only && except) {
        throw new Error('x_search takes handles or exclude_handles, not both')
      }
      const from = day(args.from, 'from')
      const to = day(args.to, 'to')
      const env = opts.env()
      const key = env.XAI_API_KEY?.trim()
      if (!key) throw new Error('X search needs an xAI key (Setup → Models)')
      const response = await fetchImpl(XAI_RESPONSES_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: env.BAZILION_X_SEARCH_MODEL?.trim() || X_SEARCH_DEFAULT_MODEL,
          input: [
            { role: 'system', content: INSTRUCTIONS },
            { role: 'user', content: query },
          ],
          tools: [
            {
              type: 'x_search',
              ...(only ? { allowed_x_handles: only } : {}),
              ...(except ? { excluded_x_handles: except } : {}),
              ...(from ? { from_date: from } : {}),
              ...(to ? { to_date: to } : {}),
            },
          ],
        }),
        signal: opts.signal,
      })
      await assertOk(response)
      return readXSearchResponse(await response.json())
    },
  }
}

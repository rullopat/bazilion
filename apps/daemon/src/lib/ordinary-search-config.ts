import type { OrdinarySearchStatus, SearchRoute } from '@bazilion/api-types'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

export const SEARCH_ROUTES = ['auto', 'brave', 'searxng', 'openai', 'openai-codex'] as const
export const SEARCH_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  'openai-codex': 'https://chatgpt.com/backend-api/codex/responses',
} as const

/** Protocol admission, NOT a guarantee of hosted-search entitlement. Unknown tuples refuse. */
export function nativeSearchModel(provider: string, id: string): boolean {
  if (provider !== 'openai' && provider !== 'openai-codex') return false
  // Narrow initial GPT family; reasoning-only, realtime, nano and Spark are not qualified here.
  if (
    !/^gpt-(?:4\.1(?:-mini)?|4o(?:-mini)?|5(?:\.\d+)?(?:-mini)?|5\.6-(?:luna|sol|terra)|6-(?:astra|luna|sol)|6\.1-sol)$/.test(
      id,
    )
  )
    return false
  return getBuiltinModels(provider).some(
    (model) =>
      model.id === id &&
      model.api === (provider === 'openai' ? 'openai-responses' : 'openai-codex-responses') &&
      model.baseUrl ===
        (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://chatgpt.com/backend-api'),
  )
}

/** Pure readiness: never fetches a token, probes a provider or prints configuration values. */
export function ordinarySearchStatus(opts: {
  env: NodeJS.ProcessEnv
  model?: string
  codexConnected?: boolean
  admitted?: boolean
}): OrdinarySearchStatus {
  const { env } = opts
  const mode = env.BAZILION_WEB_SEARCH_MODE === 'live' ? 'live' : 'cached'
  const base: OrdinarySearchStatus = {
    state: 'unavailable',
    route: null,
    model: opts.model ?? null,
    account: null,
    mode,
    qualification: 'not_applicable',
    message: '',
  }
  const unavailable = (message: string): OrdinarySearchStatus => ({ ...base, message })
  if (opts.admitted === false || env.BAZILION_WEB_SEARCH === 'off')
    return { ...base, state: 'disabled', message: 'Ordinary web search is disabled for this turn.' }
  if (env.BAZILION_WEB_SEARCH && !['on', 'off'].includes(env.BAZILION_WEB_SEARCH))
    return unavailable('Invalid ordinary search switch; select on or off.')
  if (env.BAZILION_WEB_SEARCH_MODE && !['live', 'cached'].includes(env.BAZILION_WEB_SEARCH_MODE))
    return unavailable('Invalid native search mode; select cached or live.')
  const raw = env.BAZILION_WEB_SEARCH_ROUTE || 'auto'
  if (!SEARCH_ROUTES.includes(raw as SearchRoute))
    return unavailable('Select a supported search route.')
  let route = raw as SearchRoute
  const [provider, id, extra] = (opts.model ?? '').split(':')
  if (route === 'auto') {
    if (env.BRAVE_API_KEY?.trim()) route = 'brave'
    else if (env.SEARXNG_URL?.trim()) route = 'searxng'
    else if (provider === 'openai' || provider === 'openai-codex') route = provider
    else
      return unavailable(
        'No managed backend configured. Native search follows an eligible OpenAI/ChatGPT Agent’s own model/account; no cross-provider fallback.',
      )
  }
  if (route === 'brave' || route === 'searxng') {
    if (route === 'brave' && !env.BRAVE_API_KEY?.trim())
      return unavailable('Selected Brave route requires BRAVE_API_KEY. No fallback.')
    if (route === 'searxng') {
      try {
        const url = new URL(env.SEARXNG_URL ?? '')
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
        )
          throw new Error()
      } catch {
        return unavailable(
          'Selected SearXNG requires a valid HTTPS or loopback HTTP base URL without credentials, query or fragment. No fallback.',
        )
      }
    }
    return {
      ...base,
      state: 'configured',
      route,
      model: null,
      account: 'managed',
      message: `Configured ${route} discovery. Source reading is separate; no execution fallback.`,
    }
  }
  if (!id || extra || provider !== route || !nativeSearchModel(route, id))
    return unavailable(
      'Native search requires the current Agent’s eligible OpenAI/ChatGPT model and matching account. Unknown models and account substitution are refused.',
    )
  // Neither environment endpoint overrides nor custom compatibility routes may impersonate official hosted search.
  if (env.OPENAI_BASE_URL || env.OPENAI_CODEX_BASE_URL)
    return unavailable(
      'Native search refuses custom endpoint overrides; only official provider routes are admitted.',
    )
  if (route === 'openai' ? !env.OPENAI_API_KEY?.trim() : !opts.codexConnected)
    return unavailable(
      route === 'openai'
        ? 'Set OPENAI_API_KEY. No subscription fallback.'
        : 'Connect ChatGPT on /config. No API-key fallback.',
    )
  return {
    ...base,
    state: 'configured',
    route,
    account: route === 'openai' ? 'api' : 'subscription',
    qualification: 'unqualified',
    message: `Experimental native ${route} search on the Agent’s selected model (${mode} requested). Live qualification pending; ${route === 'openai' ? 'additional API search charges may apply' : 'subscription entitlement/limits apply'}. No fallback. Query 512 chars, deadline 30 s, upstream 2 MiB, evidence 32 KiB, 1–8 citations; provider-owned networking is not browser-proxy-contained.`,
  }
}

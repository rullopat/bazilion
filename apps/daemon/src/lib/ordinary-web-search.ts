import { createHash } from 'node:crypto'
import type { OrdinarySearchStatus, WebSearchArgs, WebSearchOutput } from '@bazilion/api-types'
import { codingSecrets } from './coding-environment/diagnostics.ts'
import {
  containsSearchSecret,
  NativeSearchError,
  nativeSearch,
  readSearchBody,
  SEARCH_DEADLINE_MS,
  SEARCH_RETURN_BYTES,
  searchAbortable,
  validateSearchArgs,
} from './native-search.ts'
import { ordinarySearchStatus } from './ordinary-search-config.ts'

const ordinaryHosts = new WeakSet<object>()
type SearchWireAdmission = (perform: () => Promise<Response>) => Promise<Response>
const wireAdmissions = new WeakMap<object, (admit: SearchWireAdmission) => void>()
/** Daemon-only, once-before-use transport admission. No config/IPC path accepts this callback. */
export function bindOrdinarySearchWire(host: object, admit: SearchWireAdmission): void {
  const bind = wireAdmissions.get(host)
  if (!bind || typeof admit !== 'function') throw new Error('native_search_admission_refused')
  bind(admit)
}
export function isOrdinaryWebSearchHost(host: unknown): boolean {
  return !!host && typeof host === 'object' && ordinaryHosts.has(host)
}

class OrdinarySearchError extends Error {}
function refuse(message: string): never {
  throw new OrdinarySearchError(`web_search: ${message}`)
}

export function createOrdinaryWebSearchHost(opts: {
  env: () => NodeJS.ProcessEnv
  model: string
  codexConnected: () => boolean
  codexAccountId: () => string | null
  codexCredential: () => Promise<string>
  signal: AbortSignal
  assertActive: () => void
  protectedSecrets?: () => string[]
  fetchImpl?: typeof fetch
}): { status: OrdinarySearchStatus; search(args: WebSearchArgs): Promise<WebSearchOutput> } {
  const model = opts.model
  const initialEnv = opts.env()
  const captured = ordinarySearchStatus({
    env: initialEnv,
    model,
    codexConnected: opts.codexConnected(),
  })
  const searxng = initialEnv.SEARXNG_URL
  const credentialIdentity = (value: string | undefined) =>
    createHash('sha256')
      .update(value ?? '')
      .digest('hex')
  const apiIdentity = credentialIdentity(initialEnv.OPENAI_API_KEY)
  const braveIdentity = credentialIdentity(initialEnv.BRAVE_API_KEY)
  const secretsForTurn = () => [...codingSecrets(opts.env()), ...(opts.protectedSecrets?.() ?? [])]
  const codexAccountId = opts.codexAccountId()
  let busy = false,
    used = false
  let admission: SearchWireAdmission | undefined
  const fetcher: typeof fetch = (input, init) => {
    const perform = () => (opts.fetchImpl ?? fetch)(input, init)
    return admission ? admission(perform) : perform()
  }
  const assertActive = () => {
    opts.signal.throwIfAborted()
    opts.assertActive()
    const current = ordinarySearchStatus({
      env: opts.env(),
      model,
      codexConnected: opts.codexConnected(),
    })
    if (
      current.state !== 'configured' ||
      current.route !== captured.route ||
      current.mode !== captured.mode ||
      (captured.route === 'openai' &&
        credentialIdentity(opts.env().OPENAI_API_KEY) !== apiIdentity) ||
      (captured.route === 'brave' &&
        credentialIdentity(opts.env().BRAVE_API_KEY) !== braveIdentity) ||
      (captured.route === 'openai-codex' &&
        (!codexAccountId || opts.codexAccountId() !== codexAccountId)) ||
      (captured.route === 'searxng' && opts.env().SEARXNG_URL !== searxng)
    )
      refuse('configuration changed or unavailable; no fallback')
  }
  const host = {
    // Do not let a consumer mutate the captured admission contract through a status object.
    status: { ...captured },
    async search(rawArgs: WebSearchArgs): Promise<WebSearchOutput> {
      used = true
      const args = validateSearchArgs(rawArgs)
      if (captured.state !== 'configured') refuse(captured.message)
      assertActive()
      if (busy) refuse('one request at a time per turn')
      busy = true
      const controller = new AbortController()
      const signal = AbortSignal.any([
        opts.signal,
        AbortSignal.timeout(SEARCH_DEADLINE_MS),
        controller.signal,
      ])
      const expires = performance.now() + SEARCH_DEADLINE_MS
      const active = () => {
        signal.throwIfAborted()
        assertActive()
        if (performance.now() >= expires) refuse('deadline exceeded; no result accepted')
      }
      let response: Response | undefined
      try {
        const provider = captured.route
        if (provider === 'openai' || provider === 'openai-codex') {
          return await nativeSearch({
            provider,
            model: model.slice(model.indexOf(':') + 1),
            mode: captured.mode,
            args,
            signal,
            assertActive: active,
            ...(codexAccountId ? { accountId: codexAccountId } : {}),
            credential:
              provider === 'openai-codex'
                ? opts.codexCredential
                : async () => opts.env().OPENAI_API_KEY ?? '',
            secrets: secretsForTurn,
            fetchImpl: fetcher,
          })
        }
        if (args.allowedDomains)
          refuse(
            'domain filters require a native route; selected managed route cannot enforce them',
          )
        const env = opts.env()
        const secrets = secretsForTurn()
        if (secrets.some((secret) => args.query.includes(secret)))
          refuse('query contains protected credential material')
        const url =
          provider === 'brave'
            ? `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: args.query, count: String(args.count) })}`
            : `${searxng?.replace(/\/+$/, '')}/search?${new URLSearchParams({ q: args.query, format: 'json' })}`
        const request = fetcher(url, {
          headers: {
            accept: 'application/json',
            ...(provider === 'brave' ? { 'x-subscription-token': env.BRAVE_API_KEY ?? '' } : {}),
          },
          signal,
          redirect: 'error',
        })
        void request.then(
          (late) => {
            if (signal.aborted) void late.body?.cancel().catch(() => {})
          },
          () => {},
        )
        response = await searchAbortable(request, signal)
        if (!response.ok) refuse(`managed provider HTTP ${response.status}; no fallback`)
        const body = await readSearchBody(response, signal)
        active()
        const data = JSON.parse(body) as {
          type?: unknown
          query?: { original?: unknown }
          results?: unknown
          web?: { results?: unknown }
        }
        const rows = provider === 'brave' ? data.web?.results : data.results
        // Only a recognisable Brave search envelope may omit web results. An arbitrary
        // 200 error/object is not evidence of an empty search.
        if (
          provider === 'brave' &&
          rows === undefined &&
          (data.type !== 'search' || typeof data.query?.original !== 'string')
        )
          refuse('missing managed search evidence')
        if (rows !== undefined && !Array.isArray(rows)) refuse('malformed managed results')
        if (provider === 'searxng' && !Array.isArray(rows)) refuse('missing managed results')
        const field = (value: unknown, limit: number) =>
          typeof value === 'string' ? value.slice(0, limit) : ''
        const output = {
          backend: provider ?? 'unavailable',
          results: (Array.isArray(rows) ? rows : []).slice(0, args.count).map((raw) => {
            if (!raw || typeof raw !== 'object') refuse('malformed managed result')
            return {
              title: field(raw.title, 200),
              url: field(raw.url, 2048),
              snippet: field(provider === 'brave' ? raw.description : raw.content, 300),
            }
          }),
        }
        // Check parsed strings too: JSON escaping must not conceal secrets from egress filtering.
        if (Buffer.byteLength(JSON.stringify(output)) > SEARCH_RETURN_BYTES)
          refuse('returned evidence byte budget exceeded')
        if (containsSearchSecret(output, [...secrets, ...secretsForTurn()]))
          refuse('provider evidence contains protected credential material')
        active()
        return output
      } catch (error) {
        if (error instanceof NativeSearchError || error instanceof OrdinarySearchError) throw error
        refuse('provider unavailable, malformed or cancelled; no retry/fallback')
      } finally {
        controller.abort()
        if (response && !response.body?.locked) void response.body?.cancel().catch(() => {})
        busy = false
      }
    },
  }
  ordinaryHosts.add(host)
  wireAdmissions.set(host, (admit) => {
    if (used || admission) throw new Error('native_search_admission_refused')
    admission = admit
  })
  return host
}

import type { ApiError } from '@bazilion/api-types'

export type TokenSource = string | (() => string | Promise<string>)

export interface ClientConfig {
  serverUrl: string
  /**
   * Bearer token (or supplier for lazy / rotating credentials). The package
   * sends it as `Authorization: Bearer <token>` and also stamps `Origin:
   * <serverUrl>` to pass Astro's `security.checkOrigin` gate on non-GET
   * requests. Pass a function to support token rotation (OAuth refresh,
   * mobile keychain reads) — it is invoked on every request.
   */
  token: TokenSource
}

export class ApiClientError extends Error {
  status: number
  body: ApiError
  constructor(status: number, body: ApiError) {
    super(`${status}: ${body.error}`)
    this.status = status
    this.body = body
  }
}

async function resolveToken(src: TokenSource): Promise<string> {
  return typeof src === 'function' ? await src() : src
}

export function createClient(cfg: ClientConfig) {
  async function authHeaders(): Promise<Record<string, string>> {
    const token = await resolveToken(cfg.token)
    return {
      authorization: `Bearer ${token}`,
      // Astro 6 enabled `security.checkOrigin` by default for server mode:
      // any state-changing request without an `Origin` matching the server
      // host is rejected with 403. Browsers set this automatically; `fetch`
      // in Node / React Native does not. Stamping the server's own URL is
      // always valid for a legitimate client.
      origin: cfg.serverUrl,
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { ...(await authHeaders()) }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${cfg.serverUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError
      throw new ApiClientError(res.status, err)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  // Multipart POST — lets the runtime set its own `content-type: multipart/form-data;
  // boundary=…` header. Reusing `request()` would stomp that with JSON, so
  // we keep a separate path.
  async function postMultipart<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${cfg.serverUrl}${path}`, {
      method: 'POST',
      headers: { ...(await authHeaders()) },
      body: form,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError
      throw new ApiClientError(res.status, err)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async function* stream<T>(method: string, path: string, body?: unknown): AsyncGenerator<T> {
    const headers: Record<string, string> = { ...(await authHeaders()) }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${cfg.serverUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError
      throw new ApiClientError(res.status, err)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as T
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as T
  }

  return {
    get: <T>(p: string) => request<T>('GET', p),
    post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
    postMultipart,
    put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
    patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
    del: <T>(p: string) => request<T>('DELETE', p),
    stream,
  }
}

export type BazilionClient = ReturnType<typeof createClient>

// The browser's one way to call the daemon: same-origin /api/* requests through the gateway,
// which forwards the session cookie. State-changing requests echo the CSRF cookie in a header.

import { CSRF_COOKIES, readCookie } from './cookies'

export class ApiError extends Error {
  readonly status: number
  /** The daemon's machine-readable `code`, when it sent one. */
  readonly code: string | undefined
  /** The parsed JSON error body, when there was one. */
  readonly body: unknown

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.body = body
  }
}

export interface ApiInit {
  /** Defaults to POST when there is a body, GET otherwise. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Sent as JSON, except FormData which is sent as is. */
  body?: unknown
  signal?: AbortSignal
}

function csrfHeader(): Record<string, string> {
  for (const name of CSRF_COOKIES) {
    const value = readCookie(document.cookie, name)
    if (value) return { 'x-bazilion-csrf': value }
  }
  return {}
}

async function failure(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let body: { error?: unknown; code?: unknown } = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') body = parsed
  } catch {
    // Not JSON: the gateway's plain-text refusals, or an empty body.
  }
  const message =
    typeof body.error === 'string' ? body.error : text.slice(0, 300) || `HTTP ${response.status}`
  const code = typeof body.code === 'string' ? body.code : undefined
  return new ApiError(message, response.status, code, body)
}

/** The raw response (streams, downloads, text); throws ApiError unless it is ok. */
export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST')
  const headers: Record<string, string> = method === 'GET' ? {} : csrfHeader()
  let body: BodyInit | undefined
  if (init.body instanceof FormData) body = init.body
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const response = await fetch(path, { method, headers, body, signal: init.signal })
  if (!response.ok) throw await failure(response)
  return response
}

/** The daemon's JSON answer (undefined for an empty body); throws ApiError with its message. */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const text = await (await apiFetch(path, init)).text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

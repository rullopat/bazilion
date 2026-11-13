// HTTP client for the daemon (or the web gateway in front of it), used by the CLI and by the web's
// server-side loaders.

import type {
  AgentQuestionAnswer,
  AgentQuestionListResponse,
  ApiError,
  BrowserStatus,
  CodingEnvironmentStatus,
  EnqueueUserInput,
  NotificationSettings,
  NotificationSettingsResponse,
  RepositoryReviewResponse,
  ReviewFeedbackRequest,
  ReviewFeedbackResponse,
  TeamCodingEnvironment,
  UserQueueItem,
  UserQueueListResponse,
} from '@bazilion/api-types'

export interface ClientConfig {
  serverUrl: string
  /** Sent as `Authorization: Bearer <token>`; null sends none. */
  token: string | null
  /** Extra request headers, e.g. the session cookie the web's loaders forward. */
  headers?: Record<string, string>
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

/** A non-2xx response, carrying its status and error body. */
async function failure(res: Response): Promise<ApiClientError> {
  const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError
  return new ApiClientError(res.status, body)
}

export function createClient(cfg: ClientConfig) {
  const authHeaders: Record<string, string> = {
    ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
    ...cfg.headers,
  }

  /** A JSON request; the body, when given, is sent as JSON. */
  function send(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${cfg.serverUrl}${path}`, {
      method,
      headers:
        body === undefined ? authHeaders : { ...authHeaders, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) throw await failure(res)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return json<T>(await send(method, path, body))
  }

  /** Multipart POST: fetch sets the multipart content-type with its boundary itself. */
  async function postMultipart<T>(path: string, form: FormData): Promise<T> {
    return json<T>(
      await fetch(`${cfg.serverUrl}${path}`, { method: 'POST', headers: authHeaders, body: form }),
    )
  }

  /** An NDJSON response, one value per line. */
  async function* stream<T>(method: string, path: string, body?: unknown): AsyncGenerator<T> {
    const res = await send(method, path, body)
    if (!res.ok || !res.body) throw await failure(res)
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

  async function binary(path: string): Promise<Uint8Array> {
    const res = await fetch(`${cfg.serverUrl}${path}`, { headers: authHeaders, redirect: 'error' })
    if (!res.ok) throw await failure(res)
    return new Uint8Array(await res.arrayBuffer())
  }

  return {
    codingEnvironment: {
      show: (teamId: string) =>
        request<CodingEnvironmentStatus>(
          'GET',
          `/api/teams/${encodeURIComponent(teamId)}/coding-environment`,
        ),
      set: (teamId: string, input: TeamCodingEnvironment) =>
        request<CodingEnvironmentStatus>(
          'PUT',
          `/api/teams/${encodeURIComponent(teamId)}/coding-environment`,
          input,
        ),
    },
    /** Git change review: changes since a base, diffs, and file feedback. */
    repositoryReview: (teamId: string) => {
      const base = `/api/teams/${encodeURIComponent(teamId)}/review`
      return {
        changes: (
          options: { base?: string; patches?: boolean; path?: string } = {},
        ): Promise<RepositoryReviewResponse> => {
          const params = new URLSearchParams()
          if (options.base !== undefined) params.set('base', options.base)
          if (options.patches) params.set('patches', '1')
          if (options.path !== undefined) params.set('path', options.path)
          const suffix = params.size ? `?${params}` : ''
          return request('GET', `${base}${suffix}`)
        },
        feedback: (input: ReviewFeedbackRequest): Promise<ReviewFeedbackResponse> =>
          request('POST', `${base}/feedback`, input),
      }
    },
    notifications: {
      settings: () => request<NotificationSettingsResponse>('GET', '/api/notifications'),
      configure: (input: NotificationSettings) =>
        request<NotificationSettingsResponse>('PUT', '/api/notifications', input),
    },
    questions: (agentId: string) => {
      const base = `/api/agents/${encodeURIComponent(agentId)}/questions`
      return {
        list: () => request<AgentQuestionListResponse>('GET', base),
        answer: (id: string, answer: AgentQuestionAnswer) =>
          request<{ ok: true }>('POST', `${base}/${encodeURIComponent(id)}/answer`, { answer }),
      }
    },
    queue: (agentId: string) => {
      const base = `/api/agents/${encodeURIComponent(agentId)}/queue`
      const item = (id: string) => `${base}/${encodeURIComponent(id)}`
      return {
        list: () => request<UserQueueListResponse>('GET', base),
        enqueue: (input: EnqueueUserInput) => request<UserQueueItem>('POST', base, input),
        edit: (id: string, message: string) =>
          request<UserQueueItem>('PATCH', item(id), { message }),
        remove: (id: string) => request<UserQueueItem>('DELETE', item(id)),
        pause: (paused: boolean) =>
          request<{ paused: boolean }>('POST', `${base}/control`, { paused }),
      }
    },
    /**
     * Managed browser controls. Status never launches; stop keeps the
     * profile; reset deletes it (cookies, logins), so callers confirm first.
     */
    getAgentBrowser: (agentId: string) =>
      request<BrowserStatus>('GET', `/api/agents/${encodeURIComponent(agentId)}/browser`),
    stopAgentBrowser: (agentId: string) =>
      request<void>('POST', `/api/agents/${encodeURIComponent(agentId)}/browser/stop`),
    resetAgentBrowser: (agentId: string) =>
      request<void>('DELETE', `/api/agents/${encodeURIComponent(agentId)}/browser/profile`),
    binary,
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

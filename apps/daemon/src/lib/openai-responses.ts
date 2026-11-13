// The few OpenAI calls the daemon makes itself (image generation, provider-hosted web search):
// a capped body reader, the provider's own error text, and one streamed Responses request.

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024

export type ResponseItem = Record<string, unknown>

/** A response body as text, refusing more than `maxBytes`. */
export async function readCapped(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error(`Response is larger than ${maxBytes} bytes`)
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Throw the provider's own status and message for a failed response. */
export async function assertOk(response: Response): Promise<void> {
  if (response.ok) return
  const body = await readCapped(response, 64 * 1024).catch(() => '')
  throw new Error(`HTTP ${response.status}: ${body.trim().slice(0, 300) || response.statusText}`)
}

/** Headers for the ChatGPT (Codex) backend; the account id is in the login's access token. */
export function codexHeaders(token: string): Record<string, string> {
  let account: unknown
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
    account = payload['https://api.openai.com/auth']?.chatgpt_account_id
  } catch {}
  return {
    authorization: `Bearer ${token}`,
    originator: 'pi',
    'OpenAI-Beta': 'responses=experimental',
    ...(typeof account === 'string' ? { 'chatgpt-account-id': account } : {}),
  }
}

function eventError(event: Record<string, unknown>): string {
  const response = event.response as Record<string, unknown> | undefined
  const error = (event.error ?? response?.error) as { message?: unknown } | undefined
  const detail =
    event.message ??
    error?.message ??
    (response?.incomplete_details as { reason?: unknown } | undefined)?.reason
  return `${String(event.type)}${typeof detail === 'string' ? `: ${detail}` : ''}`
}

/**
 * POST a streamed Responses request and return the output items of the completed response. The
 * ChatGPT backend can end with an empty `output`; the items streamed as `output_item.done` are the
 * output then.
 */
export async function responsesStream(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ResponseItem[]> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ ...body, stream: true, store: false }),
    signal,
    redirect: 'error',
  })
  await assertOk(response)
  const streamed: ResponseItem[] = []
  let completed: ResponseItem[] | undefined
  for (const frame of (await readCapped(response)).replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') continue
    const event = JSON.parse(data) as Record<string, unknown>
    if (['error', 'response.failed', 'response.incomplete'].includes(String(event.type)))
      throw new Error(eventError(event))
    if (event.type === 'response.output_item.done' && event.item)
      streamed.push(event.item as ResponseItem)
    if (event.type === 'response.completed' || event.type === 'response.done') {
      const output = (event.response as { output?: unknown } | undefined)?.output
      completed = Array.isArray(output) ? (output as ResponseItem[]) : []
    }
  }
  if (!completed) throw new Error('The response stream ended before the response completed')
  return completed.length ? completed : streamed
}

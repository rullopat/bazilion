// Transient-error retry wrapper for Provider.chat().
//
// Applied uniformly in `createProviderRegistry` so every provider (anthropic,
// openai, openai-codex, lmstudio, ollama, …) gets the same retry policy. A
// one-shot upstream 5xx or rate-limit shouldn't kill the agent's turn — the
// runtime marks the run `failed` and the user is stuck re-sending the same
// message by hand, which is hostile UX.
//
// What counts as retryable is a small allowlist (server 5xx, rate-limit, a
// handful of network errnos). Auth errors, invalid-request errors, context
// overflows, and user-triggered aborts bypass retry entirely — they won't
// resolve by trying again and the fast failure is the right signal.
//
// One hard rule: if the underlying chat already streamed text back via
// onDelta, we can't retry — a second attempt would emit duplicated text into
// the UI. The wrapper detects this by shadowing onDelta and tracking whether
// the callback fired.

import type { Provider, ProviderRequest, ProviderResponse } from './types.ts'

export interface RetryOptions {
  /** How many *extra* attempts beyond the first. Default 2 → up to 3 tries total. */
  maxRetries?: number
  /** First backoff delay in ms. Doubles each retry up to maxDelayMs. Default 500. */
  initialDelayMs?: number
  /** Upper bound on a single backoff delay. Default 8000. */
  maxDelayMs?: number
  /** Optional callback invoked before each retry (for logging / telemetry). */
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void
}

/**
 * Lowercased substrings that mark an error as worth retrying. Checked with a
 * simple `includes` so we don't need to parse the upstream JSON shapes.
 */
const RETRYABLE_MARKERS: readonly string[] = [
  'server_error',
  'internal_server',
  'rate_limit',
  'rate limit',
  'too many requests',
  'overloaded', // covers 'overloaded_error' (Anthropic)
  'service_unavailable',
  'service unavailable',
  'gateway_timeout',
  'gateway timeout',
  'bad_gateway',
  'bad gateway',
  'econnreset',
  'etimedout',
  'econnrefused',
  'enotfound',
  'eai_again',
  'socket hang up',
  'fetch failed',
  'network error',
  'connection reset',
  'status 429',
  'status 500',
  'status 502',
  'status 503',
  'status 504',
  '"status":429',
  '"status":500',
  '"status":502',
  '"status":503',
  '"status":504',
]

/**
 * Non-retryable markers win over retryable ones — if an error mentions
 * authentication or a 4xx (other than 429), retrying won't help.
 */
const NON_RETRYABLE_MARKERS: readonly string[] = [
  'invalid_api_key',
  'invalid api key',
  'incorrect_api_key',
  'authentication',
  'unauthorized',
  'permission_denied',
  'permission denied',
  'forbidden',
  'invalid_request',
  'invalid request',
  'not_found',
  'model_not_found',
  'context_length_exceeded',
  'context length',
  'content_filter',
  'quota_exceeded',
  'insufficient_quota',
  'billing',
  'status 400',
  'status 401',
  'status 403',
  'status 404',
  'status 422',
]

export function isRetryableError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const msg = raw.toLowerCase()
  for (const deny of NON_RETRYABLE_MARKERS) {
    if (msg.includes(deny)) return false
  }
  for (const allow of RETRYABLE_MARKERS) {
    if (msg.includes(allow)) return true
  }
  return false
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function withRetry(provider: Provider, opts: RetryOptions = {}): Provider {
  const maxRetries = opts.maxRetries ?? 2
  const initialDelayMs = opts.initialDelayMs ?? 500
  const maxDelayMs = opts.maxDelayMs ?? 8_000

  return {
    name: provider.name,
    async chat(req: ProviderRequest): Promise<ProviderResponse> {
      let attempt = 0
      // Use `let` so each retry gets a fresh shadow; we need to know whether
      // onDelta fired on the *most recent* attempt.
      let lastError: Error | null = null
      while (true) {
        let streamed = false
        const wrappedReq: ProviderRequest = req.onDelta
          ? {
              ...req,
              onDelta: (delta: string) => {
                streamed = true
                req.onDelta?.(delta)
              },
            }
          : req
        try {
          return await provider.chat(wrappedReq)
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          if (req.signal?.aborted) throw lastError
          if (streamed) throw lastError
          if (attempt >= maxRetries) throw lastError
          if (!isRetryableError(lastError)) throw lastError
          const delayMs = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs)
          opts.onRetry?.({ attempt: attempt + 1, delayMs, error: lastError })
          try {
            await sleepWithAbort(delayMs, req.signal)
          } catch {
            // Aborted during backoff — surface the original provider error
            // rather than the synthetic abort so the run's failure reason
            // still points at what actually went wrong.
            throw lastError
          }
          attempt++
        }
      }
    },
  }
}

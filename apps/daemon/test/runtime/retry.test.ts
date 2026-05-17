import { describe, expect, test, vi } from 'vitest'
import { isRetryableError, withRetry } from '../../src/runtime/providers/retry.ts'
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/runtime/providers/types.ts'

function okResponse(text = 'ok'): ProviderResponse {
  return { content: text, toolCalls: [], stopReason: 'stop' }
}

function scripted(outcomes: Array<() => Promise<ProviderResponse>>): Provider {
  let i = 0
  return {
    name: 'mock',
    async chat(_req: ProviderRequest) {
      const fn = outcomes[i++]
      if (!fn) throw new Error('scripted provider: out of outcomes')
      return await fn()
    },
  }
}

const baseReq: ProviderRequest = { model: 'm', messages: [] }

describe('isRetryableError', () => {
  test('allows transient 5xx / rate-limit / socket markers', () => {
    expect(isRetryableError(new Error('Codex error: {"type":"server_error"}'))).toBe(true)
    expect(isRetryableError(new Error('rate_limit_exceeded'))).toBe(true)
    expect(isRetryableError(new Error('overloaded_error: too many requests'))).toBe(true)
    expect(isRetryableError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true)
    expect(isRetryableError(new Error('status 503 service_unavailable'))).toBe(true)
  })

  test('blocks auth / invalid-request / context-overflow / 4xx', () => {
    expect(isRetryableError(new Error('invalid_api_key'))).toBe(false)
    expect(isRetryableError(new Error('authentication failed'))).toBe(false)
    expect(isRetryableError(new Error('status 401 unauthorized'))).toBe(false)
    expect(isRetryableError(new Error('context_length_exceeded'))).toBe(false)
    expect(isRetryableError(new Error('model_not_found'))).toBe(false)
    expect(isRetryableError(new Error('insufficient_quota'))).toBe(false)
  })

  test('deny-list wins when both markers appear', () => {
    // A 429 that also mentions authentication: don't retry — the auth
    // failure is the load-bearing signal.
    expect(isRetryableError(new Error('status 429 after authentication failure'))).toBe(false)
  })

  test('unknown errors are not retried by default', () => {
    expect(isRetryableError(new Error('random client bug'))).toBe(false)
    expect(isRetryableError(new Error(''))).toBe(false)
  })
})

describe('withRetry', () => {
  test('passes through on first-try success', async () => {
    const p = withRetry(scripted([() => Promise.resolve(okResponse('hi'))]))
    const res = await p.chat(baseReq)
    expect(res.content).toBe('hi')
  })

  test('recovers after a transient server_error', async () => {
    const onRetry = vi.fn()
    const p = withRetry(
      scripted([
        () => Promise.reject(new Error('Codex error: server_error')),
        () => Promise.resolve(okResponse('recovered')),
      ]),
      { initialDelayMs: 1, onRetry },
    )
    const res = await p.chat(baseReq)
    expect(res.content).toBe('recovered')
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0]?.[0]?.attempt).toBe(1)
  })

  test('gives up after maxRetries + 1 attempts', async () => {
    let calls = 0
    const p = withRetry(
      {
        name: 'mock',
        async chat() {
          calls++
          throw new Error('rate_limit')
        },
      },
      { maxRetries: 2, initialDelayMs: 1 },
    )
    await expect(p.chat(baseReq)).rejects.toThrow(/rate_limit/)
    expect(calls).toBe(3)
  })

  test('does not retry non-retryable errors', async () => {
    let calls = 0
    const p = withRetry(
      {
        name: 'mock',
        async chat() {
          calls++
          throw new Error('invalid_api_key')
        },
      },
      { maxRetries: 5, initialDelayMs: 1 },
    )
    await expect(p.chat(baseReq)).rejects.toThrow(/invalid_api_key/)
    expect(calls).toBe(1)
  })

  test('does not retry after text has streamed', async () => {
    // First attempt streams a token, then errors — retry would duplicate the
    // token in the UI, so the wrapper must surface the error as-is.
    let calls = 0
    const p = withRetry(
      {
        name: 'mock',
        async chat(req) {
          calls++
          req.onDelta?.('partial...')
          throw new Error('server_error: stream broke mid-way')
        },
      },
      { maxRetries: 3, initialDelayMs: 1 },
    )
    const deltas: string[] = []
    await expect(p.chat({ ...baseReq, onDelta: (d) => deltas.push(d) })).rejects.toThrow(
      /server_error/,
    )
    expect(calls).toBe(1)
    expect(deltas).toEqual(['partial...'])
  })

  test('aborts immediately if the caller signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    let calls = 0
    const p = withRetry(
      {
        name: 'mock',
        async chat() {
          calls++
          throw new Error('server_error')
        },
      },
      { initialDelayMs: 1 },
    )
    await expect(p.chat({ ...baseReq, signal: ac.signal })).rejects.toThrow()
    expect(calls).toBe(1) // one attempt, then abort check skips the retry
  })

  test('abort during backoff surfaces the original error', async () => {
    const ac = new AbortController()
    const p = withRetry(
      {
        name: 'mock',
        async chat() {
          throw new Error('server_error: upstream blew up')
        },
      },
      { maxRetries: 3, initialDelayMs: 100 },
    )
    // Abort 10ms into the 100ms backoff.
    setTimeout(() => ac.abort(), 10)
    await expect(p.chat({ ...baseReq, signal: ac.signal })).rejects.toThrow(
      /server_error: upstream blew up/,
    )
  })

  test('backoff grows exponentially up to maxDelayMs', async () => {
    const delays: number[] = []
    const p = withRetry(
      {
        name: 'mock',
        async chat() {
          throw new Error('server_error')
        },
      },
      {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 250,
        onRetry: (info) => delays.push(info.delayMs),
      },
    )
    await expect(p.chat(baseReq)).rejects.toThrow()
    // 100, 200, min(400, 250) = 250
    expect(delays).toEqual([100, 200, 250])
  })
})

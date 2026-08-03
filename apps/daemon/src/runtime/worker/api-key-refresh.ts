import type { WorkerIpcCall } from './ipc-client.ts'
import type { ApiKeyRefreshArgs, ApiKeyRefreshHost } from './ipc-protocol.ts'

export interface ApiKeyRefreshTurnContext {
  providerName: string
  agentId: string
  turnId: string
}

/** Build the worker-side callback passed to pi's `createBazilionSession`. */
export function createIpcApiKeyRefresher(
  call: WorkerIpcCall,
  context: ApiKeyRefreshTurnContext,
): (providerName: string) => Promise<string> {
  return async (providerName) => {
    assertOpenAICodexProvider(providerName, context.providerName)
    return call<string>('refreshApiKey', {
      providerName,
      agentId: context.agentId,
      turnId: context.turnId,
    } satisfies ApiKeyRefreshArgs)
  }
}

/**
 * Validate and execute one daemon-side refresh request. This is deliberately
 * separate from the generic IPC dispatcher so the credential-bearing result
 * cannot accidentally enter the stdout `ChatFrame` queue.
 */
export async function refreshApiKeyForTurn(
  args: ApiKeyRefreshArgs,
  context: ApiKeyRefreshTurnContext,
  host: ApiKeyRefreshHost | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (args.agentId !== context.agentId || args.turnId !== context.turnId) {
    throw new Error('API key refresh request does not belong to this worker turn')
  }
  assertOpenAICodexProvider(args.providerName, context.providerName)
  if (!host) throw new Error('OpenAI Codex refresh is unavailable for this worker turn')
  if (signal?.aborted) throw refreshCancelledError()

  let token: string
  try {
    const pending = host.refresh(args.providerName, signal)
    token = await waitForRefresh(pending, signal)
  } catch (error) {
    if (error instanceof ApiKeyRefreshCancelledError) throw error
    // OAuth libraries and HTTP clients can include request context in their
    // errors. Never forward that detail across IPC where it could become a
    // model- or user-visible authentication error.
    throw new Error('OpenAI Codex access token refresh failed — reconnect on /config and retry')
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('API key refresh returned an invalid token')
  }
  return token
}

function assertOpenAICodexProvider(requested: string, expected: string): void {
  if (expected !== 'openai-codex' || requested !== expected) {
    throw new Error('unexpected API key refresh provider')
  }
}

function waitForRefresh(pending: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(refreshCancelledError()))

    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    pending.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

class ApiKeyRefreshCancelledError extends Error {}

function refreshCancelledError(): ApiKeyRefreshCancelledError {
  return new ApiKeyRefreshCancelledError('API key refresh cancelled with the worker turn')
}

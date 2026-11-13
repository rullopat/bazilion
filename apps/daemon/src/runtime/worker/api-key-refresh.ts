import type { ApiKeyRefreshHost } from './ipc-protocol.ts'

/**
 * Serve one worker's `refreshApiKey` call: only for the turn's own provider, never after the
 * turn ended, and with a fixed error message, because OAuth and HTTP clients can put request
 * details in theirs. The token travels only in the private IPC reply, never in a chat frame.
 */
export async function refreshApiKeyForTurn(
  requestedProvider: string,
  turnProvider: string,
  host: ApiKeyRefreshHost | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (!turnProvider || requestedProvider !== turnProvider) {
    throw new Error('unexpected API key refresh provider')
  }
  if (!host) throw new Error('provider credential refresh is unavailable for this worker turn')
  if (signal?.aborted) throw refreshCancelledError()

  let token: string
  try {
    token = await waitForRefresh(host.refresh(requestedProvider, signal), signal)
  } catch (error) {
    if (error instanceof ApiKeyRefreshCancelledError) throw error
    throw new Error('provider credential refresh failed — reconnect on /config and retry')
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('API key refresh returned an invalid token')
  }
  return token
}

function waitForRefresh(pending: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(refreshCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

class ApiKeyRefreshCancelledError extends Error {}

function refreshCancelledError(): ApiKeyRefreshCancelledError {
  return new ApiKeyRefreshCancelledError('API key refresh cancelled with the worker turn')
}

import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import type { AuthPrompt } from '@earendil-works/pi-ai'

export const OPENAI_CODEX_CALLBACK_PORT = 1455
export const WEB_OPENAI_LOGIN_TIMEOUT_MS = 10 * 60_000
const DEVICE_CODE_FALLBACK =
  '`bazilion auth openai login --device-code` (or, from the repository root of a source checkout, ' +
  '`pnpm tsx apps/cli/src/index.ts auth openai login --device-code`)'

export class OpenAICodexCallbackUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAICodexCallbackUnavailableError'
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('OpenAI browser login cancelled', 'AbortError')
}

function callbackAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export function openAICodexCallbackHost(
  env: { PI_OAUTH_CALLBACK_HOST?: string } = process.env,
): string {
  return env.PI_OAUTH_CALLBACK_HOST?.trim() || '127.0.0.1'
}

function callbackUnavailable(error: unknown, host: string, port: number): Error {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null
  const address = callbackAddress(host, port)
  if (code === 'EADDRINUSE') {
    return new OpenAICodexCallbackUnavailableError(
      `OpenAI browser login cannot start because callback address ${address} is already in use. ` +
        'Stop the process using that port and try again, or run ' +
        `${DEVICE_CODE_FALLBACK} in a terminal.`,
    )
  }
  return new OpenAICodexCallbackUnavailableError(
    `OpenAI browser login cannot bind callback address ${address}${code ? ` (${code})` : ''}. ` +
      'Check PI_OAUTH_CALLBACK_HOST and try again, or run ' +
      `${DEVICE_CODE_FALLBACK} in a terminal.`,
  )
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

/**
 * Pi currently turns a callback bind error into an empty callback result, so
 * the web request otherwise waits for manual input that the web UI cannot
 * provide. Briefly claim and release the exact callback socket first so an
 * occupied port fails immediately with a usable fallback.
 */
export async function preflightOpenAICodexCallback(options?: {
  host?: string
  port?: number
}): Promise<void> {
  const host = options?.host ?? openAICodexCallbackHost()
  const port = options?.port ?? OPENAI_CODEX_CALLBACK_PORT
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        server.removeListener('error', onError)
        server.removeListener('listening', onListening)
      }
      const onError = (error: Error) => {
        cleanup()
        reject(callbackUnavailable(error, host, port))
      }
      const onListening = () => {
        cleanup()
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      try {
        server.listen({ host, port, exclusive: true })
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    })
  } finally {
    await closeServer(server)
  }
}

export interface WebOpenAILoginLifetime {
  signal: AbortSignal
  abort(reason: Error): void
  dispose(): void
}

/** Combine the HTTP request lifetime with a bounded web OAuth window. */
export function createWebOpenAILoginLifetime(
  requestSignal?: AbortSignal,
  timeoutMs = WEB_OPENAI_LOGIN_TIMEOUT_MS,
): WebOpenAILoginLifetime {
  const controller = new AbortController()
  let disposed = false
  const abort = (reason: Error) => {
    if (!disposed && !controller.signal.aborted) controller.abort(reason)
  }
  const onRequestAbort = () => {
    if (requestSignal) abort(abortReason(requestSignal))
  }
  if (requestSignal?.aborted) onRequestAbort()
  else requestSignal?.addEventListener('abort', onRequestAbort, { once: true })

  const timeout = setTimeout(() => {
    abort(
      new DOMException(
        `OpenAI browser login timed out after 10 minutes. Try again, or run ${DEVICE_CODE_FALLBACK}.`,
        'TimeoutError',
      ),
    )
  }, timeoutMs)
  timeout.unref()

  return {
    signal: controller.signal,
    abort,
    dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(timeout)
      requestSignal?.removeEventListener('abort', onRequestAbort)
    },
  }
}

export interface OAuthBrowserProcess {
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  unref(): void
}

export type OAuthBrowserSpawn = (command: string, args: string[]) => OAuthBrowserProcess

function defaultBrowserSpawn(command: string, args: string[]): OAuthBrowserProcess {
  return spawn(command, args, { stdio: 'ignore', detached: true })
}

function browserLaunchFailure(command: string, detail: string): Error {
  return new Error(
    `Could not open the OpenAI sign-in page with ${command}: ${detail}. ` +
      `Run ${DEVICE_CODE_FALLBACK} in a terminal.`,
  )
}

/** Launch the OAuth URL and report both spawn errors and non-zero exits. */
export function launchOpenAICodexBrowser(
  url: string,
  onFailure: (error: Error) => void,
  options?: { platform?: NodeJS.Platform; spawnBrowser?: OAuthBrowserSpawn },
): void {
  const platform = options?.platform ?? process.platform
  const [command, ...args] =
    platform === 'darwin'
      ? ['open', url]
      : platform === 'win32'
        ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
        : ['xdg-open', url]
  let failed = false
  const fail = (error: Error) => {
    if (failed) return
    failed = true
    onFailure(error)
  }

  try {
    const child = (options?.spawnBrowser ?? defaultBrowserSpawn)(command as string, args)
    child.once('error', (error) => {
      fail(browserLaunchFailure(command as string, error.message))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) return
      const detail =
        code === null ? `terminated by ${signal ?? 'an unknown signal'}` : `exited ${code}`
      fail(browserLaunchFailure(command as string, detail))
    })
    child.unref()
  } catch (error) {
    fail(
      browserLaunchFailure(
        command as string,
        error instanceof Error ? error.message : String(error),
      ),
    )
  }
}

let webOpenAILoginTail = Promise.resolve()

function waitForLoginTurn(turn: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return turn
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void turn.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

/** Acquire the process-wide web OAuth slot; callers must release in finally. */
export async function acquireWebOpenAILogin(signal?: AbortSignal): Promise<() => void> {
  const previous = webOpenAILoginTail
  let releaseGate: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  webOpenAILoginTail = previous.then(() => gate)

  try {
    await waitForLoginTurn(previous, signal)
  } catch (error) {
    // Keep the queue ordered even when this waiter goes away before its turn.
    void previous.then(releaseGate)
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    releaseGate()
  }
}

/**
 * The browser flow races a manual-code prompt against Pi's localhost callback
 * server. The web UI has no place to paste that code, so keep the prompt
 * pending until Pi aborts it after the callback path has won. Rejecting it
 * immediately cancels the callback wait and makes an otherwise successful
 * browser login fail.
 */
export function answerWebOpenAIPrompt(
  prompt: AuthPrompt,
  loginSignal?: AbortSignal,
): Promise<string> {
  if (prompt.type === 'select') {
    const browser = prompt.options.find((option) => option.id === 'browser')
    return browser
      ? Promise.resolve(browser.id)
      : Promise.reject(new Error('Pi openai-codex provider does not support browser login'))
  }
  if (prompt.type !== 'manual_code') {
    return Promise.reject(
      new Error(
        'interactive paste not supported in the web flow — cancel and try again, or use `bazilion auth openai login`',
      ),
    )
  }

  return new Promise<string>((_resolve, reject) => {
    const promptSignal = prompt.signal
    // Pi currently always supplies a signal for this raced prompt. If an
    // older/newer provider omits it, an unresolved promise is still safe: it
    // owns no event-loop handle and the localhost callback remains in charge.
    if (!promptSignal && !loginSignal) return

    let settled = false
    const cleanup = () => {
      promptSignal?.removeEventListener('abort', onPromptAbort)
      loginSignal?.removeEventListener('abort', onLoginAbort)
    }
    const cancel = (signal: AbortSignal) => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortReason(signal))
    }
    const onPromptAbort = () => {
      if (promptSignal) cancel(promptSignal)
    }
    const onLoginAbort = () => {
      if (loginSignal) cancel(loginSignal)
    }
    if (loginSignal?.aborted) {
      onLoginAbort()
      return
    }
    if (promptSignal?.aborted) {
      onPromptAbort()
      return
    }
    promptSignal?.addEventListener('abort', onPromptAbort, { once: true })
    loginSignal?.addEventListener('abort', onLoginAbort, { once: true })
  })
}

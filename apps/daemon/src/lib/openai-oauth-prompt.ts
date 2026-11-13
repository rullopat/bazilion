// The web "Connect ChatGPT" flow runs Pi's OAuth login inside the daemon: Pi listens for the
// browser callback on 127.0.0.1:1455 while the operator signs in.

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import type { AuthPrompt } from '@earendil-works/pi-ai'

const OPENAI_CODEX_CALLBACK_PORT = 1455
export const WEB_OPENAI_LOGIN_TIMEOUT_MS = 10 * 60_000
const DEVICE_CODE_FALLBACK = '`bazilion auth openai login --device-code` in a terminal'

/**
 * Pi turns a callback bind failure into a wait for a pasted code, which the web UI cannot send.
 * Claim and release the callback address first so an occupied port fails at once.
 */
export async function preflightOpenAICodexCallback(
  host = process.env.PI_OAUTH_CALLBACK_HOST?.trim() || '127.0.0.1',
  port = OPENAI_CODEX_CALLBACK_PORT,
): Promise<void> {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host, port, exclusive: true }, resolve)
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const address = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
    throw new Error(
      code === 'EADDRINUSE'
        ? `OpenAI browser login cannot start because callback address ${address} is already in use. Stop the process using that port and try again, or run ${DEVICE_CODE_FALLBACK}.`
        : `OpenAI browser login cannot bind callback address ${address}${code ? ` (${code})` : ''}. Check PI_OAUTH_CALLBACK_HOST and try again, or run ${DEVICE_CODE_FALLBACK}.`,
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** Open the sign-in page on this machine; `onFailure` hears about an opener that failed. */
export function launchOpenAICodexBrowser(url: string, onFailure: (error: Error) => void): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const fail = (detail: string) =>
    onFailure(
      new Error(
        `Could not open the OpenAI sign-in page with ${command}: ${detail}. Run ${DEVICE_CODE_FALLBACK}.`,
      ),
    )
  const child = spawn(command, [url], { stdio: 'ignore', detached: true })
  child.once('error', (error) => fail(error.message))
  child.once('exit', (code, signal) => {
    if (code !== 0) fail(code === null ? `terminated by ${signal}` : `exited ${code}`)
  })
  child.unref()
}

/**
 * Answer Pi's login prompts for the web flow: choose browser login, and leave the pasted-code
 * prompt pending, since the web UI has nowhere to paste. Rejecting it early would cancel Pi's wait
 * for the browser callback, so it rejects only when Pi withdraws it (aborting its signal once the
 * callback arrives) or when `login` ends (timeout, request gone, opener failure). The login
 * signal matters when Pi has no callback server: Pi then waits on this prompt alone.
 */
export function answerWebOpenAIPrompt(prompt: AuthPrompt, login: AbortSignal): Promise<string> {
  if (prompt.type === 'select') {
    return prompt.options.some((option) => option.id === 'browser')
      ? Promise.resolve('browser')
      : Promise.reject(new Error('Pi openai-codex provider does not support browser login'))
  }
  if (prompt.type !== 'manual_code') {
    return Promise.reject(
      new Error(`Interactive input is not supported in the web flow. Run ${DEVICE_CODE_FALLBACK}.`),
    )
  }
  const ended = prompt.signal ? AbortSignal.any([prompt.signal, login]) : login
  return new Promise((_resolve, reject) => {
    const stop = () => reject(new Error('OpenAI browser login ended'))
    if (ended.aborted) stop()
    else ended.addEventListener('abort', stop, { once: true })
  })
}

/** The message for a web login that failed, naming the timeout or opener failure behind it. */
export function webOpenAILoginError(error: unknown, signal: AbortSignal): string {
  const reason: unknown = signal.aborted ? signal.reason : error
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return `OpenAI browser login timed out after 10 minutes. Try again, or run ${DEVICE_CODE_FALLBACK}.`
  }
  return reason instanceof Error ? reason.message : String(reason)
}

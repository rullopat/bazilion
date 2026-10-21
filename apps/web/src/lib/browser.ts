// Server functions for the Agent browser card. These run on the server and
// forward the caller's session/CSRF cookies through daemonClient — never a
// bootstrap/device bearer from the browser bundle.

import { ApiClientError } from '@bazilion/client'
import type { BrowserStatus } from '@bazilion/api-types'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

export interface BrowserActionFailure {
  code?: string
  message: string
}

export type AgentBrowserView =
  | { status: BrowserStatus; unavailable: null }
  | { status: null; unavailable: BrowserActionFailure }

function failure(error: unknown, fallback: string): BrowserActionFailure {
  if (error instanceof ApiClientError) {
    const body = error.body as { error?: string; code?: string }
    return { ...(body.code ? { code: body.code } : {}), message: body.error ?? fallback }
  }
  throw error
}

export const fetchAgentBrowser = createServerFn({ method: 'POST' })
  .validator((input: { agentId: string }) => input)
  .handler(async ({ data }): Promise<AgentBrowserView> => {
    try {
      const status = await daemonClient().get<BrowserStatus>(
        `/api/agents/${encodeURIComponent(data.agentId)}/browser`,
      )
      return { status, unavailable: null }
    } catch (error) {
      return { status: null, unavailable: failure(error, 'Browser status is unavailable.') }
    }
  })

export const stopAgentBrowser = createServerFn({ method: 'POST' })
  .validator((input: { agentId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; failure: BrowserActionFailure }> => {
    try {
      await daemonClient().post<void>(
        `/api/agents/${encodeURIComponent(data.agentId)}/browser/stop`,
      )
      return { ok: true }
    } catch (error) {
      return { ok: false, failure: failure(error, 'Could not stop the browser session.') }
    }
  })

export const resetAgentBrowser = createServerFn({ method: 'POST' })
  .validator((input: { agentId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; failure: BrowserActionFailure }> => {
    try {
      await daemonClient().del<void>(
        `/api/agents/${encodeURIComponent(data.agentId)}/browser/profile?confirm=reset-browser-profile`,
      )
      return { ok: true }
    } catch (error) {
      return { ok: false, failure: failure(error, 'Could not reset the browser profile.') }
    }
  })

// The login and first-run gate the root route applies before every page.

import type { AuthenticatedOwnerResponse } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

export interface AuthState {
  authed: boolean
  setupComplete: boolean
}

export const fetchAuthState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthState> => {
    try {
      const whoami = await daemonClient().get<AuthenticatedOwnerResponse>('/api/auth/whoami')
      return { authed: whoami.authenticated, setupComplete: whoami.setupComplete }
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        return { authed: false, setupComplete: false }
      }
      // Any other failure (the daemon is down) lets the page load and show its own error.
      return { authed: true, setupComplete: true }
    }
  },
)

/** Pages reachable without a session. */
export const PUBLIC_PATHS = new Set(['/login'])

// Before the first provider has a model, only these pages are reachable; the rest redirect to
// /welcome.
const SETUP_OPEN_PREFIXES = ['/welcome', '/config']

export function isSetupOpen(path: string): boolean {
  return SETUP_OPEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

// Auth + first-run gate plumbing.
//
// `fetchAuthState` is a server fn that pings the daemon's /api/auth/me with
// the current request's bz_token cookie. It returns a typed result the root
// route's `beforeLoad` consumes to decide whether to redirect (`/login` for
// unauthenticated, `/welcome` until setup is complete). Keeping the daemon
// call in a server fn means the client bundle never ships the daemon URL or
// cookie machinery.

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
      const res = await daemonClient().get<{ authed: boolean; setupComplete: boolean }>(
        '/api/auth/me',
      )
      return { authed: res.authed, setupComplete: res.setupComplete }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        return { authed: false, setupComplete: false }
      }
      throw err
    }
  },
)

// Reachable without a token. The login form posts here (well, to /api/login).
// Note: /api/* is handled by the catch-all proxy + daemon's own auth, so we
// don't gate it from beforeLoad — it shortcircuits before the auth fetch.
export const PUBLIC_PATHS = new Set(['/login'])

// Authenticated users can still reach these prefixes before setup is done.
// Everything else redirects to /welcome until at least one provider has ≥1
// curated model.
const SETUP_OPEN_PREFIXES = ['/welcome', '/config']

export function isSetupOpen(path: string): boolean {
  for (const prefix of SETUP_OPEN_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true
  }
  return false
}

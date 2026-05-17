// SSR-side daemon client for TanStack Start. SERVER-ONLY — do not import
// from any code path that ends up in the client bundle. The `getCookie`
// dependency reads request-scoped storage that doesn't exist in the
// browser, and Vite's import-protection enforces this at build time.
//
// For client-safe wire constants (DEFAULT_GROUP_ID, REASONING_LEVELS, …)
// import from `./wire-constants` instead.
//
// Server fns and route loaders running on the server can call
// `daemonClient()` to get a `BazilionClient` that auto-forwards the
// current request's `bz_token` cookie as a Bearer token to the daemon.
// That keeps daemon audit logs reflecting the actual user identity end
// to end, and lets the daemon's middleware do the auth + first-run check
// uniformly.
//
// Usage inside a server fn or beforeLoad:
//
//   import { createServerFn } from '@tanstack/react-start'
//   import { daemonClient } from '~/lib/daemon-client'
//
//   const listAgents = createServerFn({ method: 'GET' })
//     .handler(() => daemonClient().get<Agent[]>('/api/agents'))

import { type BazilionClient, createClient } from '@bazilion/client'
import { getCookie } from '@tanstack/react-start/server'

const DAEMON_URL = process.env.BAZILION_DAEMON ?? 'http://127.0.0.1:4321'

export function daemonClient(): BazilionClient {
  const token = getCookie('bz_token') ?? ''
  return createClient({ serverUrl: DAEMON_URL, token })
}

export const DAEMON_BASE_URL = DAEMON_URL

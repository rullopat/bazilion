// Server-only daemon client for route loaders (Vite's import protection keeps it out of the
// client bundle; browser code calls /api through lib/api.ts). It forwards the browser's session
// cookie and nothing else, so loaders can read; every write goes through the /api forwarder.

import { publicOriginConfig } from '@bazilion/api-types'
import { type BazilionClient, createClient } from '@bazilion/client'
import { getCookie } from '@tanstack/react-start/server'

export const DAEMON_BASE_URL = process.env.BAZILION_DAEMON ?? 'http://127.0.0.1:4321'

export function daemonClient(): BazilionClient {
  const { sessionCookie } = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
  const session = getCookie(sessionCookie)
  return createClient({
    serverUrl: DAEMON_BASE_URL,
    token: null,
    headers: session ? { cookie: `${sessionCookie}=${session}` } : {},
  })
}

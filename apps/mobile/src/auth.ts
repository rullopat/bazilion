import { type BazilionClient, createClient } from '@bazilion/client'
import * as SecureStore from 'expo-secure-store'

const KEY_SERVER = 'bazilion.server'
const KEY_TOKEN = 'bazilion.token'

export interface Credentials {
  server: string
  token: string
}

export async function loadCredentials(): Promise<Credentials | null> {
  const [server, token] = await Promise.all([
    SecureStore.getItemAsync(KEY_SERVER),
    SecureStore.getItemAsync(KEY_TOKEN),
  ])
  if (!server || !token) return null
  return { server, token }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_SERVER, creds.server),
    SecureStore.setItemAsync(KEY_TOKEN, creds.token),
  ])
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_SERVER),
    SecureStore.deleteItemAsync(KEY_TOKEN),
  ])
}

/**
 * Probe the daemon so we surface a clear error on the pairing screen instead
 * of a confusing network failure on the first protected request. 5-second
 * timeout because the daemon is a local-network service — if it can't answer
 * in that long, something's wrong.
 */
export async function verifyCredentials(creds: Credentials): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${creds.server}/api/auth/whoami`, {
      headers: {
        authorization: `Bearer ${creds.token}`,
        origin: creds.server,
      },
      signal: ctrl.signal,
    })
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      if (body.code === 'credential_expired') throw new Error('device credential expired')
      if (body.code === 'credential_revoked') throw new Error('device credential was revoked')
      throw new Error('server rejected the device credential')
    }
    if (res.status === 403) throw new Error('server rejected the configured private origin')
    if (!res.ok) throw new Error(`server returned ${res.status} from /api/auth/whoami`)
    const owner = (await res.json()) as { publicOrigin?: string | null }
    if (owner.publicOrigin && owner.publicOrigin !== new URL(creds.server).origin) {
      throw new Error('pairing URL does not match the server canonical private origin')
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`could not reach ${creds.server} within 5s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function clientFor(creds: Credentials): BazilionClient {
  return createClient({ serverUrl: creds.server, token: creds.token })
}

import { type BazilionClient, createClient as createPackageClient } from '@bazilion/client'
import { readAuthFile } from './auth-file.ts'
import { resolveCliPaths } from './paths.ts'

export type { BazilionClient } from '@bazilion/client'
export { ApiClientError } from '@bazilion/client'

export interface ClientConfig {
  serverUrl: string
  token: string
}

export function loadClientConfig(): ClientConfig {
  const envUrl = process.env.BAZILION_SERVER
  const envToken = process.env.BAZILION_TOKEN
  if (envUrl && envToken) return { serverUrl: envUrl, token: envToken }

  const paths = resolveCliPaths()
  const auth = readAuthFile(paths.authFile)
  // `bazilion login` writes `remote`; when present it targets another host
  // (Tailscale, LAN). Env vars still win so CI / ad-hoc invocations can
  // override without editing auth.json.
  if (auth.remote?.server && auth.remote.token) {
    return {
      serverUrl: envUrl ?? auth.remote.server,
      token: auth.remote.token,
    }
  }
  return {
    serverUrl: envUrl ?? 'http://127.0.0.1:4321',
    token: auth.token,
  }
}

export function createClient(cfg: ClientConfig = loadClientConfig()): BazilionClient {
  return createPackageClient({ serverUrl: cfg.serverUrl, token: cfg.token })
}

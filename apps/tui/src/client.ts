import { type BazilionClient, createClient as createPackageClient } from '@bazilion/client'
import { readAuthFile } from './auth-file.ts'
import { resolveTuiPaths } from './paths.ts'

export type { BazilionClient } from '@bazilion/client'
export { ApiClientError } from '@bazilion/client'

export interface ClientConfig {
  serverUrl: string
  token: string
}

// Mirrors `apps/cli/src/client.ts:loadClientConfig` deliberately — the TUI and
// CLI share the same fallback chain (env → auth.remote → loopback) so a user
// who paired their CLI against a remote daemon gets the TUI pointed at the
// same place. We don't import from apps/cli to keep app-to-app coupling out.
export function loadClientConfig(): ClientConfig {
  const envUrl = process.env.BAZILION_SERVER
  const envToken = process.env.BAZILION_TOKEN
  if (envUrl && envToken) return { serverUrl: envUrl, token: envToken }

  const paths = resolveTuiPaths()
  const auth = readAuthFile(paths.authFile)
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

// Per-turn MCP resolution.
//
// Before a worker spawns, the daemon discovers the tools of every enabled MCP
// server (connecting + `tools/list`, reusing pooled connections) and builds the
// `McpHost` the worker proxies through. A server that fails to connect is
// logged and skipped — one broken server never blocks a turn.
//
// Auth: stdio servers inherit the merged secrets env (their child process picks
// up GITHUB_TOKEN etc. from the normal secrets table). http/sse servers read a
// bearer token from the encrypted secrets table under `MCP_TOKEN_<id>`.

import { type BazilionDb, mcpServerRepo, openSecrets } from '../../core/index.ts'
import type { InjectedMcpTool, McpHost } from '../../runtime/index.ts'
import { createMcpHost } from './host.ts'
import { discoverMcpTools, type McpConnectOpts, type McpServerConfig } from './pool.ts'

/** Encrypted-secrets key holding a server's http/sse bearer token. */
export function mcpTokenSecretKey(id: string): string {
  return `MCP_TOKEN_${id.replace(/-/g, '').toUpperCase()}`
}

function toConfig(s: {
  id: string
  name: string
  transport: McpServerConfig['transport']
  command: string | null
  args: string[]
  url: string | null
}): McpServerConfig {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport,
    command: s.command,
    args: s.args,
    url: s.url,
  }
}

export interface ResolvedMcp {
  tools: InjectedMcpTool[]
  host: McpHost
}

const MCP_IDLE_MS = Number.parseInt(process.env.BAZILION_MCP_IDLE_MS ?? '', 10) || 900_000

/**
 * Resolve MCP tools + host for a turn. Returns null when no servers are
 * enabled (so callers skip wiring the host entirely).
 */
export async function resolveMcpForTurn(
  db: BazilionDb,
  env: NodeJS.ProcessEnv,
  authToken: string,
): Promise<ResolvedMcp | null> {
  const enabled = mcpServerRepo.listEnabled(db)
  if (enabled.length === 0) return null

  const secrets = openSecrets(db, authToken)
  const servers = new Map<string, McpServerConfig>()
  const optsFor = (server: McpServerConfig): McpConnectOpts => ({
    env,
    authToken: server.transport === 'stdio' ? undefined : secrets.get(mcpTokenSecretKey(server.id)),
    idleMs: MCP_IDLE_MS,
  })

  const tools: InjectedMcpTool[] = []
  for (const s of enabled) {
    const cfg = toConfig(s)
    servers.set(cfg.id, cfg)
    try {
      tools.push(...(await discoverMcpTools(cfg, optsFor(cfg))))
    } catch (err) {
      console.warn(
        `mcp: failed to connect to "${s.name}" —`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return { tools, host: createMcpHost({ servers, optsFor }) }
}

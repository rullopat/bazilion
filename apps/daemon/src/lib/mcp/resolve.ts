// Per-turn MCP resolution.
//
// Before a worker spawns, the daemon discovers the tools of every enabled MCP
// server (connecting + `tools/list`, reusing pooled connections) and builds the
// `McpHost` the worker proxies through. A server that fails to connect is
// logged and skipped — one broken server never blocks a turn.
//
// Auth: stdio servers inherit the merged secrets env (their child process picks
// up GITHUB_TOKEN etc. from the normal secrets table). HTTP servers read a
// bearer token from the encrypted secrets table under `MCP_TOKEN_<id>`.

import { type BazilionDb, mcpServerRepo, openSecrets } from '../../core/index.ts'
import type { InjectedMcpTool, McpHost } from '../../runtime/index.ts'
import { createMcpHost } from './host.ts'
import {
  discoverMcpTools,
  type McpConnectOpts,
  type McpServerConfig,
  mcpConfigSignature,
} from './pool.ts'

/** Encrypted-secrets key holding a server's HTTP bearer token. */
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
  signal?: AbortSignal,
): Promise<ResolvedMcp | null> {
  const enabled = mcpServerRepo.listEnabled(db)
  if (enabled.length === 0) return null

  const secrets = openSecrets(db, authToken)
  const servers = new Map<string, McpServerConfig>()
  const options = new Map<string, McpConnectOpts>()
  const optsFor = (server: McpServerConfig): McpConnectOpts => {
    const opts = options.get(server.id)
    if (!opts) throw new Error('MCP server not admitted')
    return opts
  }

  const tools: InjectedMcpTool[] = []
  for (const s of enabled) {
    const cfg = toConfig(s)
    const opts: McpConnectOpts = {
      env,
      authToken: cfg.transport === 'stdio' ? undefined : secrets.get(mcpTokenSecretKey(cfg.id)),
      idleMs: MCP_IDLE_MS,
      signal,
      assertActive: () => {
        signal?.throwIfAborted()
        const current = mcpServerRepo.get(db, cfg.id)
        if (
          !current?.enabled ||
          mcpConfigSignature(toConfig(current), {
            env,
            idleMs: MCP_IDLE_MS,
            authToken:
              current.transport === 'stdio' ? undefined : secrets.get(mcpTokenSecretKey(cfg.id)),
          }) !== signature
        )
          throw new Error('MCP configuration changed since turn admission')
      },
    }
    const signature = mcpConfigSignature(cfg, opts)
    try {
      const discovered = await discoverMcpTools(cfg, opts)
      servers.set(cfg.id, cfg)
      options.set(cfg.id, opts)
      tools.push(...discovered)
    } catch {
      signal?.throwIfAborted()
      // Do not log remote errors, URLs, stderr or credentials.
      console.warn(`mcp: connection/discovery failed for server ${s.id}`)
    }
  }

  // The separator can also occur in a server/tool name; refuse ambiguous global namespaces.
  const byName = new Map<string, string>()
  const collisions = new Set<string>()
  for (const tool of tools) {
    const other = byName.get(tool.toolName)
    if (other) {
      collisions.add(other)
      collisions.add(tool.serverId)
    }
    byName.set(tool.toolName, tool.serverId)
  }
  if (collisions.size) {
    for (const id of collisions) {
      servers.delete(id)
      options.delete(id)
    }
    console.warn('mcp: ambiguous tool namespaces; affected servers not admitted')
  }
  const admitted = tools.filter((t) => !collisions.has(t.serverId))
  return { tools: admitted, host: createMcpHost({ servers, tools: admitted, optsFor }) }
}

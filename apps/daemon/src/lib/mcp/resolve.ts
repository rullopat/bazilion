// Per-turn MCP tools. Before a worker spawns, the daemon lists the tools of every enabled server
// (connecting on first use) and builds the host the worker's proxy tools call through. Servers are
// asked side by side, and a server that cannot answer within DISCOVERY_MS is logged and skipped
// (its connect goes on for later turns): one broken server delays a turn by at most that.

import {
  type BazilionDb,
  mcpServerRepo,
  mergeSecretsIntoEnv,
  openSecrets,
} from '../../core/index.ts'
import type { InjectedMcpTool, McpHost } from '../../runtime/index.ts'
import { toolEnvironment } from '../../runtime/shell/security.ts'
import { callMcpTool, listMcpTools, type McpConnectOptions, type McpServerConfig } from './pool.ts'

/** How long a turn waits for the enabled servers' tool lists before it starts without them. */
const DISCOVERY_MS = 10_000

/** Encrypted-secrets key holding a server's HTTP bearer token. */
export function mcpTokenSecretKey(id: string): string {
  return `MCP_TOKEN_${id.replace(/-/g, '').toUpperCase()}`
}

/**
 * How the daemon opens a server: a stdio server's environment is the daemon's merged environment
 * without Bazilion's own credentials; an HTTP server gets its stored bearer token.
 */
export function mcpConnectOptions(
  db: BazilionDb,
  authToken: string,
  server: McpServerConfig,
): McpConnectOptions {
  if (server.transport === 'stdio')
    return { env: toolEnvironment(mergeSecretsIntoEnv(db, authToken), authToken) }
  const token = openSecrets(db, authToken).get(mcpTokenSecretKey(server.id))
  return token ? { authToken: token } : {}
}

/** The MCP tools and host for one turn; null when no server is enabled. */
export async function resolveMcpForTurn(
  db: BazilionDb,
  authToken: string,
  signal?: AbortSignal,
): Promise<{ tools: InjectedMcpTool[]; host: McpHost } | null> {
  const servers = mcpServerRepo.listEnabled(db)
  if (servers.length === 0) return null

  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), DISCOVERY_MS)
  const discovery = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  const listed = await Promise.allSettled(
    servers.map((server) =>
      listMcpTools(server, () => mcpConnectOptions(db, authToken, server), discovery),
    ),
  ).finally(() => clearTimeout(timer))
  signal?.throwIfAborted()
  const tools: InjectedMcpTool[] = []
  const names = new Set<string>()
  for (const [index, server] of servers.entries()) {
    const result = listed[index]
    if (result?.status !== 'fulfilled') {
      const error: unknown = result?.reason
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `no answer within ${DISCOVERY_MS / 1000} s`
          : error instanceof Error
            ? error.message
            : String(error)
      console.warn(`mcp: server ${server.name} is unavailable: ${reason}`)
      continue
    }
    for (const tool of result.value) {
      if (names.has(tool.toolName)) {
        console.warn(`mcp: ${tool.toolName} from server ${server.name} repeats a name; skipped`)
        continue
      }
      names.add(tool.toolName)
      tools.push(tool)
    }
  }

  const host: McpHost = {
    async invoke(serverId, toolName, args) {
      if (!tools.some((tool) => tool.serverId === serverId && tool.rawName === toolName))
        throw new Error(`MCP tool ${toolName} is not available in this turn`)
      // Disabling or deleting a server stops a running turn from calling it.
      const server = mcpServerRepo.get(db, serverId)
      if (!server?.enabled) throw new Error('This MCP server has been disabled or removed')
      return callMcpTool(server, toolName, args, {
        connect: () => mcpConnectOptions(db, authToken, server),
        signal,
      })
    },
  }
  return { tools, host }
}

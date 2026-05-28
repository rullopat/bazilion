// Daemon-side `McpHost` — services the worker's `mcpInvoke` IPC calls by
// dispatching `tools/call` through the connection pool in `pool.ts`. Built per
// turn from the set of enabled servers + their connect options (merged env for
// stdio, bearer token for http/sse).

import type { McpHost } from '../../runtime/index.ts'
import { callMcpTool, type McpConnectOpts, type McpServerConfig } from './pool.ts'

export interface McpHostDeps {
  /** serverId → resolved server config. */
  servers: Map<string, McpServerConfig>
  /** Connect options for a given server (env, auth token, idle timeout). */
  optsFor: (server: McpServerConfig) => McpConnectOpts
}

export function createMcpHost(deps: McpHostDeps): McpHost {
  return {
    invoke: async (serverId, toolName, args) => {
      const server = deps.servers.get(serverId)
      if (!server) throw new Error(`unknown MCP server: ${serverId}`)
      return callMcpTool(server, toolName, args, deps.optsFor(server))
    },
  }
}

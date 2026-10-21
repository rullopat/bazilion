// Daemon-side `McpHost` — services the worker's `mcpInvoke` IPC calls by
// dispatching `tools/call` through the connection pool in `pool.ts`. Built per
// turn from the set of enabled servers + their connect options (merged env for
// stdio, bearer token for HTTP).

import type { McpHost } from '../../runtime/index.ts'
import {
  callMcpTool,
  type InjectedMcpTool,
  type McpConnectOpts,
  type McpServerConfig,
  McpToolUncertainError,
} from './pool.ts'

export interface McpHostDeps {
  /** serverId → resolved server config. */
  servers: Map<string, McpServerConfig>
  /** Exact tools admitted to this turn. Worker RPC cannot widen this set. */
  tools: InjectedMcpTool[]
  /** Connect options for a given server (env, auth token, idle timeout). */
  optsFor: (server: McpServerConfig) => McpConnectOpts
}

export function createMcpHost(deps: McpHostDeps): McpHost {
  const tools = structuredClone(deps.tools)
  const uncertain = new Set<string>()
  return {
    invoke: async (serverId, toolName, args) => {
      const server = deps.servers.get(serverId)
      if (!server) throw new Error(`unknown MCP server: ${serverId}`)
      if (uncertain.has(serverId))
        throw new Error('MCP server has an uncertain effect in this turn; further dispatch refused')
      if (!tools.some((t) => t.serverId === serverId && t.rawName === toolName))
        throw new Error('MCP tool not admitted to this turn; no action dispatched')
      const opts = deps.optsFor(server)
      try {
        return await callMcpTool(server, toolName, args, {
          ...opts,
          admittedTools: tools,
          assertActive: () => {
            if (uncertain.has(serverId))
              throw new Error(
                'MCP server has an uncertain effect in this turn; further dispatch refused',
              )
            opts.assertActive?.()
          },
        })
      } catch (error) {
        if (error instanceof McpToolUncertainError) uncertain.add(serverId)
        throw error
      }
    },
  }
}

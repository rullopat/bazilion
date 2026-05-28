// MCP proxy tools (worker-side definitions).
//
// The daemon discovers each enabled MCP server's tools (`tools/list`) before
// the worker spawns and ships them in `WorkerInput.mcpTools`. Here we turn each
// into a Bazilion `ToolHandler` whose `invoke` forwards to the daemon-side
// connection pool over IPC via the injected `McpHost`. The LLM sees the
// namespaced name (`mcp__<server>__<tool>`); the proxy carries the original
// `serverId` + `rawName` so the daemon routes the `tools/call` correctly.

import type { InjectedMcpTool, McpHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

/** Build proxy tools for every discovered MCP tool. */
export function mcpProxyTools(host: McpHost, tools: InjectedMcpTool[]): ToolHandler[] {
  return tools.map((t) => ({
    def: {
      name: t.toolName,
      description: t.description,
      parameters: t.inputSchema,
    },
    invoke: (args) => host.invoke(t.serverId, t.rawName, args),
  }))
}

// MCP proxy tools (worker-side definitions).
//
// The daemon discovers each enabled MCP server's tools (`tools/list`) before
// the worker spawns and ships them in `WorkerInput.mcpTools`. Here we turn each
// into a Bazilion `ToolHandler` whose `invoke` forwards to the daemon-side
// connection pool over IPC via the injected `McpHost`. The LLM sees the
// namespaced name (`mcp__<server>__<tool>`); the proxy carries the original
// `serverId` + `rawName` so the daemon routes the `tools/call` correctly.
//
// A tool marked `ask` (it sends or changes something outside: mail, a post, an event) waits for
// the operator's approval in the daemon, which also refuses it when nobody can approve: the
// worker cannot skip that step.

import type { InjectedMcpTool, McpHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

const SHOWN_ARGUMENTS = 4_000

/** What the operator is asked to approve: the tool and its arguments, readable. */
export function toolCallSummary(rawName: string, args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2)
  const shown = json.length > SHOWN_ARGUMENTS ? `${json.slice(0, SHOWN_ARGUMENTS)}\n…` : json
  return `${rawName}\n${shown}`
}

/** The group a connection's tools are searched by: `mcp__<connection>`, as in their names. */
export function mcpGroupName(tool: Pick<InjectedMcpTool, 'toolName' | 'serverName'>): string {
  if (tool.serverName) return `mcp__${tool.serverName}`
  const parts = tool.toolName.split('__')
  return parts.length >= 3 ? `${parts[0]}__${parts[1]}` : tool.toolName
}

/**
 * Build proxy tools for every discovered MCP tool. They wait to be found (BAZ-100): not declared
 * to the model until `tool_search` loads them, and callable from codemode scripts at any time.
 */
export function mcpProxyTools(host: McpHost, tools: InjectedMcpTool[]): ToolHandler[] {
  return tools.map((t) => ({
    reach: 'deferred' as const,
    group: {
      name: mcpGroupName(t),
      ...(t.serverName ? { description: `The ${t.serverName} connection` } : {}),
    },
    def: {
      name: t.toolName,
      description: t.ask
        ? `${t.description}\n\nThe operator approves each call of this tool before it runs.`
        : t.description,
      parameters: t.inputSchema,
    },
    invoke: (args, context) =>
      host.invoke(t.serverId, t.rawName, args, { toolCallId: context?.toolCallId }),
  }))
}

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
import { toolCallSummary } from '../../runtime/tools/mcp.ts'
import type { BashApprovalHandle } from '../../runtime/worker/ipc-protocol.ts'
import { callMcpTool, listMcpTools, type McpConnectOptions, type McpServerConfig } from './pool.ts'
import { askChoices, serverEnv, toolAsks } from './settings.ts'

/** How long a turn waits for the enabled servers' tool lists before it starts without them. */
const DISCOVERY_MS = 10_000

/** Encrypted-secrets key holding a server's HTTP bearer token. */
export function mcpTokenSecretKey(id: string): string {
  return `MCP_TOKEN_${id.replace(/-/g, '').toUpperCase()}`
}

/**
 * How the daemon opens a server: a stdio server's environment is the daemon's merged environment
 * without Bazilion's own credentials, plus its own variables (its token); an HTTP server gets its
 * stored bearer token.
 */
export function mcpConnectOptions(
  db: BazilionDb,
  authToken: string,
  server: McpServerConfig,
): McpConnectOptions {
  if (server.transport === 'stdio')
    return {
      env: {
        ...toolEnvironment(mergeSecretsIntoEnv(db, authToken), authToken),
        ...serverEnv(db, authToken, server.id),
      },
    }
  const token = openSecrets(db, authToken).get(mcpTokenSecretKey(server.id))
  return token ? { authToken: token } : {}
}

/**
 * Asks the operator about one call of a tool that asks first; bound by the caller to the turn, its
 * Agent and whether anyone can answer.
 */
export type McpApprovalGate = (request: {
  toolCallId: string
  command: string
  tool: string
  /** Ends the wait: the turn stopped, or the worker that asked is gone. */
  signal?: AbortSignal
}) => BashApprovalHandle

/**
 * The MCP tools and host for one turn; null when no server is enabled. A tool that sends or
 * changes something outside asks the operator first, through `gate`; without one it is refused.
 */
export async function resolveMcpForTurn(
  db: BazilionDb,
  authToken: string,
  signal?: AbortSignal,
  gate?: McpApprovalGate,
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
    const chosen = askChoices(db, authToken, server.id)
    for (const listed of result.value) {
      const tool = toolAsks(chosen, listed.rawName) ? { ...listed, ask: true } : listed
      if (names.has(tool.toolName)) {
        console.warn(`mcp: ${tool.toolName} from server ${server.name} repeats a name; skipped`)
        continue
      }
      names.add(tool.toolName)
      tools.push(tool)
    }
  }

  const host: McpHost = {
    async invoke(serverId, toolName, args, options) {
      const tool = tools.find((entry) => entry.serverId === serverId && entry.rawName === toolName)
      if (!tool) throw new Error(`MCP tool ${toolName} is not available in this turn`)
      // Disabling or deleting a server stops a running turn from calling it.
      const server = mcpServerRepo.get(db, serverId)
      if (!server?.enabled) throw new Error('This MCP server has been disabled or removed')
      // The turn's signal, and the call's own: a worker that dies leaves no approval behind it,
      // and an approval given after that sends nothing.
      const callSignal =
        signal && options?.signal
          ? AbortSignal.any([signal, options.signal])
          : (options?.signal ?? signal)
      if (tool.ask) {
        // It sends or changes something outside: the operator approves this one call first.
        if (!gate) throw new Error(`${tool.toolName} needs the operator's approval first`)
        const handle = gate({
          toolCallId: options?.toolCallId ?? tool.toolName,
          command: toolCallSummary(toolName, args),
          tool: `${server.name} · ${toolName}`,
          ...(callSignal ? { signal: callSignal } : {}),
        })
        options?.onApproval?.(handle.approval)
        const settled = await handle.settled
        if (handle.approval.status === 'pending') options?.onApproval?.(settled)
        if (settled.status !== 'allowed') {
          throw new Error(
            `${tool.toolName} was not approved, so nothing was sent. In a turn nobody is watching (a schedule, a teammate's message, Telegram), ask the operator in a conversation instead.`,
          )
        }
        callSignal?.throwIfAborted()
      }
      return callMcpTool(server, toolName, args, {
        connect: () => mcpConnectOptions(db, authToken, server),
        ...(callSignal ? { signal: callSignal } : {}),
      })
    },
  }
  return { tools, host }
}

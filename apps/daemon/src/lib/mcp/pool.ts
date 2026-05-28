// Daemon-side MCP connection pool.
//
// One long-lived `@modelcontextprotocol/sdk` client per configured server,
// keyed by serverId in the process-lifetime resource registry. Connections are
// established lazily (on first tool discovery or call), reused across turns and
// across agents — MCP servers are configured globally in 0.4.0 — and reaped on
// idle / shutdown. The worker never opens an MCP connection itself: it proxies
// each `tools/call` over IPC (`mcpInvoke`) to `createMcpHost`, which calls
// `callMcpTool` here.
//
// Transports: stdio (local subprocess), Streamable-HTTP, and SSE (both remote,
// with optional Bearer auth). stdio children inherit the daemon's merged
// secrets env so a server that needs e.g. GITHUB_TOKEN picks it up from the
// normal secrets table.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import type { InjectedMcpTool } from '../../runtime/worker/ipc-protocol.ts'
import { ensureResourceReaper, resources } from '../resources.ts'

export type { InjectedMcpTool }

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
}

export interface McpConnection {
  serverId: string
  name: string
  lastUsedAt: number
  idleMs: number
  client: Client
  transport: Transport
  tools: InjectedMcpTool[]
  close(): Promise<void>
}

export interface McpConnectOpts {
  /** Merged env (process.env + secrets) — passed to stdio children. */
  env: NodeJS.ProcessEnv
  /** Bearer token for http/sse transports, if configured. */
  authToken?: string
  idleMs: number
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v
  return out
}

async function openTransport(server: McpServerConfig, opts: McpConnectOpts): Promise<Transport> {
  if (server.transport === 'stdio') {
    if (!server.command)
      throw new Error(`MCP server "${server.name}": stdio transport needs a command`)
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: stringEnv(opts.env),
    })
  }
  if (!server.url)
    throw new Error(`MCP server "${server.name}": ${server.transport} transport needs a url`)
  const requestInit: RequestInit | undefined = opts.authToken
    ? { headers: { Authorization: `Bearer ${opts.authToken}` } }
    : undefined
  if (server.transport === 'http') {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )
    return new StreamableHTTPClientTransport(new URL(server.url), { requestInit })
  }
  const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
  return new SSEClientTransport(new URL(server.url), { requestInit })
}

async function connect(server: McpServerConfig, opts: McpConnectOpts): Promise<McpConnection> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const client = new Client({ name: 'bazilion', version: '0.4.0' })
  const transport = await openTransport(server, opts)
  await client.connect(transport)

  const listed = await client.listTools()
  const ns = sanitizeName(server.name)
  const tools: InjectedMcpTool[] = listed.tools.map((t) => ({
    toolName: `mcp__${ns}__${t.name}`,
    serverId: server.id,
    rawName: t.name,
    description: t.description ?? `MCP tool ${t.name} from ${server.name}`,
    inputSchema: t.inputSchema,
  }))

  return {
    serverId: server.id,
    name: server.name,
    lastUsedAt: Date.now(),
    idleMs: opts.idleMs,
    client,
    transport,
    tools,
    async close() {
      try {
        await client.close()
      } catch {}
    },
  }
}

/**
 * Get the live connection for a server, establishing it on first use. Reused
 * across turns/agents; the idle reaper closes it after `idleMs`.
 */
export async function getOrCreateMcpConnection(
  server: McpServerConfig,
  opts: McpConnectOpts,
): Promise<McpConnection> {
  const pool = resources().mcp
  const existing = pool.get(server.id)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  const conn = await connect(server, opts)
  pool.set(server.id, conn)
  ensureResourceReaper()
  return conn
}

/** Close and forget a server's connection if present (server disabled/deleted/updated). */
export async function closeMcpConnection(serverId: string): Promise<void> {
  const pool = resources().mcp
  const conn = pool.get(serverId)
  if (!conn) return
  pool.delete(serverId)
  await conn.close()
}

/** Discover a server's tools, (re)connecting as needed. Used at turn assembly + the test route. */
export async function discoverMcpTools(
  server: McpServerConfig,
  opts: McpConnectOpts,
): Promise<InjectedMcpTool[]> {
  const conn = await getOrCreateMcpConnection(server, opts)
  return conn.tools
}

/** Execute one MCP tool call and map the result to multimodal tool output. */
export async function callMcpTool(
  server: McpServerConfig,
  rawName: string,
  args: Record<string, unknown>,
  opts: McpConnectOpts,
): Promise<ToolResultPart[]> {
  const conn = await getOrCreateMcpConnection(server, opts)
  conn.lastUsedAt = Date.now()
  const res = await conn.client.callTool({ name: rawName, arguments: args })
  const content = Array.isArray(res.content) ? res.content : []
  const parts: ToolResultPart[] = []
  for (const c of content as Array<Record<string, unknown>>) {
    if (c.type === 'text' && typeof c.text === 'string') {
      parts.push({ type: 'text', text: c.text })
    } else if (
      (c.type === 'image' || c.type === 'audio') &&
      typeof c.data === 'string' &&
      typeof c.mimeType === 'string'
    ) {
      // pi tool results carry images; audio degrades to a text note.
      if (c.type === 'image') parts.push({ type: 'image', data: c.data, mimeType: c.mimeType })
      else parts.push({ type: 'text', text: `[audio result: ${c.mimeType}]` })
    } else if (c.type === 'resource' && c.resource && typeof c.resource === 'object') {
      const r = c.resource as Record<string, unknown>
      parts.push({
        type: 'text',
        text: typeof r.text === 'string' ? r.text : `[resource: ${String(r.uri ?? '')}]`,
      })
    }
  }
  if (res.isError) {
    const msg =
      parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n') || 'tool returned an error'
    throw new Error(msg)
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '(no content)' }]
}

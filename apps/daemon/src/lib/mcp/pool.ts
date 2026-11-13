// Daemon-owned MCP clients (Pi's `@earendil-works/pi-mcp`): one connection per configured server,
// opened on first use and shared by every turn. It is closed when idle, when its configuration
// changes, when the server goes away (a stdio process exits, an HTTP session expires) and at
// shutdown; the next use opens a new one. stdio servers run as daemon child processes with an
// explicit environment; Streamable HTTP servers may send a bearer token. Workers never connect:
// they call tools over IPC.

import type { McpTransport } from '@bazilion/api-types'
import {
  McpAbortError,
  McpClient,
  McpSessionExpiredError,
  type McpTransport as PiTransport,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
} from '@earendil-works/pi-mcp'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import type { InjectedMcpTool } from '../../runtime/worker/ipc-protocol.ts'
import { ensureResourceReaper, resources } from '../resources.ts'

const REQUEST_MS = 60_000
const MESSAGE_BYTES = 8 * 1024 * 1024
const CLOSE_MS = 5_000
const KILL_WAIT_MS = 2_000
/** A connection unused this long is closed; the next use reopens it. */
const IDLE_MS = 15 * 60_000
const TOOL_NAME = /^[a-zA-Z0-9_-]+$/

/**
 * Pi's stdio close ends stdin, then signals the server's process group while the leader lives. A
 * descendant that ignores SIGTERM after the leader exited would survive that, so the group gets a
 * final SIGKILL once Pi's close settles (or after a bounded wait, if a detached descendant keeps the
 * pipes open). Every caller shares the first close: a second Pi close returns at once, which would
 * otherwise SIGKILL the server before its graceful shutdown.
 */
class GroupStdioTransport extends StdioTransport {
  private group: number | undefined
  private closing: Promise<void> | undefined
  override async start(): Promise<void> {
    const starting = super.start()
    this.group = this.pid
    await starting
  }
  override close(): Promise<void> {
    this.closing ??= this.shutDown()
    return this.closing
  }
  private async shutDown(): Promise<void> {
    await withTimeout(super.close(), CLOSE_MS)
    const group = this.group
    if (group === undefined) return
    try {
      process.kill(-group, 'SIGKILL')
    } catch {
      return // The group is already gone.
    }
    // SIGKILL is delivered asynchronously: wait briefly until the group is gone so a closed
    // connection leaves no running server process behind for whatever runs next.
    const deadline = Date.now() + KILL_WAIT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      try {
        process.kill(-group, 0)
      } catch {
        return
      }
    }
  }
}

/** What the pool needs of a configured server (an `McpServer` row satisfies it). */
export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
}

/**
 * How to open a server: the stdio process's whole environment, or the HTTP bearer token. Callers
 * pass a function, called only when a connection has to be opened.
 */
export interface McpConnectOptions {
  env?: NodeJS.ProcessEnv
  authToken?: string
}

/** A server's connection; it is in `resources().mcp` from first use until it is closed. */
export interface McpConnection {
  serverId: string
  lastUsedAt: number
  idleMs: number
  /** Calls in flight; the idle reaper never closes a busy connection. */
  busy: number
  client: McpClient
  /** Resolves once the server is initialized; rejects if it fails to start or is closed first. */
  ready: Promise<McpConnection>
  /** The server's tools, listed on first use and again after `notifications/tools/list_changed`. */
  tools?: InjectedMcpTool[]
  toolsStale: boolean
  close(): Promise<void>
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.then(
      () => {},
      () => {},
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function required(value: string | null, what: string): string {
  if (!value) throw new Error(`MCP server has no ${what}`)
  return value
}

function open(server: McpServerConfig, options: McpConnectOptions): McpConnection {
  const stdio =
    server.transport === 'stdio'
      ? new GroupStdioTransport({
          command: required(server.command, 'command'),
          args: server.args,
          env: Object.fromEntries(
            Object.entries(options.env ?? {}).filter(
              (pair): pair is [string, string] => typeof pair[1] === 'string',
            ),
          ),
          inheritEnv: false,
          stderr: 'pipe',
          maxMessageBytes: MESSAGE_BYTES,
          maxStderrBytes: 16 * 1024,
        })
      : undefined
  const transport: PiTransport =
    stdio ??
    new StreamableHttpTransport({
      url: required(server.url, 'URL'),
      headers: options.authToken ? { Authorization: `Bearer ${options.authToken}` } : undefined,
      maxMessageBytes: MESSAGE_BYTES,
      // A redirect would carry the bearer token to another endpoint.
      fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
    })
  const client = new McpClient({ name: 'bazilion', version: '1', requestTimeoutMs: REQUEST_MS })
  let closing: Promise<void> | undefined
  const conn: McpConnection = {
    serverId: server.id,
    lastUsedAt: Date.now(),
    idleMs: IDLE_MS,
    busy: 0,
    client,
    ready: client.connect(transport).then(
      () => {
        if (closing) throw new Error(`MCP server ${server.name} was closed while connecting`)
        return conn
      },
      async (error: unknown) => {
        await conn.close()
        const stderr = stdio?.stderr.trim()
        throw new Error(
          `MCP server ${server.name} failed to start: ${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr.slice(-2_000)}` : ''}`,
        )
      },
    ),
    toolsStale: false,
    close() {
      if (resources().mcp.get(server.id) === conn) resources().mcp.delete(server.id)
      // Set before closing starts: Pi's close notification calls back in here synchronously. Pi's
      // client detaches the transport before closing it, so the transport is closed directly as
      // well; a second close of either returns at once.
      closing ??= Promise.resolve().then(() =>
        withTimeout(
          Promise.allSettled([client.close(), transport.close()]),
          CLOSE_MS + KILL_WAIT_MS,
        ),
      )
      return closing
    },
  }
  // The server went away (its process exited, say): close the connection as well, which kills a
  // stdio server's whole process group, and let the next use start it again.
  client.onClose(() => void conn.close())
  client.onError((error) => {
    console.warn(`mcp: server ${server.name}: ${error.message}`)
    // The server-to-client stream found the session gone: the next use reconnects.
    if (error instanceof McpSessionExpiredError) void conn.close()
  })
  client.onNotification('notifications/tools/list_changed', () => {
    conn.toolsStale = true
  })
  return conn
}

/** The server's connection, opened on first use and shared with every concurrent caller. */
export function getMcpConnection(
  server: McpServerConfig,
  connect: () => McpConnectOptions,
): Promise<McpConnection> {
  let conn = resources().mcp.get(server.id)
  if (!conn) {
    conn = open(server, connect())
    resources().mcp.set(server.id, conn)
    ensureResourceReaper()
  }
  conn.lastUsedAt = Date.now()
  return conn.ready
}

/** `getMcpConnection` for one caller: when its signal aborts it stops waiting; the connect goes on. */
function connection(
  server: McpServerConfig,
  connect: () => McpConnectOptions,
  signal: AbortSignal | undefined,
): Promise<McpConnection> {
  if (!signal) return getMcpConnection(server, connect)
  if (signal.aborted) return Promise.reject(new McpAbortError())
  const ready = getMcpConnection(server, connect)
  return new Promise((resolve, reject) => {
    const abort = () => reject(new McpAbortError())
    signal.addEventListener('abort', abort, { once: true })
    ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** The server's tools as `mcp__<server>__<tool>`; names a model API would reject are skipped. */
export async function listMcpTools(
  server: McpServerConfig,
  connect: () => McpConnectOptions,
  signal?: AbortSignal,
): Promise<InjectedMcpTool[]> {
  const conn = await connection(server, connect, signal)
  if (conn.tools && !conn.toolsStale) return conn.tools
  conn.toolsStale = false
  conn.busy++
  try {
    const tools: InjectedMcpTool[] = []
    for (const tool of await conn.client.listTools({ signal })) {
      const toolName = `mcp__${server.name}__${tool.name}`
      const schema = tool.inputSchema as Record<string, unknown> | undefined
      if (!TOOL_NAME.test(tool.name) || toolName.length > 64 || schema?.type !== 'object') {
        console.warn(`mcp: server ${server.name}: skipped tool ${JSON.stringify(tool.name)}`)
        continue
      }
      tools.push({
        toolName,
        serverId: server.id,
        rawName: tool.name,
        description: tool.description ?? `MCP tool ${tool.name} from ${server.name}`,
        inputSchema: schema,
      })
    }
    conn.tools = tools
    return tools
  } catch (error) {
    conn.toolsStale = true // List again next time.
    if (error instanceof McpSessionExpiredError) await conn.close()
    throw error
  } finally {
    conn.busy--
    conn.lastUsedAt = Date.now()
  }
}

/** Call one tool. A tool error (`isError`) is thrown with the server's own text. */
export async function callMcpTool(
  server: McpServerConfig,
  rawName: string,
  args: Record<string, unknown>,
  options: { connect: () => McpConnectOptions; signal?: AbortSignal },
): Promise<ToolResultPart[]> {
  const conn = await connection(server, options.connect, options.signal)
  conn.busy++
  try {
    const result = await conn.client.callTool(rawName, args, { signal: options.signal })
    const parts = toLlmContent(result)
    if (result.isError) {
      const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
      throw new Error(text || `MCP tool ${rawName} reported an error`)
    }
    return parts.length ? parts : [{ type: 'text', text: '(no content)' }]
  } catch (error) {
    // An HTTP server that restarted no longer knows the session: close it, so the next use
    // reconnects. The failed call is not replayed.
    if (error instanceof McpSessionExpiredError) await conn.close()
    throw error
  } finally {
    conn.busy--
    conn.lastUsedAt = Date.now()
  }
}

/** Close the server's connection, including one still opening. */
export async function closeMcpConnection(serverId: string): Promise<void> {
  await resources().mcp.get(serverId)?.close()
}

/** Close every connection; called at daemon shutdown. */
export async function shutdownMcpConnections(): Promise<void> {
  await Promise.all([...resources().mcp.values()].map((conn) => conn.close()))
}

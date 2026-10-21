// Daemon-owned Pi MCP clients. No Pi extension, mcp.json, OAuth store or worker connection.
// Pi owns protocol correlation/framing, cancellation and transport shutdown.
// stdio-owner.ts keeps Linux retirement truthful for surviving SIGTERM-ignoring descendants.
// This adapter owns configuration admission, catalog bounds and resource lifetime only.
import { createHash } from 'node:crypto'
import type { McpTransport } from '@bazilion/api-types'
import {
  McpClient,
  type McpTransport as PiTransport,
  StreamableHttpTransport,
  toLlmContent,
} from '@earendil-works/pi-mcp'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import type { InjectedMcpTool } from '../../runtime/worker/ipc-protocol.ts'
import { ensureResourceReaper, resources } from '../resources.ts'
import { retainTransport, retireMcpClient } from './retirement.ts'
import { OwnedStdioTransport } from './stdio-owner.ts'

export type { InjectedMcpTool, McpTransport }

export class McpToolUncertainError extends Error {
  constructor(retirementHeld = false) {
    super(
      `MCP tool failed or was cancelled; it may have taken effect. Not replayed.${retirementHeld ? ' Retirement incomplete; operator intervention required.' : ''}`,
    )
  }
}

const REQUEST_MS = 60_000
const MESSAGE_BYTES = 8 * 1024 * 1024
const CATALOG_BYTES = 2 * 1024 * 1024

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
}
export interface McpConnectOpts {
  env: NodeJS.ProcessEnv
  authToken?: string
  idleMs: number
  signal?: AbortSignal
  /** Daemon revalidation, including after async admission and before dispatch. */
  assertActive?: () => void
  admittedTools?: InjectedMcpTool[]
}
export interface McpConnection {
  serverId: string
  name: string
  lastUsedAt: number
  idleMs: number
  busy: number
  client: McpClient
  tools: InjectedMcpTool[]
  close(): Promise<void>
}
interface Slot {
  id: string
  signature: string
  generation: number
  client: McpClient
  transport?: PiTransport
  controller: AbortController
  retired: boolean
  revision: number
  dirty: boolean
  connection?: McpConnection
  opening?: Promise<McpConnection>
  refreshing?: Promise<void>
  closing?: Promise<void>
}
const STATE_KEY = Symbol.for('bazilion.mcp.pool')
const globalState = globalThis as unknown as Record<
  symbol,
  { slots: Map<string, Slot>; stopping: boolean; generation: number; shutdownCount: number }
>
const state = globalState[STATE_KEY] ?? {
  slots: new Map<string, Slot>(),
  stopping: false,
  generation: 0,
  shutdownCount: 0,
}
globalState[STATE_KEY] = state

export function mcpConfigSignature(server: McpServerConfig, opts: McpConnectOpts): string {
  const env =
    server.transport === 'stdio'
      ? Object.entries(opts.env)
          .filter(([, v]) => typeof v === 'string')
          .sort(([a], [b]) => a.localeCompare(b))
      : undefined
  return createHash('sha256')
    .update(JSON.stringify([server, env, opts.authToken]))
    .digest('hex')
}
function required(value: string | null): string {
  if (!value) throw new Error('Missing MCP command or URL')
  return value
}
function assertActive(opts: McpConnectOpts): void {
  opts.signal?.throwIfAborted()
  opts.assertActive?.()
}
function wait<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('MCP operation cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
function retire(slot: Slot): Promise<void> {
  slot.retired = true
  slot.controller.abort()
  // Install the promise before Pi's synchronous close notification can re-enter.
  slot.closing ??= Promise.resolve()
    .then(() => retireMcpClient(slot.client, slot.transport))
    .then(() => {
      if (state.slots.get(slot.id) === slot) state.slots.delete(slot.id)
      if (resources().mcp.get(slot.id) === slot.connection) resources().mcp.delete(slot.id)
    })
  return slot.closing
}
function checkSlot(slot: Slot): void {
  if (
    slot.retired ||
    state.stopping ||
    slot.generation !== state.generation ||
    slot.client.connectionState !== 'connected'
  )
    throw new Error('MCP connection retired; no action dispatched')
}

async function readTools(slot: Slot, server: McpServerConfig): Promise<InjectedMcpTool[]> {
  const signal = AbortSignal.any([slot.controller.signal, AbortSignal.timeout(REQUEST_MS)])
  const tools: InjectedMcpTool[] = []
  const cursors = new Set<string>()
  const names = new Set<string>()
  let cursor: string | undefined
  let bytes = 0
  // Pi handles requests; pagination here supplies bounded *admission*, not protocol/framing.
  for (let page = 0; page < 16; page++) {
    const result = await slot.client.request<{ tools: unknown[]; nextCursor?: string }>(
      'tools/list',
      cursor === undefined ? undefined : { cursor },
      { signal },
    )
    if (!result || !Array.isArray(result.tools)) throw new Error('Invalid MCP tool catalog')
    bytes += Buffer.byteLength(JSON.stringify(result))
    if (bytes > CATALOG_BYTES || tools.length + result.tools.length > 512)
      throw new Error('MCP tool catalog exceeds admission bounds')
    for (const item of result.tools) {
      if (!item || typeof item !== 'object') throw new Error('Invalid MCP tool definition')
      const t = item as Record<string, unknown>
      const name = t.name
      const toolName = `mcp__${server.name}__${name}`
      if (
        typeof name !== 'string' ||
        !/^[a-zA-Z0-9_-]+$/.test(name) ||
        toolName.length > 64 ||
        names.has(name)
      )
        throw new Error('Invalid or duplicate MCP tool namespace')
      const schema = t.inputSchema
      if (
        !schema ||
        typeof schema !== 'object' ||
        Array.isArray(schema) ||
        (schema as Record<string, unknown>).type !== 'object'
      )
        throw new Error('Invalid MCP tool input schema')
      names.add(name)
      tools.push({
        toolName,
        serverId: server.id,
        rawName: name,
        description:
          typeof t.description === 'string'
            ? t.description
            : `MCP tool ${name} from ${server.name}`,
        inputSchema: schema as Record<string, unknown>,
      })
    }
    if (result.nextCursor === undefined) return tools
    if (
      typeof result.nextCursor !== 'string' ||
      !result.nextCursor ||
      result.nextCursor.length > 4096 ||
      cursors.has(result.nextCursor)
    )
      throw new Error('Invalid MCP catalog pagination')
    cursors.add(result.nextCursor)
    cursor = result.nextCursor
  }
  throw new Error('MCP catalog exceeds page limit')
}

async function refresh(slot: Slot, server: McpServerConfig): Promise<void> {
  if (!slot.dirty) return
  if (slot.refreshing) return slot.refreshing
  const revision = slot.revision
  const conn = slot.connection
  if (conn) conn.busy++
  slot.refreshing = (async () => {
    const tools = await readTools(slot, server)
    checkSlot(slot)
    if (revision !== slot.revision) throw new Error('MCP catalog changed during discovery')
    if (slot.connection) slot.connection.tools = tools
    slot.dirty = false
  })()
  try {
    await slot.refreshing
  } finally {
    slot.refreshing = undefined
    if (conn) {
      conn.busy--
      conn.lastUsedAt = Date.now()
    }
  }
}

async function connect(
  slot: Slot,
  server: McpServerConfig,
  opts: McpConnectOpts,
): Promise<McpConnection> {
  const timeout = setTimeout(() => {
    void retire(slot).catch(() => {})
  }, REQUEST_MS)
  try {
    const transport =
      server.transport === 'stdio'
        ? new OwnedStdioTransport({
            command: required(server.command),
            args: server.args,
            env: Object.fromEntries(
              Object.entries(opts.env).filter(
                (pair): pair is [string, string] => typeof pair[1] === 'string',
              ),
            ),
            inheritEnv: false,
            stderr: 'pipe',
            maxMessageBytes: MESSAGE_BYTES,
            maxStderrBytes: 32 * 1024,
          })
        : new StreamableHttpTransport({
            url: required(server.url),
            headers: opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : undefined,
            maxMessageBytes: MESSAGE_BYTES,
            // No redirects, automatic OAuth, endpoint fallback or POST retry.
            fetch: async (url, init) => {
              const response = await fetch(url, { ...init, redirect: 'error' })
              const mediaType = response.headers
                .get('content-type')
                ?.split(';')[0]
                ?.trim()
                .toLowerCase()
              if (response.ok && mediaType === 'text/event-stream') return response
              if (!response.body) return response
              const reader = response.body.getReader()
              const chunks: Uint8Array[] = []
              let bytes = 0
              try {
                for (;;) {
                  const chunk = await reader.read()
                  if (chunk.done) break
                  bytes += chunk.value.byteLength
                  if (bytes > MESSAGE_BYTES) throw new Error('MCP response exceeds message limit')
                  chunks.push(chunk.value)
                }
              } finally {
                await reader.cancel().catch(() => {})
              }
              return new Response(Buffer.concat(chunks), {
                status: response.status,
                headers: response.headers,
              })
            },
          })
    slot.transport = retainTransport(transport)
    slot.client.onError(() => {
      void retire(slot).catch(() => {})
    })
    slot.client.onNotification('notifications/tools/list_changed', () => {
      slot.revision++
      slot.dirty = true
    })
    slot.client.onClose(() => {
      void retire(slot).catch(() => {})
    })
    await slot.client.connect(transport)
    checkSlot(slot)
    const conn: McpConnection = {
      serverId: server.id,
      name: server.name,
      lastUsedAt: Date.now(),
      idleMs: opts.idleMs,
      busy: 0,
      client: slot.client,
      tools: [],
      async close() {
        await retire(slot)
        await slot.opening?.catch(() => {})
      },
    }
    slot.connection = conn
    await refresh(slot, server)
    checkSlot(slot)
    resources().mcp.set(server.id, conn)
    ensureResourceReaper()
    return conn
  } catch {
    await retire(slot)
    throw new Error('MCP connection or discovery failed; no tool action dispatched')
  } finally {
    clearTimeout(timeout)
  }
}

export async function getOrCreateMcpConnection(
  server: McpServerConfig,
  opts: McpConnectOpts,
): Promise<McpConnection> {
  assertActive(opts)
  if (state.stopping) throw new Error('MCP pool shutting down')
  if (!/^[a-zA-Z0-9_]+$/.test(server.name) || !['stdio', 'http'].includes(server.transport))
    throw new Error('Unsupported MCP transport or namespace')
  if (server.transport === 'stdio' ? !server.command : !server.url)
    throw new Error('Missing MCP command or URL')
  if (server.transport === 'http') {
    const url = new URL(required(server.url))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error('Invalid MCP HTTP endpoint')
  }
  const signature = mcpConfigSignature(server, opts)
  const generation = state.generation
  let slot = state.slots.get(server.id)
  if (slot && (slot.retired || slot.signature !== signature)) {
    await wait(closeMcpConnection(server.id), opts.signal)
    assertActive(opts)
    slot = state.slots.get(server.id)
  }
  if (
    state.stopping ||
    generation !== state.generation ||
    (slot && (slot.retired || slot.signature !== signature))
  )
    throw new Error('MCP admission changed; no action dispatched')
  if (!slot) {
    slot = {
      id: server.id,
      signature,
      generation,
      client: new McpClient({ name: 'bazilion', version: '0.22.0', requestTimeoutMs: REQUEST_MS }),
      controller: new AbortController(),
      retired: false,
      revision: 0,
      dirty: true,
    }
    state.slots.set(server.id, slot)
    slot.opening = connect(slot, server, opts)
  }
  if (!slot.opening) throw new Error('MCP admission not initialized')
  const conn = await wait(slot.opening, opts.signal)
  assertActive(opts)
  checkSlot(slot)
  conn.lastUsedAt = Date.now()
  conn.idleMs = opts.idleMs
  return conn
}
export async function closeMcpConnection(serverId: string): Promise<void> {
  const slot = state.slots.get(serverId)
  if (!slot) return
  await retire(slot)
  await slot.opening?.catch(() => {})
}
export async function shutdownMcpConnections(): Promise<void> {
  state.stopping = true
  state.shutdownCount++
  state.generation++
  try {
    const settled = await Promise.allSettled([...state.slots.keys()].map(closeMcpConnection))
    if (settled.some((s) => s.status === 'rejected'))
      throw new Error('MCP resources require retirement; ownership retained')
  } finally {
    state.shutdownCount--
    state.stopping = state.shutdownCount > 0
  }
}
export async function discoverMcpTools(
  server: McpServerConfig,
  opts: McpConnectOpts,
): Promise<InjectedMcpTool[]> {
  const conn = await getOrCreateMcpConnection(server, opts)
  const slot = state.slots.get(server.id)
  if (!slot || slot.connection !== conn)
    throw new Error('MCP connection retired; no action dispatched')
  await wait(refresh(slot, server), opts.signal)
  assertActive(opts)
  checkSlot(slot)
  return structuredClone(conn.tools)
}
export async function callMcpTool(
  server: McpServerConfig,
  rawName: string,
  args: Record<string, unknown>,
  opts: McpConnectOpts,
): Promise<ToolResultPart[]> {
  const conn = await getOrCreateMcpConnection(server, opts)
  const slot = state.slots.get(server.id)
  if (!slot || slot.connection !== conn)
    throw new Error('MCP connection retired; no action dispatched')
  await wait(refresh(slot, server), opts.signal)
  assertActive(opts)
  checkSlot(slot)
  const current = conn.tools.find((t) => t.rawName === rawName)
  const admitted = opts.admittedTools?.find(
    (t) => t.serverId === server.id && t.rawName === rawName,
  )
  if (!current || (opts.admittedTools && JSON.stringify(current) !== JSON.stringify(admitted)))
    throw new Error('MCP tool unavailable or changed since admission; no action dispatched')
  conn.busy++
  try {
    const signal = AbortSignal.any([
      slot.controller.signal,
      AbortSignal.timeout(REQUEST_MS),
      ...(opts.signal ? [opts.signal] : []),
    ])
    const result = await conn.client.callTool(rawName, args, { signal })
    if (result.isError) throw new Error('MCP server reported a tool error; action not replayed')
    const parts = toLlmContent(result)
    return parts.length ? parts : [{ type: 'text', text: '(no content)' }]
  } catch {
    // A failure is not proof the server did nothing. Never replay, even after reconnect.
    let held = false
    try {
      await retire(slot)
    } catch {
      held = true
    }
    throw new McpToolUncertainError(held)
  } finally {
    conn.busy--
    conn.lastUsedAt = Date.now()
  }
}

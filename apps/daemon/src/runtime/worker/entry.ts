// Subprocess entrypoint for whole-run isolation — no SQLite handle inside.
//
// Reads a `WorkerInput` JSON object from stdin describing the turn to run:
// the pre-resolved agent record, enabled-provider set, and message text.
// The daemon does all DB-backed lookups before spawning us.
//
// Live messaging (the `send_message` / `read_inbox` / `wait_for_reply` tools)
// is delegated back to the daemon over Node IPC: each tool invocation sends
// a `{type: 'rpc', ...}` message and awaits the matching reply. The parent
// dispatches the request through its own DB-backed `MessagingHost`.
//
// Ownership split now reads:
//   - daemon: SQLite handle, agent resolution, secrets envelope, scheduler,
//     run-cancel registry, messaging RPC dispatch.
//   - pi: conversation transcript, compaction entries, tool execution,
//     provider retries.
//   - this worker: glue between the two — runs `session.prompt(message)`,
//     translates `AgentSessionEvent`s into Bazilion `SessionEvent`s, emits
//     them as NDJSON `ChatFrame`s on stdout.
//
// Cancellation: SIGTERM from the parent → `session.abort()` → pi aborts the
// current prompt → `agent_end` fires with error → translator emits an
// `error` event so the client renders "cancelled" identically to other
// failures.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Attachment, ChatFrame, ResolvedAgent } from '@bazilion/api-types'
import { resolvePaths } from '../../core/index.ts'
import { qmdBackend } from '../memory/qmd.ts'
import { piMessagesToProviderView, translatePiEvent } from '../pi/events.ts'
import { createBazilionSession } from '../pi/session.ts'
import type {
  BrowserHost,
  InjectedMcpTool,
  IpcReply,
  IpcRequest,
  McpHost,
  MessagingHost,
  RpcMethod,
  UserMdGetResult,
  UserMdHost,
  UserMdWriteResult,
} from './ipc-protocol.ts'

interface WorkerInput {
  agent: ResolvedAgent
  message: string
  enabledProviders: string[]
  /** Pre-fetched API key for OAuth providers; undefined for env-key ones. */
  apiKey?: string
  /** When true, expose the `browser_*` tools (proxied to the daemon pool). */
  browserEnabled?: boolean
  /** MCP tools discovered daemon-side, exposed as IPC-proxied proxy tools. */
  mcpTools?: InjectedMcpTool[]
  /** Image attachments — passed to pi's prompt (vision). Pre-classified by the daemon. */
  images?: Attachment[]
}

function emit(frame: ChatFrame): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

async function readInput(): Promise<WorkerInput> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) throw new Error('worker: empty stdin input')
  const parsed = JSON.parse(raw) as WorkerInput
  if (
    !parsed.agent ||
    typeof parsed.message !== 'string' ||
    !Array.isArray(parsed.enabledProviders)
  ) {
    throw new Error('worker: stdin must be {agent, message, enabledProviders}')
  }
  return parsed
}

/**
 * Single shared IPC client. Both `MessagingHost` and `UserMdHost` route
 * through this — the `id` correlation id disambiguates replies, so multiple
 * concurrent tool calls (e.g. read_inbox + user_md_append on the same turn)
 * each get their own promise resolved without crosstalk. The promise
 * rejects when the channel disconnects mid-request; that path only fires
 * during shutdown, where the LLM loop has already been aborted, so the
 * unresolved tool call doesn't matter.
 */
type IpcCall = <T>(method: RpcMethod, args: unknown) => Promise<T>

function createIpcClient(): IpcCall {
  type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void }
  const pending = new Map<string, Pending>()

  process.on('message', (msg: unknown) => {
    if (!isIpcReply(msg)) return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok) entry.resolve(msg.result)
    else entry.reject(new Error(msg.error))
  })

  process.on('disconnect', () => {
    for (const [, entry] of pending) entry.reject(new Error('worker IPC channel disconnected'))
    pending.clear()
  })

  return <T>(method: RpcMethod, args: unknown): Promise<T> => {
    if (!process.send) {
      return Promise.reject(new Error('worker: no IPC channel — daemon must spawn with stdio:ipc'))
    }
    const id = randomUUID()
    // The wire format is uniform "method + args"; the parent's dispatcher
    // re-narrows on `method`. TS can't follow that union construction here,
    // so we cast through unknown rather than push the discrimination through
    // every call site.
    const message = { type: 'rpc', id, method, args } as unknown as IpcRequest
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (v) => resolve(v as T), reject })
      // process.send is fire-and-forget; the callback only signals serialization
      // failure. Treat it as a reject to surface the bug rather than hang.
      process.send?.(message, undefined, undefined, (err) => {
        if (err) {
          pending.delete(id)
          reject(err)
        }
      })
    })
  }
}

function createIpcMessagingHost(call: IpcCall): MessagingHost {
  return {
    agentExists: (agentId) => call<boolean>('agentExists', { agentId }),
    sendMessage: (input) => call<{ messageId: string }>('sendMessage', input),
    listInbox: (agentId, opts) => call('listInbox', { agentId, unreadOnly: opts.unreadOnly }),
    markRead: async (messageId) => {
      await call<null>('markRead', { messageId })
    },
    findReplies: (agentId, replyTo) => call('findReplies', { agentId, replyTo }),
    approvalStatus: (agentId, approvalId) => call('approvalStatus', { agentId, approvalId }),
  }
}

function createIpcUserMdHost(call: IpcCall): UserMdHost {
  return {
    get: (groupId) => call<UserMdGetResult>('userMdGet', { groupId }),
    write: (groupId, content, ifMatch) =>
      call<UserMdWriteResult>('userMdWrite', { groupId, content, ifMatch }),
  }
}

function createIpcBrowserHost(call: IpcCall): BrowserHost {
  return {
    invoke: (agentId, action, args) => call('browserInvoke', { agentId, action, args }),
  }
}

function createIpcMcpHost(call: IpcCall): McpHost {
  return {
    invoke: (serverId, toolName, args) => call('mcpInvoke', { serverId, toolName, args }),
  }
}

function isIpcReply(msg: unknown): msg is IpcReply {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return m.type === 'rpc-reply' && typeof m.id === 'string' && typeof m.ok === 'boolean'
}

async function main(): Promise<void> {
  // Install signal handlers FIRST so a SIGTERM that arrives during setup
  // doesn't kill us with the Node default (exit-by-signal, no frame emitted).
  // Pre-session, we just exit cleanly with a synthetic `cancelled` event;
  // post-session, we delegate to `session.abort()` so pi unwinds the
  // provider fetch and surfaces its own `error` event.
  let aborted = false
  let abortSession: (() => void) | null = null
  const onSignal = (): void => {
    aborted = true
    if (abortSession) {
      abortSession()
    } else {
      try {
        emit({ kind: 'event', event: { type: 'error', error: 'cancelled' } })
      } catch {}
      process.exit(0)
    }
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  const { agent, message, enabledProviders, apiKey, browserEnabled, mcpTools, images } =
    await readInput()

  // Path resolution still happens in the worker — `resolvePaths()` only reads
  // the `BAZILION_HOME` env var the daemon hands down. No DB, no filesystem
  // probe of the live tree.
  const paths = resolvePaths()

  const memory = qmdBackend(join(agent.group.path, 'memory'))
  await memory.init()

  const ipcCall = createIpcClient()
  const messagingHost = createIpcMessagingHost(ipcCall)
  const userMdHost = createIpcUserMdHost(ipcCall)
  const browserHost = browserEnabled ? createIpcBrowserHost(ipcCall) : undefined
  const mcpHost = mcpTools && mcpTools.length > 0 ? createIpcMcpHost(ipcCall) : undefined

  const { session, dispose } = await createBazilionSession({
    agent,
    paths,
    env: process.env,
    memory,
    enabledProviders: new Set(enabledProviders),
    messagingHost,
    userMdHost,
    apiKey,
    browserHost,
    mcpHost,
    mcpTools,
    // deliver_file emits a `file` event straight onto our stdout frame stream.
    fileSink: (f) => emit({ kind: 'event', event: { type: 'file', ...f } }),
  })

  abortSession = (): void => {
    void session.abort()
  }

  const unsubscribe = session.subscribe((piEvent) => {
    for (const ev of translatePiEvent(piEvent)) {
      emit({ kind: 'event', event: ev })
    }
  })

  try {
    // Map Bazilion image attachments to pi's ImageContent and pass them as the
    // prompt's `images` option — the model sees them via vision.
    const promptImages = (images ?? []).map((img) => ({
      type: 'image' as const,
      data: img.data,
      mimeType: img.mimeType,
    }))
    await session.prompt(message, promptImages.length > 0 ? { images: promptImages } : undefined)
    await session.agent.waitForIdle()

    emit({
      kind: 'done',
      messages: piMessagesToProviderView(session.agent.state.messages),
    })
  } catch (err) {
    if (!aborted) {
      emit({ kind: 'event', event: { type: 'error', error: (err as Error).message } })
    }
    emit({ kind: 'fatal', error: (err as Error).message })
    process.exitCode = 1
  } finally {
    unsubscribe()
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    dispose()
    // Detach from the parent's IPC channel so the worker's event loop can
    // exit. `process.on('message', …)` registered above otherwise keeps
    // the loop alive even after the turn finishes — Node treats an open
    // IPC handle as a live ref the same way it treats an open socket.
    try {
      process.disconnect?.()
    } catch {
      // already disconnected (parent closed first) — fine
    }
  }
}

main().catch((err) => {
  try {
    emit({ kind: 'fatal', error: (err as Error)?.message ?? String(err) })
  } catch {}
  process.exit(1)
})

// Parent-side spawn helper for whole-run subprocess isolation.
//
// `spawnWorkerTurn` launches `./entry.ts` and feeds it a `WorkerInput` JSON
// blob on stdin describing the turn to run (pre-resolved agent record,
// enabled-provider set, message text). The worker no longer opens its own
// SQLite handle — the daemon is the sole owner of `~/.bazilion`.
//
// Two channels run between parent and child:
//   - stdout (NDJSON): the worker emits `ChatFrame`s; we line-parse and
//     yield each one to the caller.
//   - IPC (Node `stdio: 'ipc'`): the worker calls back into the parent for
//     anything that needs DB access during the turn (today: the messaging
//     tools `send_message` / `read_inbox` / `wait_for_reply`). We dispatch
//     each `IpcRequest` through the injected `MessagingHost` and reply with
//     `child.send`.
//
// Cancellation: wire an AbortSignal via `opts.signal`. On abort we send
// SIGTERM to the child — the child has a signal handler that calls
// `session.abort()`, which aborts the provider fetch and surfaces a final
// `error` SessionEvent before the worker exits cleanly. If the child doesn't
// exit within `killGraceMs`, we SIGKILL it.

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChatFrame, ImageAttachment, ResolvedAgent } from '@bazilion/api-types'
import type {
  BrowserHost,
  InjectedMcpTool,
  IpcReply,
  IpcRequest,
  McpHost,
  MessagingHost,
  UserMdHost,
} from './ipc-protocol.ts'

const DEFAULT_KILL_GRACE_MS = 3_000

// In dev, this file is at apps/daemon/src/runtime/worker/spawn.ts and the
// worker entry is its `entry.ts` sibling. In the published bundle, all of
// spawn.ts's code is inlined into dist/daemon.js, where `./entry.ts` does
// not exist — the worker is bundled separately to dist/worker.js. Pick at
// load time by probing the filesystem.
const sourceEntryPath = fileURLToPath(new URL('./entry.ts', import.meta.url))
const bundledEntryPath = fileURLToPath(new URL('./worker.js', import.meta.url))
const entryPath = existsSync(sourceEntryPath) ? sourceEntryPath : bundledEntryPath
const entryIsTs = entryPath.endsWith('.ts')

// .ts dev entry: Node 24+ runs TS directly via native type-stripping (no
// `--experimental-strip-types` flag needed in stable 24, but we still pass
// it for older 22.x dev environments). tsx is the fallback for any runtime
// where strip-types is missing. `--no-warnings` silences the experimental
// banner that older Node versions emit on every child start.
//
// .js bundled entry: plain `node entry.js` — no type stripping, no tsx.
function workerSpawnArgs(): string[] {
  if (!entryIsTs) return [entryPath]
  const tsFeature = (process.features as unknown as Record<string, unknown>).typescript
  if (typeof tsFeature === 'string' || tsFeature === true) {
    return ['--experimental-strip-types', '--no-warnings', entryPath]
  }
  return ['--import', tsxImportSpecifier(), entryPath]
}

let cachedTsxImport: string | null = null
function tsxImportSpecifier(): string {
  if (cachedTsxImport) return cachedTsxImport
  // `require.resolve('tsx')` returns the absolute path to tsx's loader.mjs —
  // the ESM module that hooks the runtime. Passing it to `node --import` as a
  // file:// URL is the most portable way to activate tsx in a subprocess: it
  // avoids CWD-sensitive bare-specifier resolution, and works regardless of
  // where the caller lives in a pnpm-hoisted workspace.
  const req = createRequire(import.meta.url)
  cachedTsxImport = pathToFileURL(req.resolve('tsx')).href
  return cachedTsxImport
}

export interface WorkerTurnSpec {
  /** Pre-resolved agent record — the worker never queries the DB itself. */
  agent: ResolvedAgent
  /** First user-message text for this turn. */
  message: string
  /**
   * Names of providers the user has enabled in /config. Empty array means
   * no per-provider gating configured (all providers pass).
   */
  enabledProviders: string[]
  /**
   * Pre-fetched API key for the agent's provider. Required for OAuth-backed
   * providers (`openai-codex`) — the worker has no DB handle to read the
   * secrets table itself. Omit for env-key providers; `pi/session.ts` then
   * derives the key from `process.env`.
   */
  apiKey?: string
  /** When true, expose the `browser_*` tools (proxied to the daemon browser pool). */
  browserEnabled?: boolean
  /** MCP tools discovered daemon-side, exposed as IPC-proxied proxy tools. */
  mcpTools?: InjectedMcpTool[]
  /** Images attached to the user message — passed to pi's prompt (vision). */
  images?: ImageAttachment[]
}

export interface SpawnWorkerOpts {
  /** Abort to kill the in-flight worker. */
  signal?: AbortSignal
  /** ms between SIGTERM and fallback SIGKILL (default 3000). */
  killGraceMs?: number
  /** Override env passed to the child. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /**
   * Daemon-side implementation of the messaging tools the worker calls back
   * into via IPC. Omit only when the caller knows the agent will not invoke
   * any of `send_message` / `read_inbox` / `wait_for_reply` — passing it
   * costs nothing for turns that don't use messaging.
   */
  messagingHost?: MessagingHost
  /**
   * Daemon-side implementation of the USER.md append tool. Omit and the
   * `user_md_append` tool will be unavailable on this turn.
   */
  userMdHost?: UserMdHost
  /**
   * Daemon-side browser pool surface for the `browser_*` tools. Omit when the
   * agent's profile doesn't enable browser automation.
   */
  browserHost?: BrowserHost
  /**
   * Daemon-side MCP connection pool surface for proxied MCP tools. Omit when no
   * MCP servers are configured/enabled.
   */
  mcpHost?: McpHost
}

export async function* spawnWorkerTurn(
  spec: WorkerTurnSpec,
  opts: SpawnWorkerOpts = {},
): AsyncGenerator<ChatFrame, void, void> {
  const child = spawn(process.execPath, workerSpawnArgs(), {
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
  })

  if (opts.messagingHost || opts.userMdHost || opts.browserHost || opts.mcpHost) {
    attachIpcHandler(child, {
      messagingHost: opts.messagingHost,
      userMdHost: opts.userMdHost,
      browserHost: opts.browserHost,
      mcpHost: opts.mcpHost,
    })
  }

  child.stdin?.write(JSON.stringify(spec))
  child.stdin?.end()

  const grace = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  let killTimer: NodeJS.Timeout | null = null
  const onAbort = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {
      // process may have already exited between our check and the kill
    }
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {}
      }
    }, grace)
    killTimer.unref()
  }
  if (opts.signal?.aborted) onAbort()
  else opts.signal?.addEventListener('abort', onAbort)

  const waitForExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> = new Promise(
    (resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode })
        return
      }
      child.once('close', (code, signal) => resolve({ code, signal }))
    },
  )

  let emittedFatal = false

  try {
    let buf = ''
    if (!child.stdout) throw new Error('worker spawn: stdout pipe missing')
    for await (const chunk of child.stdout) {
      buf += (chunk as Buffer).toString('utf8')
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line.trim()) {
          const frame = parseFrame(line)
          if (frame.kind === 'fatal') emittedFatal = true
          yield frame
        }
        idx = buf.indexOf('\n')
      }
    }
    if (buf.trim()) {
      const frame = parseFrame(buf)
      if (frame.kind === 'fatal') emittedFatal = true
      yield frame
    }

    const exit = await waitForExit
    // Child exited without emitting a fatal frame but with non-zero status —
    // surface that so the caller doesn't silently swallow a crash. Cancelled
    // turns produce an `error` SessionEvent via the worker's signal handler
    // and exit cleanly with code 0; only truly unexpected exits hit this.
    if (!emittedFatal && exit.code !== 0 && exit.code !== null) {
      yield {
        kind: 'fatal',
        error: `worker exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ''}`,
      }
    } else if (!emittedFatal && exit.signal && exit.code === null) {
      yield { kind: 'fatal', error: `worker killed by ${exit.signal}` }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    if (killTimer) clearTimeout(killTimer)
    try {
      child.disconnect()
    } catch {
      // already disconnected (child closed first) — fine
    }
  }
}

function parseFrame(line: string): ChatFrame {
  try {
    return JSON.parse(line) as ChatFrame
  } catch {
    return { kind: 'fatal', error: `worker emitted malformed frame: ${line.slice(0, 200)}` }
  }
}

interface IpcHosts {
  messagingHost?: MessagingHost
  userMdHost?: UserMdHost
  browserHost?: BrowserHost
  mcpHost?: McpHost
}

function attachIpcHandler(child: ChildProcess, hosts: IpcHosts): void {
  child.on('message', (msg: unknown) => {
    if (!isIpcRequest(msg)) return
    void dispatch(msg, hosts).then((reply) => {
      try {
        child.send?.(reply)
      } catch {
        // child may have exited between request and reply — drop silently
      }
    })
  })
}

function isIpcRequest(msg: unknown): msg is IpcRequest {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return m.type === 'rpc' && typeof m.id === 'string' && typeof m.method === 'string'
}

function require<T>(host: T | undefined, kind: string, method: string): T {
  if (!host) throw new Error(`worker called ${kind} method "${method}" without a ${kind}Host`)
  return host
}

async function dispatch(req: IpcRequest, hosts: IpcHosts): Promise<IpcReply> {
  try {
    let result: unknown
    switch (req.method) {
      case 'agentExists':
        result = await require(hosts.messagingHost, 'messaging', req.method).agentExists(
          req.args.agentId,
        )
        break
      case 'sendMessage':
        result = await require(hosts.messagingHost, 'messaging', req.method).sendMessage(req.args)
        break
      case 'listInbox':
        result = await require(hosts.messagingHost, 'messaging', req.method).listInbox(
          req.args.agentId,
          { unreadOnly: req.args.unreadOnly },
        )
        break
      case 'markRead':
        await require(hosts.messagingHost, 'messaging', req.method).markRead(req.args.messageId)
        result = null
        break
      case 'findReplies':
        result = await require(hosts.messagingHost, 'messaging', req.method).findReplies(
          req.args.agentId,
          req.args.replyTo,
        )
        break
      case 'userMdGet':
        result = await require(hosts.userMdHost, 'userMd', req.method).get(req.args.groupId)
        break
      case 'userMdWrite':
        result = await require(hosts.userMdHost, 'userMd', req.method).write(
          req.args.groupId,
          req.args.content,
          req.args.ifMatch,
        )
        break
      case 'browserInvoke':
        result = await require(hosts.browserHost, 'browser', req.method).invoke(
          req.args.agentId,
          req.args.action,
          req.args.args,
        )
        break
      case 'mcpInvoke':
        result = await require(hosts.mcpHost, 'mcp', req.method).invoke(
          req.args.serverId,
          req.args.toolName,
          req.args.args,
        )
        break
    }
    return { type: 'rpc-reply', id: req.id, ok: true, result }
  } catch (err) {
    return { type: 'rpc-reply', id: req.id, ok: false, error: (err as Error).message }
  }
}

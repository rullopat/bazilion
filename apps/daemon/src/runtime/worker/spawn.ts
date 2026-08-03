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
//     daemon-owned tools, OAuth refresh, and dangerous-command approval. We dispatch each
//     `IpcRequest` through the corresponding injected host and reply with
//     `child.send`; approval state is also merged into the stdout frame stream.
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
import type { Attachment, BashApprovalMode, ChatFrame, ResolvedAgent } from '@bazilion/api-types'
import { type ApiKeyRefreshTurnContext, refreshApiKeyForTurn } from './api-key-refresh.ts'
import type {
  ApiKeyRefreshHost,
  BashApprovalHost,
  BashApprovalResult,
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

// .ts dev entry: Node 24+ runs TS directly via native type-stripping (no
// `--experimental-strip-types` flag needed in stable 24, but we still pass
// it for older 22.x dev environments). tsx is the fallback for any runtime
// where strip-types is missing. `--no-warnings` silences the experimental
// banner that older Node versions emit on every child start.
//
// .js bundled entry: plain `node entry.js` — no type stripping, no tsx.
function workerSpawnArgs(workerEntryPath = entryPath): string[] {
  const workerEntryIsTs = workerEntryPath.endsWith('.ts')
  if (!workerEntryIsTs) return [workerEntryPath]
  const tsFeature = (process.features as unknown as Record<string, unknown>).typescript
  if (typeof tsFeature === 'string' || tsFeature === true) {
    return ['--experimental-strip-types', '--no-warnings', workerEntryPath]
  }
  return ['--import', tsxImportSpecifier(), workerEntryPath]
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
  /** Image attachments — passed to pi's prompt (vision). Pre-classified by the daemon. */
  images?: Attachment[]
  /** Stable identity used to scope ephemeral command approvals. */
  turnId: string
  /** Whether this turn's caller can answer an approval request. */
  bashApprovalMode: BashApprovalMode
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
  /** Turn-scoped dangerous-command approval registry owned by the daemon. */
  bashApprovalHost?: BashApprovalHost
  /** Daemon-side OAuth refresh callback; present only for `openai-codex` turns. */
  apiKeyRefreshHost?: ApiKeyRefreshHost
  /** Internal integration-test override. Never populate from user-controlled input. */
  workerEntryPath?: string
}

export async function* spawnWorkerTurn(
  spec: WorkerTurnSpec,
  opts: SpawnWorkerOpts = {},
): AsyncGenerator<ChatFrame, void, void> {
  const child = spawn(process.execPath, workerSpawnArgs(opts.workerEntryPath), {
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
  })

  const frames = new AsyncFrameQueue()
  const ipcLifetime = new AbortController()

  if (
    opts.messagingHost ||
    opts.userMdHost ||
    opts.browserHost ||
    opts.mcpHost ||
    opts.bashApprovalHost ||
    opts.apiKeyRefreshHost
  ) {
    attachIpcHandler(child, {
      messagingHost: opts.messagingHost,
      userMdHost: opts.userMdHost,
      browserHost: opts.browserHost,
      mcpHost: opts.mcpHost,
      bashApprovalHost: opts.bashApprovalHost,
      apiKeyRefreshHost: opts.apiKeyRefreshHost,
      apiKeyRefreshContext: {
        providerName: spec.agent.model.split(':', 1)[0] ?? '',
        agentId: spec.agent.agent.id,
        turnId: spec.turnId,
      },
      ipcSignal: ipcLifetime.signal,
      onBashApproval: (approval) => {
        frames.push({ kind: 'event', event: { type: 'command_approval', approval } })
      },
    })
  }

  child.stdin?.write(
    JSON.stringify({
      ...spec,
      apiKeyRefreshEnabled: opts.apiKeyRefreshHost !== undefined,
    }),
  )
  child.stdin?.end()

  const grace = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  let killTimer: NodeJS.Timeout | null = null
  const onAbort = (): void => {
    ipcLifetime.abort()
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
    if (!child.stdout) throw new Error('worker spawn: stdout pipe missing')
    const stdoutTask = pumpWorkerFrames(child.stdout, frames)
    for await (const frame of frames) {
      if (frame.kind === 'fatal') emittedFatal = true
      yield frame
    }
    await stdoutTask

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
    ipcLifetime.abort()
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
  bashApprovalHost?: BashApprovalHost
  apiKeyRefreshHost?: ApiKeyRefreshHost
  apiKeyRefreshContext?: ApiKeyRefreshTurnContext
  ipcSignal?: AbortSignal
  onBashApproval?: (approval: import('@bazilion/api-types').CommandApproval) => void
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
      case 'approvalStatus':
        result = await require(hosts.messagingHost, 'messaging', req.method).approvalStatus(
          req.args.agentId,
          req.args.approvalId,
        )
        break
      case 'userMdGet':
        result = await require(hosts.userMdHost, 'userMd', req.method).get(req.args.teamId)
        break
      case 'userMdWrite':
        result = await require(hosts.userMdHost, 'userMd', req.method).write(
          req.args.teamId,
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
      case 'refreshApiKey':
        result = await refreshApiKeyForTurn(
          req.args,
          require(hosts.apiKeyRefreshContext, 'apiKeyRefreshContext', req.method),
          hosts.apiKeyRefreshHost,
          hosts.ipcSignal,
        )
        break
      case 'bashApproval': {
        const handle = require(hosts.bashApprovalHost, 'bashApproval', req.method).begin(
          req.args,
          hosts.ipcSignal,
        )
        hosts.onBashApproval?.(handle.approval)
        const decision = await handle.decision
        result = decision
        if (handle.approval.status === 'pending') {
          hosts.onBashApproval?.({
            ...handle.approval,
            status: approvalStatusForDecision(decision),
          })
        }
        break
      }
    }
    return { type: 'rpc-reply', id: req.id, ok: true, result }
  } catch (err) {
    return { type: 'rpc-reply', id: req.id, ok: false, error: (err as Error).message }
  }
}

function approvalStatusForDecision(
  result: BashApprovalResult,
): 'allowed' | 'denied' | 'auto_denied' | 'expired' | 'cancelled' {
  if (result.reason === 'auto_deny') return 'auto_denied'
  if (result.reason === 'timeout') return 'expired'
  if (result.reason === 'cancelled') return 'cancelled'
  return result.decision === 'allow' ? 'allowed' : 'denied'
}

class AsyncFrameQueue implements AsyncIterable<ChatFrame> {
  readonly #frames: ChatFrame[] = []
  readonly #waiters: Array<(item: IteratorResult<ChatFrame>) => void> = []
  #ended = false

  push(frame: ChatFrame): void {
    if (this.#ended) return
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value: frame })
    else this.#frames.push(frame)
  }

  end(): void {
    if (this.#ended) return
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatFrame> {
    return {
      next: () => {
        const frame = this.#frames.shift()
        if (frame) return Promise.resolve({ done: false, value: frame })
        if (this.#ended) return Promise.resolve({ done: true, value: undefined })
        return new Promise((resolve) => this.#waiters.push(resolve))
      },
    }
  }
}

async function pumpWorkerFrames(
  stdout: NonNullable<ChildProcess['stdout']>,
  frames: AsyncFrameQueue,
): Promise<void> {
  let buf = ''
  try {
    for await (const chunk of stdout) {
      buf += (chunk as Buffer).toString('utf8')
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line.trim()) frames.push(parseFrame(line))
        idx = buf.indexOf('\n')
      }
    }
    if (buf.trim()) frames.push(parseFrame(buf))
  } catch (error) {
    frames.push({ kind: 'fatal', error: `worker stdout failed: ${(error as Error).message}` })
  } finally {
    frames.end()
  }
}

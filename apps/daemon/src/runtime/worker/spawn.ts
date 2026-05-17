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
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChatFrame, ResolvedAgent } from '@bazilion/api-types'
import type { IpcReply, IpcRequest, MessagingHost } from './ipc-protocol.ts'

const DEFAULT_KILL_GRACE_MS = 3_000

const entryPath = fileURLToPath(new URL('./entry.ts', import.meta.url))

// Node 22.12+ (the project's minimum) runs `.ts` files directly via
// `--experimental-strip-types`, which just strips type annotations without
// any transform / loader plumbing. We prefer it over tsx for worker spawns
// because it shaves ~1s off the subprocess boot (no tsx module to resolve,
// no TypeScript compiler to initialize per turn). tsx remains available as
// a fallback for environments where strip-types is disabled — detected at
// spawn time by probing `process.features.typescript`.
//
// `--no-warnings` silences Node's "ExperimentalWarning: Type Stripping"
// banner that would otherwise appear on every child start.
function workerSpawnArgs(): string[] {
  // `process.features.typescript` is 'strip' on builds where strip-types is
  // enabled, 'transform' on nightly/experimental, undefined otherwise. Cast
  // through unknown because the typing of ProcessFeatures doesn't yet
  // include this field in our @types/node.
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
}

export async function* spawnWorkerTurn(
  spec: WorkerTurnSpec,
  opts: SpawnWorkerOpts = {},
): AsyncGenerator<ChatFrame, void, void> {
  const child = spawn(process.execPath, workerSpawnArgs(), {
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
  })

  if (opts.messagingHost) attachIpcHandler(child, opts.messagingHost)

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

function attachIpcHandler(child: ChildProcess, host: MessagingHost): void {
  child.on('message', (msg: unknown) => {
    if (!isIpcRequest(msg)) return
    void dispatch(msg, host).then((reply) => {
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

async function dispatch(req: IpcRequest, host: MessagingHost): Promise<IpcReply> {
  try {
    let result: unknown
    switch (req.method) {
      case 'agentExists':
        result = await host.agentExists(req.args.agentId)
        break
      case 'sendMessage':
        result = await host.sendMessage(req.args)
        break
      case 'listInbox':
        result = await host.listInbox(req.args.agentId, { unreadOnly: req.args.unreadOnly })
        break
      case 'markRead':
        await host.markRead(req.args.messageId)
        result = null
        break
      case 'findReplies':
        result = await host.findReplies(req.args.agentId, req.args.replyTo)
        break
    }
    return { type: 'rpc-reply', id: req.id, ok: true, result }
  } catch (err) {
    return { type: 'rpc-reply', id: req.id, ok: false, error: (err as Error).message }
  }
}

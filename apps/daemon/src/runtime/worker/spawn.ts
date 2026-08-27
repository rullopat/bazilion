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
import { isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChatFrame } from '@bazilion/api-types'
import { type ApiKeyRefreshTurnContext, refreshApiKeyForTurn } from './api-key-refresh.ts'
import type {
  ApiKeyRefreshHost,
  BashApprovalHost,
  BashApprovalResult,
  BrowserHost,
  IpcReply,
  IpcRequest,
  McpHost,
  MessagingHost,
  UserMdHost,
} from './ipc-protocol.ts'
import {
  type ConfiguredOperatorHttpWorkerSpec,
  cleanupMinimalWorkerScratch,
  createMinimalWorkerScratch,
  ExactValueStreamRedactor,
  minimalWorkerProcessEnv,
  type ProtectedWorkerSpec,
  parseWorkerInput,
  protectedRuntimeSecrets,
  type RestrictedReviewWorkerSpec,
  redactExactValue,
  redactJsonValue,
  type WorkerInput,
  type WorkerTurnSpec,
} from './runtime.ts'

const DEFAULT_KILL_GRACE_MS = 3_000
const MAX_WORKER_STDERR_CHARS = 16 * 1024
const MAX_WORKER_FRAME_CHARS = 40 * 1024 * 1024
const MAX_MINIMAL_WORKER_INPUT_BYTES = 64 * 1024 * 1024

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

export interface ReviewWorkerProposal {
  scope: 'private' | 'shared'
  text: string
  evidenceEntryIds: Array<{ sessionId: string; entryOrdinal: number }>
}

type WorkerOutputFrame = ChatFrame | { kind: 'review_result'; proposals: ReviewWorkerProposal[] }

export async function spawnReviewWorker(
  spec: RestrictedReviewWorkerSpec,
  opts: RestrictedReviewSpawnWorkerOpts,
): Promise<ReviewWorkerProposal[]> {
  for await (const rawFrame of spawnWorker(spec, opts)) {
    const frame = rawFrame as
      | ChatFrame
      | { kind: 'review_result'; proposals: ReviewWorkerProposal[] }
    if (frame.kind === 'review_result') return frame.proposals
    if (frame.kind === 'fatal') throw new Error(frame.error)
  }
  throw new Error('review worker exited without a result')
}

interface CommonSpawnWorkerOpts {
  /** Abort to kill the in-flight worker. */
  signal?: AbortSignal
  /** ms between SIGTERM and fallback SIGKILL (default 3000). */
  killGraceMs?: number
  /** Receives one bounded, already-redacted diagnostic after the child exits. */
  diagnosticSink?: (message: string) => void
  /** Internal integration-test override. Must be absolute. */
  workerEntryPath?: string
  /** Internal integration-test override for observing scratch cleanup. */
  scratchParentDir?: string
  /** Internal integration-test override for the per-NDJSON-frame bound. */
  maxFrameChars?: number
  /** Internal integration-test override for the protected/review stdin byte bound. */
  maxInputBytes?: number
}

export interface ConfiguredSpawnWorkerOpts extends CommonSpawnWorkerOpts {
  /** Explicit legacy configured environment. There is intentionally no default. */
  env: NodeJS.ProcessEnv
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
}

export interface ProtectedSpawnWorkerOpts extends CommonSpawnWorkerOpts {
  messagingHost: MessagingHost
  userMdHost: UserMdHost
  bashApprovalHost: BashApprovalHost
  apiKeyRefreshHost: ApiKeyRefreshHost
}

export interface RestrictedReviewSpawnWorkerOpts extends CommonSpawnWorkerOpts {
  apiKeyRefreshHost: ApiKeyRefreshHost
}

export type SpawnWorkerOpts =
  | ConfiguredSpawnWorkerOpts
  | ProtectedSpawnWorkerOpts
  | RestrictedReviewSpawnWorkerOpts

export function spawnWorkerTurn(
  spec: ConfiguredOperatorHttpWorkerSpec,
  opts: ConfiguredSpawnWorkerOpts,
): AsyncGenerator<ChatFrame, void, void>
export function spawnWorkerTurn(
  spec: ProtectedWorkerSpec,
  opts: ProtectedSpawnWorkerOpts,
): AsyncGenerator<ChatFrame, void, void>
export function spawnWorkerTurn(
  spec: WorkerTurnSpec,
  opts: ConfiguredSpawnWorkerOpts | ProtectedSpawnWorkerOpts,
): AsyncGenerator<ChatFrame, void, void> {
  return spawnWorker(spec, opts) as AsyncGenerator<ChatFrame, void, void>
}

async function* spawnWorker(
  spec: WorkerTurnSpec | RestrictedReviewWorkerSpec,
  opts: SpawnWorkerOpts,
): AsyncGenerator<WorkerOutputFrame, void, void> {
  assertSpawnCombination(spec, opts)
  const requestedEntry = opts.workerEntryPath ?? entryPath
  if (!isAbsolute(requestedEntry)) throw new Error('worker entry path must be absolute')

  if (opts.scratchParentDir !== undefined && !isAbsolute(opts.scratchParentDir)) {
    throw new Error('worker scratch parent path must be absolute')
  }
  if (
    opts.maxFrameChars !== undefined &&
    (!Number.isSafeInteger(opts.maxFrameChars) || opts.maxFrameChars < 1)
  ) {
    throw new Error('worker frame bound must be a positive safe integer')
  }
  if (
    opts.maxInputBytes !== undefined &&
    (!Number.isSafeInteger(opts.maxInputBytes) || opts.maxInputBytes < 1)
  ) {
    throw new Error('worker input bound must be a positive safe integer')
  }
  const scratch =
    spec.kind === 'configured_operator_http'
      ? undefined
      : createMinimalWorkerScratch(opts.scratchParentDir)
  let env: NodeJS.ProcessEnv
  let input: WorkerInput
  let serializedInput: string
  try {
    env =
      spec.kind === 'configured_operator_http'
        ? (opts as ConfiguredSpawnWorkerOpts).env
        : minimalWorkerProcessEnv(scratch as NonNullable<typeof scratch>)
    input =
      spec.kind === 'configured_operator_http'
        ? {
            ...spec,
            apiKeyRefreshEnabled:
              (opts as ConfiguredSpawnWorkerOpts).apiKeyRefreshHost !== undefined,
          }
        : { ...spec, apiKeyRefreshEnabled: true, scratch: scratch as NonNullable<typeof scratch> }
    parseWorkerInput(input)
    const validatedJson = JSON.stringify(input)
    if (input.kind !== 'configured_operator_http') {
      // The selected access token is allowed on this private wire only in the
      // closed runtime field. Exact-redact an accidental duplicate from all
      // other per-turn material before restoring that one designated value.
      const secrets = protectedRuntimeSecrets(input.runtime)
      const scrubbed = redactJsonValue(JSON.parse(validatedJson) as typeof input, secrets)
      input = {
        ...scrubbed,
        runtime: input.runtime,
      }
      parseWorkerInput(input)
    }
    serializedInput =
      input.kind === 'configured_operator_http' ? validatedJson : JSON.stringify(input)
    if (
      input.kind !== 'configured_operator_http' &&
      Buffer.byteLength(serializedInput, 'utf8') >
        (opts.maxInputBytes ?? MAX_MINIMAL_WORKER_INPUT_BYTES)
    ) {
      throw new Error('minimal worker input exceeded the maximum size')
    }
  } catch (error) {
    if (scratch) cleanupMinimalWorkerScratch(scratch)
    throw error
  }
  const accessTokens =
    spec.kind === 'configured_operator_http'
      ? spec.apiKey
        ? [spec.apiKey]
        : []
      : protectedRuntimeSecrets(spec.runtime)
  const stderrRedactor =
    accessTokens.length > 0 ? new ExactValueStreamRedactor(accessTokens) : undefined

  let child: ChildProcess
  try {
    child = spawn(process.execPath, workerSpawnArgs(requestedEntry), {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })
  } catch (error) {
    if (scratch) cleanupMinimalWorkerScratch(scratch)
    throw error
  }

  const frames = new AsyncFrameQueue<WorkerOutputFrame>()
  const ipcLifetime = new AbortController()
  const hosts = spawnHosts(
    spec,
    opts,
    ipcLifetime.signal,
    (approval) => {
      frames.push(
        redactJsonValue(
          { kind: 'event', event: { type: 'command_approval', approval } } as ChatFrame,
          accessTokens,
        ),
      )
    },
    (token) => {
      if (!accessTokens.includes(token)) accessTokens.push(token)
      stderrRedactor?.add(token)
    },
  )
  attachIpcHandler(child, hosts, () => accessTokens)
  child.once('error', (error) => {
    frames.push({
      kind: 'fatal',
      error: `worker process failed: ${accessTokens.reduce(redactExactValue, error.message)}`,
    })
  })

  child.stdin?.on('error', (error) => {
    frames.push({
      kind: 'fatal',
      error: `worker stdin failed: ${accessTokens.reduce(redactExactValue, error.message)}`,
    })
  })

  const stderrCapture = new BoundedTextCapture(MAX_WORKER_STDERR_CHARS)
  const stderrTask = child.stderr
    ? pumpWorkerStderr(child.stderr, stderrCapture, stderrRedactor).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        stderrCapture.append(
          `worker stderr failed: ${accessTokens.reduce(redactExactValue, message)}`,
        )
      })
    : Promise.resolve()
  const grace = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  let killTimer: NodeJS.Timeout | null = null
  const onAbort = (): void => {
    ipcLifetime.abort()
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {}
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
  let diagnosticReported = false

  try {
    if (!child.stdout) throw new Error('worker spawn: stdout pipe missing')
    child.stdin?.write(serializedInput)
    child.stdin?.end()
    const stdoutTask = pumpWorkerFrames(
      child.stdout,
      frames,
      () => accessTokens,
      opts.maxFrameChars ?? MAX_WORKER_FRAME_CHARS,
      onAbort,
    )
    for await (const frame of frames) {
      if (frame.kind === 'fatal') emittedFatal = true
      yield frame
    }
    await stdoutTask
    const exit = await waitForExit
    await stderrTask
    const diagnostic = stderrCapture.value().trim()
    if (diagnostic) {
      opts.diagnosticSink?.(diagnostic)
      diagnosticReported = true
    }

    if (!emittedFatal && exit.code !== 0 && exit.code !== null) {
      yield {
        kind: 'fatal',
        error: appendDiagnostic(
          `worker exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ''}`,
          diagnostic,
        ),
      }
    } else if (!emittedFatal && exit.signal && exit.code === null) {
      yield {
        kind: 'fatal',
        error: appendDiagnostic(`worker killed by ${exit.signal}`, diagnostic),
      }
    }
  } finally {
    ipcLifetime.abort()
    opts.signal?.removeEventListener('abort', onAbort)
    // Async-generator consumers may stop after any frame. Do not remove the
    // child's scratch tree out from under a still-running process: terminate
    // it first, wait for descriptor closure, then erase the per-turn tree.
    if (child.exitCode === null && child.signalCode === null) onAbort()
    try {
      await waitForExit
    } catch {}
    try {
      await stderrTask
    } catch {}
    if (killTimer) clearTimeout(killTimer)
    if (!diagnosticReported) {
      const diagnostic = stderrCapture.value().trim()
      if (diagnostic) opts.diagnosticSink?.(diagnostic)
    }
    try {
      child.disconnect()
    } catch {}
    if (scratch) cleanupMinimalWorkerScratch(scratch)
  }
}

function assertSpawnCombination(
  spec: WorkerTurnSpec | RestrictedReviewWorkerSpec,
  opts: SpawnWorkerOpts,
): void {
  const record = opts as unknown as Record<string, unknown>
  if (spec.kind === 'configured_operator_http') {
    if (!('env' in record) || !record.env || typeof record.env !== 'object') {
      throw new Error('configured operator worker requires an explicit environment')
    }
    return
  }
  if ('env' in record) throw new Error(`${spec.kind} worker rejects a configured environment`)
  if (!hostHasMethods(opts.apiKeyRefreshHost, ['refresh'])) {
    throw new Error(`${spec.kind} worker requires bound API key refresh`)
  }
  if (spec.kind === 'protected') {
    const protectedOptions = opts as ProtectedSpawnWorkerOpts
    if (
      !hostHasMethods(protectedOptions.messagingHost, [
        'agentExists',
        'sendMessage',
        'listInbox',
        'markRead',
        'findReplies',
        'approvalStatus',
      ]) ||
      !hostHasMethods(protectedOptions.userMdHost, ['get', 'write']) ||
      !hostHasMethods(protectedOptions.bashApprovalHost, ['begin'])
    ) {
      throw new Error('protected worker requires its scoped IPC capabilities')
    }
    if ('browserHost' in record || 'mcpHost' in record) {
      throw new Error('protected worker rejects browser and MCP capabilities')
    }
  } else {
    for (const forbidden of [
      'messagingHost',
      'userMdHost',
      'bashApprovalHost',
      'browserHost',
      'mcpHost',
    ]) {
      if (forbidden in record) throw new Error(`restricted review rejects ${forbidden}`)
    }
  }
}

function hostHasMethods(value: unknown, methods: readonly string[]): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return methods.every((method) => typeof record[method] === 'function')
}

function spawnHosts(
  spec: WorkerTurnSpec | RestrictedReviewWorkerSpec,
  opts: SpawnWorkerOpts,
  signal: AbortSignal,
  onBashApproval: NonNullable<IpcHosts['onBashApproval']>,
  onApiKeyRefreshed: NonNullable<IpcHosts['onApiKeyRefreshed']>,
): IpcHosts {
  const configured = spec.kind === 'configured_operator_http'
  const protectedTurn = spec.kind === 'protected'
  const configuredOpts = configured ? (opts as ConfiguredSpawnWorkerOpts) : undefined
  const protectedOpts = protectedTurn ? (opts as ProtectedSpawnWorkerOpts) : undefined
  return {
    messagingHost: configuredOpts?.messagingHost ?? protectedOpts?.messagingHost,
    userMdHost: configuredOpts?.userMdHost ?? protectedOpts?.userMdHost,
    browserHost: configuredOpts?.browserHost,
    mcpHost: configuredOpts?.mcpHost,
    bashApprovalHost: configuredOpts?.bashApprovalHost ?? protectedOpts?.bashApprovalHost,
    apiKeyRefreshHost: opts.apiKeyRefreshHost,
    apiKeyRefreshContext: {
      providerName:
        spec.kind === 'configured_operator_http'
          ? (spec.agent.model.split(':', 1)[0] ?? '')
          : spec.runtime.providerName,
      agentId:
        spec.kind === 'configured_operator_http' || spec.kind === 'protected'
          ? spec.agent.agent.id
          : spec.agentId,
      turnId: spec.turnId,
    },
    ipcSignal: signal,
    onBashApproval,
    onApiKeyRefreshed,
  }
}

function parseFrame(line: string, accessTokens: readonly string[]): ChatFrame {
  try {
    return redactJsonValue(JSON.parse(line) as ChatFrame, accessTokens)
  } catch {
    return {
      kind: 'fatal',
      error: `worker emitted malformed frame: ${accessTokens.reduce(redactExactValue, line).slice(0, 200)}`,
    }
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
  onApiKeyRefreshed?: (accessToken: string) => void
}

function attachIpcHandler(
  child: ChildProcess,
  hosts: IpcHosts,
  accessTokens: () => readonly string[],
): void {
  child.on('message', (msg: unknown) => {
    if (!isIpcRequest(msg)) return
    void dispatch(msg, hosts).then((reply) => {
      try {
        // A successful refresh is the one IPC payload explicitly allowed to
        // carry the new token. Every other daemon reply is sanitized before it
        // enters the worker, including bounded refresh failures.
        const safeReply =
          msg.method === 'refreshApiKey' && reply.ok
            ? reply
            : redactJsonValue(reply, accessTokens())
        child.send?.(safeReply)
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
        if (typeof result === 'string') hosts.onApiKeyRefreshed?.(result)
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

class AsyncFrameQueue<T> implements AsyncIterable<T> {
  readonly #frames: T[] = []
  readonly #waiters: Array<(item: IteratorResult<T>) => void> = []
  #ended = false

  push(frame: T): void {
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

  [Symbol.asyncIterator](): AsyncIterator<T> {
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
  frames: AsyncFrameQueue<WorkerOutputFrame>,
  accessTokens: () => readonly string[],
  maxFrameChars: number,
  onProtocolViolation: () => void,
): Promise<void> {
  let buf = ''
  try {
    for await (const chunk of stdout) {
      buf += (chunk as Buffer).toString('utf8')
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line.length > maxFrameChars) {
          frames.push({ kind: 'fatal', error: 'worker frame exceeded the maximum size' })
          onProtocolViolation()
          return
        }
        if (line.trim()) frames.push(parseFrame(line, accessTokens()))
        idx = buf.indexOf('\n')
      }
      if (buf.length > maxFrameChars) {
        frames.push({ kind: 'fatal', error: 'worker frame exceeded the maximum size' })
        onProtocolViolation()
        return
      }
    }
    if (buf.length > maxFrameChars) {
      frames.push({ kind: 'fatal', error: 'worker frame exceeded the maximum size' })
      onProtocolViolation()
    } else if (buf.trim()) frames.push(parseFrame(buf, accessTokens()))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    frames.push({
      kind: 'fatal',
      error: `worker stdout failed: ${accessTokens().reduce(redactExactValue, message)}`,
    })
  } finally {
    frames.end()
  }
}

class BoundedTextCapture {
  #value = ''

  constructor(readonly maxChars: number) {}

  append(value: string): void {
    this.#value = `${this.#value}${value}`.slice(-this.maxChars)
  }

  value(): string {
    return this.#value
  }
}

async function pumpWorkerStderr(
  stderr: NonNullable<ChildProcess['stderr']>,
  capture: BoundedTextCapture,
  redactor?: ExactValueStreamRedactor,
): Promise<void> {
  if (!redactor) {
    for await (const chunk of stderr) capture.append((chunk as Buffer).toString('utf8'))
    return
  }
  for await (const chunk of stderr)
    capture.append(redactor.push((chunk as Buffer).toString('utf8')))
  capture.append(redactor.flush())
}

function appendDiagnostic(message: string, diagnostic: string): string {
  return diagnostic ? `${message}: ${diagnostic}` : message
}

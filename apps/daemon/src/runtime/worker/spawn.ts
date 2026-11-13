// Parent side of the per-turn worker.
//
// `spawnWorkerTurn` (an Agent turn) and `spawnReviewWorker` (a learning review) start `entry.ts`
// in a fresh Node process, write one JSON `WorkerInput` to its stdin and read NDJSON frames from
// its stdout. Over the Node IPC channel the worker calls the daemon for everything the daemon
// owns; `RPC_HANDLERS` answers each call with the matching host from `WorkerHosts`. Frames,
// replies and stderr are redacted for the turn's access tokens, including refreshed ones.
//
// Cancellation: abort `signal`. The worker leads its own process group: SIGTERM makes it abort its
// Pi session and exit, SIGKILL follows after a 3 s grace. When the worker exits, whatever it left
// in its group is killed at once and its pipes are read for one more second at most. The worker
// also stops when its IPC channel disconnects.

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatFrame, CommandApproval } from '@bazilion/api-types'
import { parseModelString } from '../../core/providers.ts'
import { formatNativeModuleAbiMismatch } from '../../lib/native-module-error.ts'
import { refreshApiKeyForTurn } from './api-key-refresh.ts'
import type {
  ApiKeyRefreshHost,
  IpcReply,
  IpcRequest,
  RpcMethod,
  RpcMethods,
  WorkerHostName,
  WorkerHosts,
} from './ipc-protocol.ts'
import {
  type AgentTurnWorkerSpec,
  cleanupMinimalWorkerScratch,
  createMinimalWorkerScratch,
  ExactValueStreamRedactor,
  minimalWorkerProcessEnv,
  type RestrictedReviewWorkerSpec,
  type ReviewWorkerProposal,
  redactExactValues,
  redactJsonValue,
  reviewRuntimeSecrets,
  type WorkerFrame,
  type WorkerInput,
} from './runtime.ts'

const KILL_GRACE_MS = 3_000
/** How long after the worker exits its pipes are still read; a leftover holder cannot stall the turn. */
const EXIT_DRAIN_MS = 1_000
const MAX_WORKER_STDERR_CHARS = 16 * 1024
/** The longest stdout line the daemon buffers; a longer one fails the turn. */
const MAX_WORKER_FRAME_CHARS = 40 * 1024 * 1024

// In dev the worker entry is this file's `entry.ts` sibling, run with Node's type stripping. The
// published bundle inlines this code into dist/daemon.js and ships the worker as dist/worker.js.
const sourceEntryPath = fileURLToPath(new URL('./entry.ts', import.meta.url))
const bundledEntryPath = fileURLToPath(new URL('./worker.js', import.meta.url))
const entryPath = existsSync(sourceEntryPath) ? sourceEntryPath : bundledEntryPath

interface SpawnOptions {
  /** Abort to stop the worker. */
  signal?: AbortSignal
  /** Receives the worker's bounded, redacted stderr once it has exited. */
  diagnosticSink?: (message: string) => void
  /** Tests: the absolute path of a fixture entry that replaces `entry.ts`. */
  workerEntryPath?: string
}

export interface AgentTurnSpawnOptions extends SpawnOptions, WorkerHosts {
  /** The worker's environment (the merged daemon env). There is intentionally no default. */
  env: NodeJS.ProcessEnv
}

export interface ReviewSpawnOptions extends SpawnOptions {
  apiKeyRefreshHost?: ApiKeyRefreshHost
}

/** Run one Agent turn in a worker and stream its frames. */
export function spawnWorkerTurn(
  spec: AgentTurnWorkerSpec,
  opts: AgentTurnSpawnOptions,
): AsyncGenerator<ChatFrame, void, void> {
  const { env, signal, diagnosticSink, workerEntryPath, ...hosts } = opts
  return runWorker({
    input: { ...spec, hosts: servedHosts(hosts) },
    env,
    hosts,
    providerName: parseModelString(spec.agent.model).providerName,
    secrets: spec.apiKey ? [spec.apiKey] : [],
    opts: { signal, diagnosticSink, workerEntryPath },
  }) as AsyncGenerator<ChatFrame, void, void>
}

/** Run one learning review in a worker with a minimal environment; return its proposals. */
export async function spawnReviewWorker(
  spec: RestrictedReviewWorkerSpec,
  opts: ReviewSpawnOptions,
): Promise<ReviewWorkerProposal[]> {
  const { apiKeyRefreshHost, ...rest } = opts
  const hosts: WorkerHosts = apiKeyRefreshHost ? { apiKeyRefreshHost } : {}
  const scratch = createMinimalWorkerScratch()
  try {
    for await (const frame of runWorker({
      input: { ...spec, hosts: servedHosts(hosts), scratch },
      env: minimalWorkerProcessEnv(scratch),
      hosts,
      providerName: spec.runtime.providerName,
      secrets: reviewRuntimeSecrets(spec.runtime),
      opts: rest,
    })) {
      if (frame.kind === 'review_result') return frame.proposals
      if (frame.kind === 'fatal') throw new Error(frame.error)
    }
    throw new Error('review worker exited without a result')
  } finally {
    // The worker has exited by now: leaving the loop stops it and waits for it.
    cleanupMinimalWorkerScratch(scratch)
  }
}

function servedHosts(hosts: WorkerHosts): WorkerHostName[] {
  return (Object.keys(hosts) as WorkerHostName[]).filter((name) => hosts[name] !== undefined)
}

interface WorkerRun {
  input: WorkerInput
  env: NodeJS.ProcessEnv
  hosts: WorkerHosts
  /** The provider whose OAuth token the worker may ask to refresh. */
  providerName: string
  /** Redacted from everything the worker sends back; a refreshed token joins them. */
  secrets: string[]
  opts: SpawnOptions
}

async function* runWorker(run: WorkerRun): AsyncGenerator<WorkerFrame, void, void> {
  const { opts, secrets } = run
  const workerEntry = opts.workerEntryPath ?? entryPath
  if (!isAbsolute(workerEntry)) throw new Error('worker entry path must be absolute')
  const serializedInput = JSON.stringify(run.input)
  opts.signal?.throwIfAborted()

  // Detached: the worker leads its own process group, so cancellation and the end of the turn
  // reach the worker together with anything it started in that group.
  const child = spawn(process.execPath, workerSpawnArgs(workerEntry), {
    env: run.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
  const redact = (text: string): string => redactExactValues(text, secrets)
  const frames = new AsyncFrameQueue<WorkerFrame>()
  const stderr = boundedText(MAX_WORKER_STDERR_CHARS)
  const stderrRedactor = new ExactValueStreamRedactor(secrets)
  let pipesAbandoned = false
  // Ends with the turn or the IPC channel: a call still waiting (an approval, a question) gives up.
  const ipcLifetime = new AbortController()
  serveIpc(child, secrets, {
    hosts: run.hosts,
    providerName: run.providerName,
    signal: ipcLifetime.signal,
    pushFrame: (frame) => frames.push(redactJsonValue(frame, secrets)),
    onTokenRefreshed: (token) => {
      if (!secrets.includes(token)) secrets.push(token)
      stderrRedactor.add(token)
    },
  })
  child.once('disconnect', () => ipcLifetime.abort())
  child.once('error', (error) => {
    frames.push({ kind: 'fatal', error: `worker process failed: ${redact(error.message)}` })
  })
  child.stdin?.on('error', (error) => {
    frames.push({ kind: 'fatal', error: `worker stdin failed: ${redact(error.message)}` })
  })
  const stderrDone = child.stderr
    ? pumpWorkerStderr(child.stderr, stderr, stderrRedactor).catch((error) => {
        if (!pipesAbandoned) stderr.append(`worker stderr failed: ${redact(errorMessage(error))}`)
      })
    : Promise.resolve()

  let killTimer: NodeJS.Timeout | undefined
  let exited = false
  const signalGroup = (signal: NodeJS.Signals): boolean => {
    if (!child.pid) return false
    try {
      process.kill(-child.pid, signal)
      return true
    } catch {
      return false // the group is already gone
    }
  }
  // SIGTERM lets the worker abort its session and exit; SIGKILL ends the group if it does not.
  // A delayed signal is safe only until the worker is reaped: until then its PID pins the group id.
  const stopWorker = (): void => {
    ipcLifetime.abort()
    if (exited || killTimer || !signalGroup('SIGTERM')) return
    killTimer = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS)
    killTimer.unref()
  }
  opts.signal?.addEventListener('abort', stopWorker)
  child.once('exit', () => {
    // Once the worker is reaped only its leftovers pin the group id, so end them now, never after
    // a delay in which the group could empty and its id be reused.
    exited = true
    clearTimeout(killTimer)
    signalGroup('SIGKILL')
    setTimeout(() => {
      pipesAbandoned = true
      frames.end()
      child.stdout?.destroy()
      child.stderr?.destroy()
    }, EXIT_DRAIN_MS).unref()
  })
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
    } else child.once('close', (code, signal) => resolve({ code, signal }))
  })

  try {
    if (!child.stdout) throw new Error('worker spawn: stdout pipe missing')
    child.stdin?.end(serializedInput)
    const stdoutDone = pumpWorkerFrames(child.stdout, frames, secrets, stopWorker)
    let fatal = false
    for await (const frame of frames) {
      if (frame.kind === 'fatal') fatal = true
      yield frame
    }
    await stdoutDone
    const { code, signal } = await exit
    await stderrDone
    if (fatal) return
    const diagnostic = stderr.value().trim()
    if (code !== 0 && code !== null) {
      yield {
        kind: 'fatal',
        error: formatWorkerExitFailure(
          `worker exited with code ${code}${signal ? ` (${signal})` : ''}`,
          diagnostic,
        ),
      }
    } else if (signal && code === null) {
      yield {
        kind: 'fatal',
        error: formatWorkerExitFailure(`worker killed by ${signal}`, diagnostic),
      }
    }
  } finally {
    ipcLifetime.abort()
    opts.signal?.removeEventListener('abort', stopWorker)
    // The consumer may stop after any frame: stop a still-running worker and wait for it, so a
    // caller's cleanup (the review scratch tree) never runs under a live process.
    if (child.exitCode === null && child.signalCode === null) stopWorker()
    await exit
    await stderrDone
    const diagnostic = stderr.value().trim()
    if (diagnostic) opts.diagnosticSink?.(diagnostic)
    try {
      child.disconnect()
    } catch {}
  }
}

/** Node's type stripping runs the `.ts` source entry; the bundled `.js` entry runs as is. */
function workerSpawnArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--experimental-strip-types', '--no-warnings', entry] : [entry]
}

/** What a worker call can use besides its arguments. */
interface RpcContext {
  hosts: WorkerHosts
  /** The turn's provider: the only one whose token may be refreshed. */
  providerName: string
  /** Aborts when the turn ends. */
  signal: AbortSignal
  /** Adds a frame to the turn's stream, for calls the client must see (questions, approvals). */
  pushFrame(frame: ChatFrame): void
  onTokenRefreshed(token: string): void
}

type RpcHandlers = {
  [M in RpcMethod]: (
    args: RpcMethods[M]['args'],
    ctx: RpcContext,
  ) => RpcMethods[M]['result'] | Promise<RpcMethods[M]['result']>
}

function host<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`this worker turn has no ${name} host`)
  return value
}

const RPC_HANDLERS: RpcHandlers = {
  askUser: async ({ question }, ctx) => {
    const asked = host(ctx.hosts.questionHost, 'question').ask(question, ctx.signal)
    ctx.pushFrame({ kind: 'event', event: { type: 'agent_question', question: asked.question } })
    return asked.result
  },
  publishResult: (args, { hosts }) => host(hosts.resultHost, 'result').publish(args),
  generateImages: (args, { hosts }) =>
    host(hosts.imageGenerationHost, 'image generation').generate(args),
  webSearch: (args, { hosts }) => host(hosts.webSearchHost, 'web search').search(args),
  agentExists: ({ agentId }, { hosts }) =>
    host(hosts.messagingHost, 'messaging').agentExists(agentId),
  sendMessage: (args, { hosts }) => host(hosts.messagingHost, 'messaging').sendMessage(args),
  listInbox: ({ agentId, unreadOnly }, { hosts }) =>
    host(hosts.messagingHost, 'messaging').listInbox(agentId, { unreadOnly }),
  markRead: async ({ messageId }, { hosts }) => {
    await host(hosts.messagingHost, 'messaging').markRead(messageId)
    return null
  },
  findReplies: ({ agentId, replyTo }, { hosts }) =>
    host(hosts.messagingHost, 'messaging').findReplies(agentId, replyTo),
  userMdGet: ({ teamId }, { hosts }) => host(hosts.userMdHost, 'USER.md').get(teamId),
  userMdWrite: ({ teamId, content, ifMatch }, { hosts }) =>
    host(hosts.userMdHost, 'USER.md').write(teamId, content, ifMatch),
  browserInvoke: ({ agentId, action, args }, { hosts }) =>
    host(hosts.browserHost, 'browser').invoke(agentId, action, args),
  mcpInvoke: ({ serverId, toolName, args }, { hosts }) =>
    host(hosts.mcpHost, 'MCP').invoke(serverId, toolName, args),
  refreshApiKey: async ({ providerName }, ctx) => {
    const token = await refreshApiKeyForTurn(
      providerName,
      ctx.providerName,
      ctx.hosts.apiKeyRefreshHost,
      ctx.signal,
    )
    ctx.onTokenRefreshed(token)
    return token
  },
  bashApproval: async (args, ctx) => {
    const handle = host(ctx.hosts.bashApprovalHost, 'shell approval').begin(args, ctx.signal)
    ctx.pushFrame(approvalFrame(handle.approval))
    const settled = await handle.settled
    // An auto-denied request is settled at once; only a pending one needs its outcome shown.
    if (handle.approval.status === 'pending') ctx.pushFrame(approvalFrame(settled))
    return settled
  },
}

function approvalFrame(approval: CommandApproval): ChatFrame {
  return { kind: 'event', event: { type: 'command_approval', approval } }
}

function serveIpc(child: ChildProcess, secrets: readonly string[], ctx: RpcContext): void {
  child.on('message', (message: unknown) => {
    if (!isIpcRequest(message)) return
    void dispatchRpc(message, ctx).then((reply) => {
      // A refreshed token is the one value a reply may carry; every other reply is redacted.
      const safe =
        message.method === 'refreshApiKey' && reply.ok ? reply : redactJsonValue(reply, secrets)
      try {
        // A worker that exited meanwhile gets nothing; the callback keeps that from being an error.
        if (child.connected) child.send(safe, () => {})
      } catch {}
    })
  })
}

async function dispatchRpc(request: IpcRequest, ctx: RpcContext): Promise<IpcReply> {
  try {
    if (!Object.hasOwn(RPC_HANDLERS, request.method)) {
      throw new Error(`unknown worker call ${request.method}`)
    }
    ctx.signal.throwIfAborted()
    const handler = RPC_HANDLERS[request.method] as (args: unknown, ctx: RpcContext) => unknown
    return { type: 'rpc-reply', id: request.id, ok: true, result: await handler(request.args, ctx) }
  } catch (error) {
    return { type: 'rpc-reply', id: request.id, ok: false, error: errorMessage(error) }
  }
}

function isIpcRequest(message: unknown): message is IpcRequest {
  if (!message || typeof message !== 'object') return false
  const m = message as Record<string, unknown>
  return m.type === 'rpc' && typeof m.id === 'string' && typeof m.method === 'string'
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
  frames: AsyncFrameQueue<WorkerFrame>,
  secrets: readonly string[],
  stopWorker: () => void,
): Promise<void> {
  const tooLong = (): void => {
    frames.push({ kind: 'fatal', error: 'worker frame exceeded the maximum size' })
    stopWorker()
  }
  let partial = ''
  // Decode across pipe chunks: a Buffer boundary can split a UTF-8 code point.
  stdout.setEncoding('utf8')
  try {
    for await (const chunk of stdout) {
      let rest = chunk as string
      let newline = rest.indexOf('\n')
      while (newline !== -1) {
        const line = partial + rest.slice(0, newline)
        partial = ''
        rest = rest.slice(newline + 1)
        if (line.length > MAX_WORKER_FRAME_CHARS) return tooLong()
        if (line.trim()) frames.push(parseFrame(line, secrets))
        newline = rest.indexOf('\n')
      }
      partial += rest
      if (partial.length > MAX_WORKER_FRAME_CHARS) return tooLong()
    }
    if (partial.trim()) frames.push(parseFrame(partial, secrets))
  } catch (error) {
    frames.push({
      kind: 'fatal',
      error: `worker stdout failed: ${redactExactValues(errorMessage(error), secrets)}`,
    })
  } finally {
    frames.end()
  }
}

function parseFrame(line: string, secrets: readonly string[]): WorkerFrame {
  try {
    const frame = redactJsonValue(JSON.parse(line) as WorkerFrame, secrets)
    if (frame.kind === 'fatal') return { ...frame, error: formatWorkerDiagnostic(frame.error) }
    if (frame.kind === 'event' && frame.event.type === 'error') {
      return {
        ...frame,
        event: { ...frame.event, error: formatWorkerDiagnostic(frame.event.error) },
      }
    }
    return frame
  } catch {
    return { kind: 'fatal', error: 'worker emitted malformed frame' }
  }
}

async function pumpWorkerStderr(
  stderr: NonNullable<ChildProcess['stderr']>,
  capture: ReturnType<typeof boundedText>,
  redactor: ExactValueStreamRedactor,
): Promise<void> {
  stderr.setEncoding('utf8')
  for await (const chunk of stderr) capture.append(redactor.push(chunk as string))
  capture.append(redactor.flush())
}

/** The last `maxChars` characters appended. */
function boundedText(maxChars: number) {
  let text = ''
  return {
    append(value: string): void {
      text = `${text}${value}`.slice(-maxChars)
    },
    value: (): string => text,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Native addons can fail either during module loading (stderr-only) or later
 * initialization (a structured worker frame). Keep bounded stderr in the
 * daemon diagnostic sink, but turn every user-facing failure into a stable
 * recovery instruction instead of exposing a checkout-specific binary path.
 */
export function formatWorkerExitFailure(message: string, diagnostic: string): string {
  const formatted = formatWorkerDiagnostic(diagnostic)
  if (formatted !== diagnostic) return formatted
  return diagnostic ? `${message}: ${diagnostic}` : message
}

function formatWorkerDiagnostic(diagnostic: string): string {
  return formatNativeModuleAbiMismatch(diagnostic, { subject: 'worker' }) ?? diagnostic
}

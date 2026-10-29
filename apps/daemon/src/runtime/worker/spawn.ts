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
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChatFrame } from '@bazilion/api-types'
import {
  NativeCommandError,
  nativeCommandFailureObservation,
} from '../../lib/native-execution/command.ts'
import {
  assertBoundNativeTurnForWorker,
  assertNativeTurn,
  bindNativeWorkerApproval,
  consumeNativeTurnForWorker,
  type NativeTurnExecution,
  type NativeWorkerBinding,
} from '../../lib/native-execution/turn.ts'
import { formatNativeModuleAbiMismatch } from '../../lib/native-module-error.ts'
import { isOrdinaryWebSearchHost } from '../../lib/ordinary-web-search.ts'
import {
  assertNativeVerificationRequestHost,
  isNativeVerificationRequestHost,
} from '../../lib/verification/request-capability.ts'
import {
  assertVerificationWorkerOwnership,
  consumeVerificationWorkerOwnership,
  type VerificationWorkerOwnership,
} from '../../lib/verification/worker-ownership.ts'
import { BashApprovalDeniedError } from '../shell/approval.ts'
import { resolveShellSecurityConfig } from '../shell/security.ts'
import { type ApiKeyRefreshTurnContext, refreshApiKeyForTurn } from './api-key-refresh.ts'
import type {
  ApiKeyRefreshHost,
  BashApprovalArgs,
  BashApprovalHost,
  BashApprovalResult,
  BrowserHost,
  IpcReply,
  IpcRequest,
  McpHost,
  MessagingHost,
  UserMdHost,
} from './ipc-protocol.ts'
import { assertNativeExecutionAdmission } from './native-contract.ts'
import {
  dispatchNativeExecution,
  type NativeRpcOutputContext,
} from './native-execution-dispatch.ts'
import { sanitizeQuestionWorkerFrame } from './question-frames.ts'
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
  type SpecialistVerificationWorkerSpec,
  type StaticReviewWorkerSpec,
  type WorkerInput,
  type WorkerTurnSpec,
} from './runtime.ts'

const DEFAULT_KILL_GRACE_MS = 3_000
const MAX_WORKER_STDERR_CHARS = 16 * 1024
const MAX_WORKER_FRAME_CHARS = 40 * 1024 * 1024
const MAX_MINIMAL_WORKER_INPUT_BYTES = 64 * 1024 * 1024

// In dev, this file is at apps/daemon/src/runtime/worker/spawn.ts and the
// worker entry is its `entry.ts` sibling. In the published bundle, all of
// spawn.ts's code is inlined into dist/daemon-main.js, where `./entry.ts` does
// not exist — the worker is bundled separately to dist/worker.js. Pick at
// load time by probing the filesystem.
const sourceEntryPath = fileURLToPath(new URL('./entry.ts', import.meta.url))
const bundledEntryPath = fileURLToPath(new URL('./worker.js', import.meta.url))
const entryPath = existsSync(sourceEntryPath) ? sourceEntryPath : bundledEntryPath

// .ts dev entry: admitted stable Node releases support native type-stripping.
// The loader detection below does not widen the CLI/daemon runtime policy.
// `--no-warnings` also avoids version-dependent startup banners in the protocol.
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

/**
 * BAZ-044: run one specialist verification turn. Frames stream to the caller; the dispatcher settles
 * the attempt from the outcomes the daemon-side host recorded, not from anything the model said.
 */
export function spawnStaticReviewWorker(
  spec: StaticReviewWorkerSpec,
  opts: StaticReviewSpawnWorkerOpts,
): AsyncGenerator<ChatFrame, void, void> {
  return spawnWorker(spec, opts) as AsyncGenerator<ChatFrame, void, void>
}

export function spawnVerificationWorker(
  spec: SpecialistVerificationWorkerSpec,
  opts: SpecialistVerificationSpawnWorkerOpts,
): AsyncGenerator<ChatFrame, void, void> {
  return spawnWorker(spec, opts) as AsyncGenerator<ChatFrame, void, void>
}

/**
 * Every worker spec a spawn can be asked for, including the restricted kinds.
 *
 * One alias rather than the union written out at four call sites: adding a restricted kind should change
 * one line, not four.
 */
type SpecWithCapabilityHost =
  | WorkerTurnSpec
  | RestrictedReviewWorkerSpec
  | SpecialistVerificationWorkerSpec
  | StaticReviewWorkerSpec

export interface WorkerResourceLifecycle {
  beforeSpawn?(): void
  beforeSignal?(): void
  /** Optional original-live pidfd sender, never a receipt/PID fallback. */
  signal?(signal: 'SIGTERM' | 'SIGKILL'): void
  beforeInput(pid: number, hostCommands?: boolean, child?: ChildProcess): void
  afterExit(observedNormalExit?: boolean): Promise<boolean>
}

interface CommonSpawnWorkerOpts {
  nativeExecutionHost?: NativeTurnExecution
  nativeExecutionSecrets?: () => readonly string[]
  imageGenerationHost?: import('./ipc-protocol.ts').ImageGenerationHost
  webSearchHost?: import('./ipc-protocol.ts').WebSearchHost
  containerHost?: import('./ipc-protocol.ts').ContainerLifecycleHost
  resourceLifecycle?: WorkerResourceLifecycle
  codingHost?: import('../pi/coding-contract.ts').CodingHost
  repositoryContextHost?: import('../pi/repository-context.ts').RepositoryContextHost
  resultHost?: import('./ipc-protocol.ts').ResultHost
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
  questionHost?: import('./ipc-protocol.ts').QuestionHost
  /** Explicit legacy configured environment. There is intentionally no default. */
  env: NodeJS.ProcessEnv
  /** BAZ-044: lets an ordinary coding turn hand its current change to a Team specialist. */
  verificationRequestHost?: import('../tools/verification.ts').VerificationRequestHost
  /** BAZ-043: lets an ordinary coding turn ask a Team member to review the change. */
  reviewRequestHost?: import('../tools/review.ts').ReviewRequestHost
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
  questionHost?: import('./ipc-protocol.ts').QuestionHost
  messagingHost: MessagingHost
  userMdHost: UserMdHost
  bashApprovalHost: BashApprovalHost
  apiKeyRefreshHost: ApiKeyRefreshHost
  /** BAZ-044: lets a normal coding turn hand its current change to a Team specialist. */
  verificationRequestHost?: import('../tools/verification.ts').VerificationRequestHost
  /** BAZ-043: lets a normal coding turn ask a Team member to review the change. */
  reviewRequestHost?: import('../tools/review.ts').ReviewRequestHost
}

export interface RestrictedReviewSpawnWorkerOpts extends CommonSpawnWorkerOpts {
  apiKeyRefreshHost: ApiKeyRefreshHost
}

/** A static review turn gets exactly one extra host — the reviewer capability — and nothing else. */
export interface StaticReviewSpawnWorkerOpts extends CommonSpawnWorkerOpts {
  apiKeyRefreshHost: ApiKeyRefreshHost
  changeReviewHost: import('./ipc-protocol.ts').ChangeReviewHost
}

/** A verification turn gets exactly one extra host — the capability — and nothing else. */
export interface SpecialistVerificationSpawnWorkerOpts extends CommonSpawnWorkerOpts {
  /** Nominal parent-owned observation only; never a tool host or worker input. */
  verificationOwnership?: VerificationWorkerOwnership
  apiKeyRefreshHost: ApiKeyRefreshHost
  verificationHost: import('./ipc-protocol.ts').VerificationHost
}

export type SpawnWorkerOpts =
  | ConfiguredSpawnWorkerOpts
  | ProtectedSpawnWorkerOpts
  | RestrictedReviewSpawnWorkerOpts
  | SpecialistVerificationSpawnWorkerOpts
  | StaticReviewSpawnWorkerOpts

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
  spec: SpecWithCapabilityHost,
  opts: SpawnWorkerOpts,
): AsyncGenerator<WorkerOutputFrame, void, void> {
  assertSpawnCombination(spec, opts)
  if (spec.kind !== 'configured_operator_http' && isOrdinaryWebSearchHost(opts.webSearchHost))
    throw new Error('ordinary discovery host is denied for this worker posture')
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
  let resourceLifecycle: WorkerResourceLifecycle | undefined
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
    if (!isRestrictedWorkerKind(spec) && spec.nativeExecution)
      consumeNativeTurnForWorker(opts.nativeExecutionHost, nativeWorkerBinding(spec))
    const ownership = (opts as SpecialistVerificationSpawnWorkerOpts).verificationOwnership
    if (spec.kind === 'specialist_verification' && ownership !== undefined)
      resourceLifecycle = consumeVerificationWorkerOwnership(ownership, spec)
    else if (!isRestrictedWorkerKind(spec)) resourceLifecycle = opts.resourceLifecycle
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

  let resourceCleanup: Promise<boolean> | undefined
  const cleanupResources = () =>
    (resourceCleanup ??=
      resourceLifecycle
        ?.afterExit(child.exitCode !== null && child.signalCode === null)
        .catch(() => false) ?? Promise.resolve(true))
  let child: ChildProcess
  try {
    resourceLifecycle?.beforeSpawn?.()
    child = spawn(process.execPath, workerSpawnArgs(requestedEntry), {
      env,
      detached: resourceLifecycle !== undefined,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })
  } catch (error) {
    if (scratch) cleanupMinimalWorkerScratch(scratch)
    throw error
  }

  if (resourceLifecycle)
    child.once('exit', () => {
      void cleanupResources().then((confirmed) => {
        if (confirmed) return
        // A descendant outside the worker's process group may still own its output
        // endpoints. End this transport without treating local pipe closure as proof
        // of cleanup; the persisted resource identity keeps recovery blocked.
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.stdin?.destroy()
        frames.push({
          kind: 'fatal',
          error: 'Worker cleanup unconfirmed; workspace recovery required',
        })
        frames.end()
      })
    })
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
    (question) =>
      frames.push(
        redactJsonValue(
          { kind: 'event', event: { type: 'agent_question', question } } as ChatFrame,
          accessTokens,
        ),
      ),
    (token) => {
      if (!accessTokens.includes(token)) accessTokens.push(token)
      stderrRedactor?.add(token)
    },
  )
  const ipc = attachIpcHandler(
    child,
    hosts,
    () => accessTokens,
    (pendingVerification) => {
      ipcLifetime.abort()
      if (pendingVerification) {
        frames.push({
          kind: 'fatal',
          error: 'Verification worker disconnected during a captured check',
        })
        onAbort()
      }
    },
  )
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
  let abortStarted = false
  let abortDrain: Promise<void> | undefined
  const signalOwnedWorker = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      resourceLifecycle?.beforeSignal?.()
    } catch {
      // Revoke input, not ownership: a denied guard never authorizes a PID signal. A trusted
      // bootstrap still waiting on stdin can exit naturally; settlement remains independent.
      child.stdin?.end()
      return
    }
    try {
      if (resourceLifecycle?.signal) resourceLifecycle.signal('SIGTERM')
      else child.kill('SIGTERM')
    } catch {}
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          resourceLifecycle?.beforeSignal?.()
        } catch {
          return
        }
        try {
          if (resourceLifecycle?.signal) resourceLifecycle.signal('SIGKILL')
          else child.kill('SIGKILL')
        } catch {}
      }
    }, grace)
    killTimer.unref()
  }
  const onAbort = (): void => {
    ipcLifetime.abort()
    if (abortStarted) return
    abortStarted = true
    const ownedVerification =
      spec.kind === 'specialist_verification' &&
      (opts as SpecialistVerificationSpawnWorkerOpts).verificationOwnership !== undefined
    if (ownedVerification && ipc.pendingVerification()) {
      // Do not destabilize the native census by retiring its IPC owner concurrently. Native
      // execution keeps its existing retirement bound; Worker TERM→KILL grace is unchanged.
      abortDrain = ipc.drainVerification().then(signalOwnedWorker, signalOwnedWorker)
    } else signalOwnedWorker()
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
  let executableInputReleased = false

  try {
    opts.signal?.throwIfAborted()
    if (!child.stdout) throw new Error('worker spawn: stdout pipe missing')
    if (resourceLifecycle) {
      if (!child.pid) throw new Error('Worker PID unavailable')
      const hostCommands =
        spec.kind === 'configured_operator_http' &&
        !spec.nativeExecution &&
        env.BAZILION_BASH_SANDBOX !== 'docker'
      resourceLifecycle.beforeInput(child.pid, hostCommands, child)
    }
    if (!isRestrictedWorkerKind(spec) && spec.nativeExecution) {
      const binding = nativeWorkerBinding(spec)
      assertBoundNativeTurnForWorker(opts.nativeExecutionHost, binding)
      const mode = spec.bashApprovalMode
      bindNativeWorkerApproval(opts.nativeExecutionHost, binding, {
        async requestApproval(request) {
          const signal = AbortSignal.any([
            ipcLifetime.signal,
            ...(request.signal ? [request.signal] : []),
          ])
          signal.throwIfAborted()
          // Classifier output and Actor/turn/mode come from this daemon binding, never RPC fields.
          const decision = await requestBashApproval(
            {
              id: randomUUID(),
              agentId: binding.agentId,
              teamId: binding.teamId,
              turnId: binding.turnId,
              toolCallId: request.toolCallId,
              command: request.command,
              risks: [...request.risks],
              mode,
            },
            { ...hosts, ipcSignal: signal },
          ).catch(() => undefined)
          signal.throwIfAborted()
          return decision?.decision === 'allow' ? 'approved' : 'denied'
        },
      })
    }
    opts.signal?.throwIfAborted()
    executableInputReleased = true
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
        error: formatWorkerExitFailure(
          `worker exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ''}`,
          diagnostic,
        ),
      }
    } else if (!emittedFatal && exit.signal && exit.code === null) {
      yield {
        kind: 'fatal',
        error: formatWorkerExitFailure(`worker killed by ${exit.signal}`, diagnostic),
      }
    }
  } finally {
    ipcLifetime.abort()
    opts.signal?.removeEventListener('abort', onAbort)
    // Async-generator consumers may stop after any frame. Do not remove the
    // child's scratch tree out from under a still-running process: terminate
    // it first, wait for descriptor closure, then erase the per-turn tree.
    if (child.exitCode === null && child.signalCode === null) onAbort()
    await abortDrain
    const nativeConfirmed = opts.nativeExecutionHost
      ? await opts.nativeExecutionHost.close().catch(() => false)
      : true
    if (!executableInputReleased) {
      // No Agent instructions crossed the input fence. Let the trusted bootstrap consume EOF
      // before recording its natural exit; do not cache a live-child cleanup refusal as final.
      child.stdin?.end()
      child.stdout?.resume() // Observe actual bootstrap EOF; never substitute local destruction.
      try {
        await waitForExit
      } catch {}
    }
    const resourcesConfirmed = await cleanupResources()
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
    if (scratch && resourcesConfirmed && nativeConfirmed) cleanupMinimalWorkerScratch(scratch)
    if (!nativeConfirmed)
      // biome-ignore lint/correctness/noUnsafeFinally: Native uncertainty retains both scratch and writer despite a successful worker.
      throw new Error('Native cleanup could not be confirmed; workspace recovery required')
    if (!resourcesConfirmed)
      // biome-ignore lint/correctness/noUnsafeFinally: Unconfirmed resource teardown must override a successful worker result.
      throw new Error('Worker cleanup could not be confirmed; workspace recovery required')
  }
}

/**
 * A verification turn is restricted in the same way a review turn is: it may not reach the coding
 * surface, a container, repository context, the result library, peers, USER.md, the browser or MCP.
 * Kept as one predicate so a new restricted kind cannot pick up only *some* of those limits.
 */
function isRestrictedWorkerKind(
  spec: SpecWithCapabilityHost,
): spec is RestrictedReviewWorkerSpec | SpecialistVerificationWorkerSpec | StaticReviewWorkerSpec {
  return (
    spec.kind === 'restricted_review' ||
    spec.kind === 'specialist_verification' ||
    spec.kind === 'packet_review'
  )
}

function nativeWorkerBinding(spec: WorkerTurnSpec): NativeWorkerBinding {
  if (!spec.nativeExecution) throw new Error('Native worker description missing')
  return {
    agentId: spec.agent.agent.id,
    turnId: spec.turnId,
    teamId: spec.agent.team.id,
    registeredRoot: spec.agent.team.path,
    admission: spec.nativeExecution,
  }
}

function assertSpawnCombination(spec: SpecWithCapabilityHost, opts: SpawnWorkerOpts): void {
  if (
    process.platform === 'darwin' &&
    ((spec.kind === 'protected' && spec.docker) ||
      (spec.kind === 'configured_operator_http' &&
        (spec.configuredDocker ||
          resolveShellSecurityConfig((opts as ConfiguredSpawnWorkerOpts).env).sandboxMode ===
            'docker')))
  )
    throw new Error('Docker execution is not supported on macOS. Select native execution.')
  if (
    spec.kind === 'configured_operator_http' &&
    (opts as ConfiguredSpawnWorkerOpts).env !== undefined &&
    resolveShellSecurityConfig((opts as ConfiguredSpawnWorkerOpts).env).sandboxMode === 'native' &&
    !spec.nativeExecution
  )
    throw new Error('Native selection requires a bound native execution capability')
  const record = opts as unknown as Record<string, unknown>
  if ('verificationOwnership' in record) {
    if (spec.kind !== 'specialist_verification')
      throw new Error(`${spec.kind} rejects verificationOwnership`)
    assertVerificationWorkerOwnership(record.verificationOwnership, spec)
  }
  if (!isRestrictedWorkerKind(spec)) {
    if (spec.nativeExecution !== undefined) {
      assertNativeExecutionAdmission(spec.nativeExecution)
      assertNativeTurn(opts.nativeExecutionHost)
      if (
        typeof opts.nativeExecutionSecrets !== 'function' ||
        (process.platform === 'linux' && !hostHasMethods(opts.resourceLifecycle, ['signal'])) ||
        !hostHasMethods(opts.resourceLifecycle, [
          'beforeSpawn',
          'beforeSignal',
          'beforeInput',
          'afterExit',
        ]) ||
        'containerHost' in record ||
        spec.containerNamespace !== undefined ||
        (spec.kind === 'configured_operator_http' &&
          (spec.configuredDocker ||
            resolveShellSecurityConfig((opts as ConfiguredSpawnWorkerOpts).env).sandboxMode ===
              'docker')) ||
        (spec.kind === 'protected' && spec.docker)
      )
        throw new Error('Native worker requires exclusive bound execution, redaction and ownership')
      if (
        Boolean(spec.nativeVerificationRequestEnabled) !== Boolean(record.verificationRequestHost)
      )
        throw new Error('Native verification requester requires its bound host')
      if (record.verificationRequestHost)
        assertNativeVerificationRequestHost(record.verificationRequestHost, {
          agentId: spec.agent.agent.id,
          teamId: spec.agent.team.id,
          turnId: spec.turnId,
          native: opts.nativeExecutionHost as NativeTurnExecution,
        })
    } else if ('nativeExecutionHost' in record || 'nativeExecutionSecrets' in record)
      throw new Error('Worker rejects unrequested native execution capability')
  }
  if (
    !isRestrictedWorkerKind(spec) &&
    !spec.nativeExecution &&
    isNativeVerificationRequestHost(record.verificationRequestHost)
  )
    throw new Error('Worker rejects unrequested native verification requester')
  if (
    !isRestrictedWorkerKind(spec) &&
    (Boolean(spec.imageGenerationEnabled) !== Boolean(record.imageGenerationHost) ||
      (record.imageGenerationHost && !hostHasMethods(record.imageGenerationHost, ['generate'])))
  ) {
    throw new Error('Image generation capability requires its bound host')
  }
  if (
    !isRestrictedWorkerKind(spec) &&
    (Boolean(spec.questionEnabled) !== Boolean(record.questionHost) ||
      (record.questionHost &&
        !hostHasMethods(record.questionHost, ['ask', 'close', 'subscribe', 'consumed'])))
  )
    throw new Error('Question capability requires its bound host')
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
      'nativeExecutionHost',
      'nativeExecutionSecrets',
      'questionHost',
      'messagingHost',
      'userMdHost',
      'bashApprovalHost',
      'browserHost',
      'mcpHost',
      'codingHost',
      'containerHost',
      'repositoryContextHost',
      'resultHost',
      'imageGenerationHost',
      'resourceLifecycle',
      // Not just "a restricted turn has no reason to ask": the requester capability captures a
      // snapshot and writes a request, so handing it to any restricted kind would give that turn a
      // write the story does not grant it.
      'verificationRequestHost',
      // Same rule for the review requester: a restricted turn must not be able to ask anyone for anything.
      'reviewRequestHost',
    ]) {
      if (forbidden in record) throw new Error(`${spec.kind} rejects ${forbidden}`)
    }
    // A capability host is bound to one claimed attempt, so each restricted kind must have exactly the
    // one it needs and no other kind may carry any of them.
    const wantsVerification = spec.kind === 'specialist_verification'
    if (wantsVerification !== 'verificationHost' in record) {
      throw new Error(
        wantsVerification
          ? 'verification turn requires its bound capability host'
          : `${spec.kind} rejects verificationHost`,
      )
    }
    const wantsReview = spec.kind === 'packet_review'
    if (wantsReview !== 'changeReviewHost' in record) {
      throw new Error(
        wantsReview
          ? 'review turn requires its bound capability host'
          : `${spec.kind} rejects changeReviewHost`,
      )
    }
  }
}

function hostHasMethods(value: unknown, methods: readonly string[]): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return methods.every((method) => typeof record[method] === 'function')
}

function spawnHosts(
  spec: SpecWithCapabilityHost,
  opts: SpawnWorkerOpts,
  signal: AbortSignal,
  onBashApproval: NonNullable<IpcHosts['onBashApproval']>,
  onQuestion: (question: import('@bazilion/api-types').AgentQuestion) => void,
  onApiKeyRefreshed: NonNullable<IpcHosts['onApiKeyRefreshed']>,
): IpcHosts {
  const configured = spec.kind === 'configured_operator_http'
  const protectedTurn = spec.kind === 'protected'
  const configuredOpts = configured ? (opts as ConfiguredSpawnWorkerOpts) : undefined
  const protectedOpts = protectedTurn ? (opts as ProtectedSpawnWorkerOpts) : undefined
  const questionHost = configuredOpts?.questionHost ?? protectedOpts?.questionHost
  if (questionHost) {
    const unsubscribe = questionHost.subscribe(onQuestion)
    signal.addEventListener(
      'abort',
      () => {
        unsubscribe()
        questionHost.close()
      },
      { once: true },
    )
    if (signal.aborted) questionHost.close()
  }
  const restricted = isRestrictedWorkerKind(spec)
  return {
    nativeExecutionHost: restricted ? undefined : opts.nativeExecutionHost,
    nativeExecutionSecrets: restricted ? undefined : opts.nativeExecutionSecrets,
    questionHost: restricted ? undefined : questionHost,
    containerHost: restricted ? undefined : opts.containerHost,
    codingHost: restricted ? undefined : opts.codingHost,
    repositoryContextHost: restricted ? undefined : opts.repositoryContextHost,
    resultHost: restricted ? undefined : opts.resultHost,
    imageGenerationHost: restricted ? undefined : opts.imageGenerationHost,
    webSearchHost: restricted ? undefined : opts.webSearchHost,
    ordinarySearch: configured,
    // A verification turn reads its request and runs captured checks; it does not message peers,
    // edit USER.md, drive a browser or call MCP. Cleared here rather than trusting the caller.
    messagingHost: restricted
      ? undefined
      : (configuredOpts?.messagingHost ?? protectedOpts?.messagingHost),
    userMdHost: restricted ? undefined : (configuredOpts?.userMdHost ?? protectedOpts?.userMdHost),
    browserHost: restricted ? undefined : configuredOpts?.browserHost,
    mcpHost: restricted ? undefined : configuredOpts?.mcpHost,
    verificationHost:
      spec.kind === 'specialist_verification'
        ? (opts as SpecialistVerificationSpawnWorkerOpts).verificationHost
        : undefined,
    changeReviewHost:
      spec.kind === 'packet_review'
        ? (opts as StaticReviewSpawnWorkerOpts).changeReviewHost
        : undefined,
    verificationRequestHost:
      spec.kind === 'protected'
        ? (opts as ProtectedSpawnWorkerOpts).verificationRequestHost
        : spec.kind === 'configured_operator_http'
          ? (opts as ConfiguredSpawnWorkerOpts).verificationRequestHost
          : undefined,
    reviewRequestHost:
      spec.kind === 'protected'
        ? (opts as ProtectedSpawnWorkerOpts).reviewRequestHost
        : spec.kind === 'configured_operator_http'
          ? (opts as ConfiguredSpawnWorkerOpts).reviewRequestHost
          : undefined,
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
    return sanitizeQuestionWorkerFrame(
      normalizeWorkerDiagnosticFrame(redactJsonValue(JSON.parse(line) as ChatFrame, accessTokens)),
    )
  } catch {
    return {
      kind: 'fatal',
      error: 'worker emitted malformed frame',
    }
  }
}

export interface IpcHosts {
  nativeExecutionHost?: import('./ipc-protocol.ts').NativeExecutionHost
  nativeExecutionSecrets?: () => readonly string[]
  ordinarySearch?: boolean
  imageGenerationHost?: import('./ipc-protocol.ts').ImageGenerationHost
  webSearchHost?: import('./ipc-protocol.ts').WebSearchHost
  containerHost?: import('./ipc-protocol.ts').ContainerLifecycleHost
  codingHost?: import('../pi/coding-contract.ts').CodingHost
  repositoryContextHost?: import('../pi/repository-context.ts').RepositoryContextHost
  questionHost?: import('./ipc-protocol.ts').QuestionHost
  resultHost?: import('./ipc-protocol.ts').ResultHost
  messagingHost?: MessagingHost
  userMdHost?: UserMdHost
  browserHost?: BrowserHost
  mcpHost?: McpHost
  verificationHost?: import('./ipc-protocol.ts').VerificationHost
  /** BAZ-043: the reviewer capability, bound to one packet attempt. */
  changeReviewHost?: import('./ipc-protocol.ts').ChangeReviewHost
  /** BAZ-044 requester side: only a protected coding turn may ask for verification. */
  verificationRequestHost?: import('../tools/verification.ts').VerificationRequestHost
  reviewRequestHost?: import('../tools/review.ts').ReviewRequestHost
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
  onDisconnect: (pendingVerification: boolean) => void,
): { pendingVerification(): boolean; drainVerification(): Promise<void> } {
  const verificationRuns = new Set<Promise<void>>()
  child.once('disconnect', () => onDisconnect(verificationRuns.size > 0))
  child.on('message', (msg: unknown) => {
    if (!isIpcRequest(msg)) return
    const verification = msg.method === 'verificationRun'
    const operation: Promise<void> = dispatchWorkerRpc(msg, hosts, {
      assertActive() {
        hosts.ipcSignal?.throwIfAborted()
        if (!child.connected || child.exitCode !== null || child.signalCode !== null)
          throw new Error('Native worker transport unavailable')
      },
      secrets: () => hosts.nativeExecutionSecrets?.() ?? accessTokens(),
      ...(hosts.ipcSignal ? { signal: hosts.ipcSignal } : {}),
      send(part) {
        return new Promise<void>((resolve, reject) => {
          if (!child.connected || !child.send) {
            reject(new Error('Native worker transport unavailable'))
            return
          }
          child.send({ type: 'rpc-output', id: msg.id, ...part }, undefined, undefined, (error) =>
            error ? reject(error) : resolve(),
          )
        })
      },
    })
      .then((reply) => {
        try {
          // A successful refresh is the one IPC payload explicitly allowed to
          // carry the new token. Every other daemon reply is sanitized before it
          // enters the worker, including bounded refresh failures.
          const safeReply =
            msg.method === 'refreshApiKey' && reply.ok
              ? reply
              : redactJsonValue(reply, accessTokens())
          if (child.connected) child.send?.(safeReply)
        } catch {
          // child may have exited between request and reply — drop silently
        }
      })
      .finally(() => {
        if (verification) verificationRuns.delete(operation)
      })
      .catch(() => {})
    if (verification) verificationRuns.add(operation)
  })
  return {
    pendingVerification: () => verificationRuns.size > 0,
    async drainVerification() {
      await Promise.allSettled([...verificationRuns])
    },
  }
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

export async function dispatchWorkerRpc(
  req: IpcRequest,
  hosts: IpcHosts,
  nativeOutput?: NativeRpcOutputContext,
): Promise<IpcReply> {
  try {
    let result: unknown
    switch (req.method) {
      case 'nativeCancel': {
        hosts.ipcSignal?.throwIfAborted()
        if (
          !req.args ||
          Object.keys(req.args).join(',') !== 'toolCallId' ||
          typeof req.args.toolCallId !== 'string' ||
          !req.args.toolCallId ||
          req.args.toolCallId.length > 256
        )
          throw new Error('Invalid native cancellation request')
        const host = require(hosts.nativeExecutionHost, 'nativeExecution', req.method)
        assertNativeTurn(host)
        nativeOutput?.assertActive()
        result = { requested: host.cancel(req.args.toolCallId) }
        break
      }
      case 'nativeExecute': {
        hosts.ipcSignal?.throwIfAborted()
        if (
          !nativeOutput ||
          !hosts.nativeExecutionSecrets ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.id)
        )
          throw new Error('Native worker transport unavailable')
        const host = require(hosts.nativeExecutionHost, 'nativeExecution', req.method)
        assertNativeTurn(host)
        nativeOutput.assertActive()
        result = await dispatchNativeExecution(req.args, host, {
          ...nativeOutput,
          secrets: hosts.nativeExecutionSecrets,
        })
        break
      }
      case 'containerBeforeCreate':
      case 'containerAfterCreate':
      case 'containerAfterRemove': {
        hosts.ipcSignal?.throwIfAborted()
        if (
          !req.args ||
          Object.keys(req.args).join(',') !== 'containerName' ||
          typeof req.args.containerName !== 'string' ||
          req.args.containerName.length > 180
        )
          throw new Error('Invalid container lifecycle request')
        const host = require(hosts.containerHost, 'container', req.method)
        if (req.method === 'containerBeforeCreate') await host.beforeCreate(req.args.containerName)
        else if (req.method === 'containerAfterCreate')
          await host.afterCreate(req.args.containerName)
        else await host.afterRemove(req.args.containerName)
        result = null
        break
      }
      case 'coding':
        result = await require(hosts.codingHost, 'coding', req.method).invoke(req.args)
        break
      case 'repositoryContext':
        hosts.ipcSignal?.throwIfAborted()
        if (
          !req.args ||
          Object.keys(req.args).join(',') !== 'target' ||
          typeof req.args.target !== 'string' ||
          req.args.target.length > 4096
        )
          throw new Error('Invalid repository context request')
        result = await require(hosts.repositoryContextHost, 'repositoryContext', req.method)(
          req.args.target,
        )
        break
      case 'questionConsumed':
        hosts.ipcSignal?.throwIfAborted()
        if (
          !req.args ||
          Object.keys(req.args).sort().join(',') !== 'questionId,toolCallId' ||
          typeof req.args.questionId !== 'string' ||
          typeof req.args.toolCallId !== 'string' ||
          req.args.questionId.length > 64 ||
          req.args.toolCallId.length > 256
        )
          throw new Error('Invalid question consumption IPC')
        require(hosts.questionHost, 'question', req.method).consumed(
          req.args.questionId,
          req.args.toolCallId,
        )
        result = null
        break
      case 'askUser': {
        hosts.ipcSignal?.throwIfAborted()
        if (
          !req.args ||
          Object.keys(req.args).sort().join(',') !== 'question,toolCallId' ||
          typeof req.args.toolCallId !== 'string' ||
          !req.args.toolCallId ||
          req.args.toolCallId.length > 256
        )
          throw new Error('Invalid question IPC request')
        result = await require(hosts.questionHost, 'question', req.method).ask(
          req.args.toolCallId,
          req.args.question,
        )
        break
      }
      case 'generateImages':
        hosts.ipcSignal?.throwIfAborted()
        result = await require(hosts.imageGenerationHost, 'image generation', req.method).generate(
          req.args,
        )
        break
      case 'webSearch': {
        hosts.ipcSignal?.throwIfAborted()
        const args = req.args as import('./ipc-protocol.ts').WebSearchArgs | undefined
        if (
          !args ||
          typeof args.query !== 'string' ||
          Object.keys(args).some((key) => !['query', 'count', 'allowedDomains'].includes(key)) ||
          (args.allowedDomains !== undefined &&
            (hosts.ordinarySearch !== true ||
              !Array.isArray(args.allowedDomains) ||
              args.allowedDomains.length > 8 ||
              args.allowedDomains.some(
                (domain) => typeof domain !== 'string' || domain.length > 253,
              ))) ||
          args.query.length > 512 ||
          (args.count !== undefined &&
            (!Number.isInteger(args.count) || args.count < 1 || args.count > 8))
        )
          throw new Error('Invalid web search IPC request')
        result = await require(hosts.webSearchHost, 'web search', req.method).search(args)
        break
      }
      case 'publishResult':
        hosts.ipcSignal?.throwIfAborted()
        result = await require(hosts.resultHost, 'result', req.method).publish(req.args)
        break
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
      case 'reviewPacketCapture':
        result = await require(hosts.reviewRequestHost, 'reviewRequestHost', req.method).capture(
          req.args,
        )
        break
      case 'reviewPacketRead':
        result = await require(hosts.changeReviewHost, 'review', req.method).read(
          req.args.packetId,
          req.args.attemptId,
        )
        break
      case 'reviewPathRead':
        result = await require(hosts.changeReviewHost, 'review', req.method).path(
          req.args.packetId,
          req.args.attemptId,
          req.args.path,
        )
        break
      case 'reviewFindingAdd':
        result = await require(hosts.changeReviewHost, 'review', req.method).addFinding(
          req.args.packetId,
          req.args.attemptId,
          req.args.finding,
        )
        break
      case 'reviewConclusion':
        result = await require(hosts.changeReviewHost, 'review', req.method).conclude(
          req.args.packetId,
          req.args.attemptId,
          req.args.conclusion,
        )
        break
      case 'verificationCapture':
        hosts.ipcSignal?.throwIfAborted()
        result =
          await require(hosts.verificationRequestHost, 'verificationRequestHost', req.method).capture(
            req.args,
            hosts.ipcSignal,
          )
        break
      case 'verificationRead':
        hosts.ipcSignal?.throwIfAborted()
        result = await require(hosts.verificationHost, 'verification', req.method).read(
          req.args.requestId,
          req.args.attemptId,
        )
        break
      case 'verificationRun':
        hosts.ipcSignal?.throwIfAborted()
        result = await require(hosts.verificationHost, 'verification', req.method).run(
          req.args.requestId,
          req.args.attemptId,
          req.args.ordinal,
          hosts.ipcSignal,
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
        if (hosts.nativeExecutionHost) throw new Error('Native approval is daemon-owned')
        result = await requestBashApproval(req.args, hosts)
        break
      }
    }
    return { type: 'rpc-reply', id: req.id, ok: true, result }
  } catch (err) {
    if (req.method === 'nativeExecute' || req.method === 'nativeCancel') {
      const observation =
        err instanceof NativeCommandError ? nativeCommandFailureObservation(err) : undefined
      const nativeFailure =
        err instanceof NativeCommandError
          ? {
              code: err.code,
              cleanupConfirmed: err.cleanupConfirmed,
              ...(observation ? { observation } : {}),
            }
          : err instanceof BashApprovalDeniedError
            ? { code: 'approval_denied' as const, cleanupConfirmed: true }
            : { code: 'unavailable' as const, cleanupConfirmed: false }
      return {
        type: 'rpc-reply',
        id: req.id,
        ok: false,
        error:
          err instanceof BashApprovalDeniedError
            ? 'Dangerous native command denied'
            : `Native execution ${nativeFailure.code}`,
        nativeFailure,
      }
    }
    return { type: 'rpc-reply', id: req.id, ok: false, error: (err as Error).message }
  }
}

async function requestBashApproval(
  args: BashApprovalArgs,
  hosts: IpcHosts,
): Promise<BashApprovalResult> {
  const handle = require(hosts.bashApprovalHost, 'bashApproval', 'bashApproval').begin(
    args,
    hosts.ipcSignal,
  )
  hosts.onBashApproval?.(handle.approval)
  const decision = await handle.decision
  if (handle.approval.status === 'pending')
    hosts.onBashApproval?.({ ...handle.approval, status: approvalStatusForDecision(decision) })
  return decision
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
  // Decode across pipe chunks: a Buffer boundary can split a UTF-8 code point.
  stdout.setEncoding('utf8')
  try {
    for await (const chunk of stdout) {
      buf += chunk as string
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

/**
 * Native addons can fail either during module loading (stderr-only) or later
 * initialization (a structured worker frame). Keep bounded stderr in the
 * daemon diagnostic sink, but turn every user-facing failure into a stable
 * recovery instruction instead of exposing a checkout-specific binary path.
 */
export function formatWorkerExitFailure(message: string, diagnostic: string): string {
  const formatted = formatWorkerDiagnostic(diagnostic)
  if (formatted !== diagnostic) return formatted
  return appendDiagnostic(message, diagnostic)
}

function normalizeWorkerDiagnosticFrame(frame: ChatFrame): ChatFrame {
  if (frame.kind === 'fatal') {
    return { ...frame, error: formatWorkerDiagnostic(frame.error) }
  }
  if (frame.kind === 'event' && frame.event.type === 'error') {
    return {
      ...frame,
      event: { ...frame.event, error: formatWorkerDiagnostic(frame.event.error) },
    }
  }
  return frame
}

function formatWorkerDiagnostic(diagnostic: string): string {
  return formatNativeModuleAbiMismatch(diagnostic, { subject: 'worker' }) ?? diagnostic
}

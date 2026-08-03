// Subprocess entrypoint for whole-run isolation — no SQLite handle inside.
//
// Reads a `WorkerInput` JSON object from stdin describing the turn to run:
// the pre-resolved agent record, enabled-provider set, and message text.
// The daemon does all DB-backed lookups before spawning us.
//
// Daemon-owned tools, OAuth refresh, and dangerous-command approval are delegated back over
// Node IPC: each invocation sends a `{type: 'rpc', ...}` message and awaits
// the matching reply. The parent dispatches the request through the matching
// host and owns ephemeral approval state.
//
// Ownership split now reads:
//   - daemon: SQLite handle, agent resolution, secrets envelope, scheduler,
//     run-cancel registry, tool/refresh RPC dispatch, command-approval registry.
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
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment, BashApprovalMode, ChatFrame, ResolvedAgent } from '@bazilion/api-types'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { resolvePaths } from '../../core/index.ts'
import { qmdBackend } from '../memory/qmd.ts'
import { piMessagesToProviderView, translatePiEvent } from '../pi/events.ts'
import { createBazilionSession } from '../pi/session.ts'
import type { BashApprovalHost as ShellBashApprovalHost } from '../shell/approval.ts'
import { createIpcApiKeyRefresher } from './api-key-refresh.ts'
import { createIpcClient, type WorkerIpcCall } from './ipc-client.ts'
import type {
  BashApprovalResult,
  BrowserHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdGetResult,
  UserMdHost,
  UserMdWriteResult,
} from './ipc-protocol.ts'

interface WorkerInput {
  mode?: 'chat' | 'review'
  agent: ResolvedAgent
  message: string
  enabledProviders: string[]
  /** Pre-fetched API key for OAuth providers; undefined for env-key ones. */
  apiKey?: string
  /** Parent has installed the turn-scoped OAuth refresh IPC host. */
  apiKeyRefreshEnabled?: boolean
  /** When true, expose the `browser_*` tools (proxied to the daemon pool). */
  browserEnabled?: boolean
  /** MCP tools discovered daemon-side, exposed as IPC-proxied proxy tools. */
  mcpTools?: InjectedMcpTool[]
  /** Image attachments — passed to pi's prompt (vision). Pre-classified by the daemon. */
  images?: Attachment[]
  turnId: string
  bashApprovalMode: BashApprovalMode
  review?: {
    reviewId: string
    evidence: Array<{ sessionId: string; entryOrdinal: number }>
  }
}

interface ReviewWorkerProposal {
  scope: 'private' | 'shared'
  text: string
  evidenceEntryIds: Array<{ sessionId: string; entryOrdinal: number }>
}

type WorkerFrame = ChatFrame | { kind: 'review_result'; proposals: ReviewWorkerProposal[] }

function emit(frame: WorkerFrame): void {
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
    !Array.isArray(parsed.enabledProviders) ||
    typeof parsed.turnId !== 'string' ||
    (parsed.apiKeyRefreshEnabled !== undefined &&
      typeof parsed.apiKeyRefreshEnabled !== 'boolean') ||
    (parsed.bashApprovalMode !== 'interactive' && parsed.bashApprovalMode !== 'auto_deny')
  ) {
    throw new Error(
      'worker: stdin must include {agent, message, enabledProviders, turnId, bashApprovalMode}',
    )
  }
  if (parsed.mode === 'review' && !parsed.review?.reviewId) {
    throw new Error('worker: review mode requires review metadata')
  }
  const providerName = parsed.agent.model.split(':', 1)[0] ?? ''
  if (
    parsed.apiKeyRefreshEnabled &&
    (providerName !== 'openai-codex' || typeof parsed.apiKey !== 'string')
  ) {
    throw new Error('worker: API key refresh requires an openai-codex turn with an initial token')
  }
  return parsed
}

function createIpcMessagingHost(call: WorkerIpcCall): MessagingHost {
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

function createIpcUserMdHost(call: WorkerIpcCall): UserMdHost {
  return {
    get: (teamId) => call<UserMdGetResult>('userMdGet', { teamId }),
    write: (teamId, content, ifMatch) =>
      call<UserMdWriteResult>('userMdWrite', { teamId, content, ifMatch }),
  }
}

function createIpcBrowserHost(call: WorkerIpcCall): BrowserHost {
  return {
    invoke: (agentId, action, args) => call('browserInvoke', { agentId, action, args }),
  }
}

function createIpcMcpHost(call: WorkerIpcCall): McpHost {
  return {
    invoke: (serverId, toolName, args) => call('mcpInvoke', { serverId, toolName, args }),
  }
}

function createIpcBashApprovalHost(
  call: WorkerIpcCall,
  input: Pick<WorkerInput, 'agent' | 'turnId' | 'bashApprovalMode'>,
): ShellBashApprovalHost {
  return {
    async requestApproval(request) {
      const result = await call<BashApprovalResult>('bashApproval', {
        id: randomUUID(),
        turnId: input.turnId,
        toolCallId: request.toolCallId,
        agentId: input.agent.agent.id,
        teamId: input.agent.team.id,
        command: request.command,
        risks: [...request.risks],
        mode: input.bashApprovalMode,
      })
      return result.decision === 'allow' ? 'approved' : 'denied'
    },
  }
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

  const {
    agent,
    message,
    enabledProviders,
    apiKey,
    apiKeyRefreshEnabled,
    browserEnabled,
    mcpTools,
    images,
    turnId,
    bashApprovalMode,
    mode = 'chat',
    review,
  } = await readInput()

  // Path resolution still happens in the worker — `resolvePaths()` only reads
  // the `BAZILION_HOME` env var the daemon hands down. No DB, no filesystem
  // probe of the live tree.
  const paths = resolvePaths()

  const memory = qmdBackend(join(agent.team.path, 'memory'))
  await memory.init()

  const ipcCall = createIpcClient({
    send: process.send
      ? (ipcMessage, done) => {
          process.send?.(ipcMessage, undefined, undefined, done)
        }
      : undefined,
    onMessage: (listener) => process.on('message', listener),
    onDisconnect: (listener) => process.on('disconnect', listener),
  })
  const refreshApiKey = apiKeyRefreshEnabled
    ? createIpcApiKeyRefresher(ipcCall, {
        providerName: agent.model.split(':', 1)[0] ?? '',
        agentId: agent.agent.id,
        turnId,
      })
    : undefined
  const messagingHost = createIpcMessagingHost(ipcCall)
  const userMdHost = createIpcUserMdHost(ipcCall)
  const browserHost = browserEnabled ? createIpcBrowserHost(ipcCall) : undefined
  const mcpHost = mcpTools && mcpTools.length > 0 ? createIpcMcpHost(ipcCall) : undefined
  const bashApprovalHost = createIpcBashApprovalHost(ipcCall, {
    agent,
    turnId,
    bashApprovalMode,
  })

  const reviewSessionDir =
    mode === 'review' ? mkdtempSync(join(paths.logsDir, 'review-session-')) : null
  const proposals: ReviewWorkerProposal[] = []
  const allowedEvidence = new Set(
    (review?.evidence ?? []).map((item) => `${item.sessionId}:${item.entryOrdinal}`),
  )
  const reviewTools: ToolDefinition[] = [
    {
      name: 'propose_lesson',
      label: 'propose_lesson',
      description:
        'Submit zero to five evidence-backed lesson proposals in one final batch. This is the only available action.',
      parameters: Type.Object({
        proposals: Type.Array(
          Type.Object({
            scope: Type.Union([Type.Literal('private'), Type.Literal('shared')]),
            text: Type.String({ minLength: 1, maxLength: 500 }),
            evidenceEntryIds: Type.Array(
              Type.Object({ sessionId: Type.String(), entryOrdinal: Type.Integer({ minimum: 0 }) }),
              { minItems: 1 },
            ),
          }),
          { maxItems: 5 },
        ),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          proposals: Array<{
            scope: 'private' | 'shared'
            text: string
            evidenceEntryIds: Array<{ sessionId: string; entryOrdinal: number }>
          }>
        }
        if (proposals.length > 0) throw new Error('propose_lesson may be called only once')
        for (const candidate of input.proposals) {
          const text = candidate.text.trim()
          if (!text || text.length > 500) throw new Error('proposal text must be 1-500 characters')
          for (const evidence of candidate.evidenceEntryIds) {
            if (!allowedEvidence.has(`${evidence.sessionId}:${evidence.entryOrdinal}`)) {
              throw new Error('proposal cites evidence outside the supplied digest')
            }
          }
          proposals.push({ ...candidate, text })
        }
        return {
          content: [{ type: 'text', text: `accepted ${proposals.length} proposals` }],
          details: {},
          terminate: true,
        }
      },
    },
  ]

  const { session, dispose } = await createBazilionSession({
    agent,
    paths,
    env: process.env,
    memory,
    enabledProviders: new Set(enabledProviders),
    messagingHost,
    userMdHost,
    apiKey,
    refreshApiKey,
    browserHost,
    mcpHost,
    mcpTools,
    bashApprovalHost,
    // deliver_file emits a `file` event straight onto our stdout frame stream.
    fileSink: (f) => emit({ kind: 'event', event: { type: 'file', ...f } }),
    ...(mode === 'review' && reviewSessionDir
      ? {
          restricted: {
            systemPrompt: REVIEW_SYSTEM_PROMPT,
            tools: reviewTools,
            sessionDir: reviewSessionDir,
            reasoningLevel: agent.agent.reviewReasoningLevel,
          },
        }
      : {}),
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

    if (mode === 'review') emit({ kind: 'review_result', proposals })
    else {
      emit({
        kind: 'done',
        messages: piMessagesToProviderView(session.agent.state.messages),
      })
    }
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
    if (reviewSessionDir) rmSync(reviewSessionDir, { recursive: true, force: true })
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

const REVIEW_SYSTEM_PROMPT = `You are a restricted learning reviewer. Analyze only the supplied
transcript digest and approved-lesson index. You cannot act on the world. Call propose_lesson once
with zero to five proposals, then stop.

Classify before proposing:
1. Stable human preference or biography belongs to USER.md: do not propose it.
2. Agent-specific verified behavior or strategy is private.
3. Reusable verified Team project knowledge, decisions, or procedures are shared.
4. Everything else produces no proposal.

Zero proposals is a successful result. Never save transient or environment-dependent failures,
unresolved attempts, guesses, contradicted claims, one-off narratives, status updates, secrets,
credentials, sensitive personal data, raw logs, copied text, or duplicates. Each proposal must cite
at least one supplied evidence entry and one observation may appear in only one proposal.`

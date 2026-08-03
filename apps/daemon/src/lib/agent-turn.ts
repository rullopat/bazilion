import { randomUUID } from 'node:crypto'
import type { Attachment, BashApprovalMode, ChatFrame } from '@bazilion/api-types'
import { mergeSecretsIntoEnv, providerStateRepo, resolveAgent } from '../core/index.ts'
import { spawnWorkerTurn } from '../runtime/index.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { SANDBOX_INPUTS_DIR } from '../runtime/shell/tooling.ts'
import { registerAgent, unregisterAgent } from './agent-cancel.ts'
import { acquireAgentLifecycleLease } from './agent-lifecycle-lease.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { saveInputFiles } from './attachments.ts'
import { commandApprovalRegistry } from './bash-approval.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { createBrowserHost } from './browser/host.ts'
import { authorizeUserIngress, type CommunicationAttempt } from './communication.ts'
import { getCtx } from './ctx.ts'
import { resolveMcpForTurn } from './mcp/resolve.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { mirrorAgentTurnFrame, mirrorTypingStart, mirrorTypingStop } from './telegram/mirror.ts'
import { createDbUserMdHost } from './user-md-host.ts'

interface RunAgentTurnOpts {
  /** If omitted, a fresh AbortController is created internally. */
  controller?: AbortController
  /**
   * Files attached to this turn. Classified here: `image/*` is fed to the model
   * as vision; everything else is stored on disk and referenced by path so the
   * agent can open/process it.
   */
  attachments?: Attachment[]
  /** Semantic user-side attempt authorizing this turn before any protected side effect. */
  authorization?: CommunicationAttempt
  /** Inbox wake already authorizes every source path atomically while claiming rows. */
  skipUserIngress?: boolean
  /** Internal scheduler handoff: lease acquired before its atomic claim. */
  acquiredLeaseRelease?: () => void
  /** Scheduler registered the active turn atomically with its durable claim. */
  alreadyRegistered?: boolean
  /** Missing/internal callers fail closed instead of opening a human wait. */
  bashApprovalMode?: BashApprovalMode
}

/**
 * Runs one full agent turn in an isolated subprocess, streaming `ChatFrame`s
 * in NDJSON-ready order. The heavy lifting (provider calls, tool execution,
 * pi session journal append) happens inside the child; this function is a
 * thin relay that:
 *   - resolves the agent + provider gate + secrets envelope here in the
 *     daemon (the worker no longer holds a SQLite handle of its own),
 *   - spawns the worker with an IPC channel for daemon-owned messaging tools
 *     OAuth refresh, and turn-scoped shell approvals,
 *   - forwards stdout frames to the caller and wires cancellation through
 *     the agent-cancel registry.
 */
export async function* runAgentTurn(
  agentId: string,
  rawMessage: string,
  opts: RunAgentTurnOpts = {},
): AsyncGenerator<ChatFrame> {
  const { db, paths, authToken } = getCtx()
  const controller = opts.controller ?? new AbortController()
  const authorization = opts.authorization ?? {
    origin: 'internal_turn',
    attemptKind: 'turn',
    attemptId: randomUUID(),
  }
  const releaseLease = opts.acquiredLeaseRelease ?? (await acquireAgentLifecycleLease(agentId))
  let agent: ReturnType<typeof resolveAgent>
  try {
    agent = resolveAgent(db, paths, agentId)
    if (!opts.alreadyRegistered) {
      if (!opts.skipUserIngress) {
        authorizeUserIngress(
          db,
          agentId,
          {
            ...authorization,
            approvalPayloadKind: 'agent_turn',
            approvalPayload: { agentId, message: rawMessage, attachments: [] },
            requester: authorization.origin,
          },
          () => registerAgent(agentId, controller),
        )
      } else {
        registerAgent(agentId, controller)
      }
    }
  } catch (error) {
    if (opts.alreadyRegistered) unregisterAgent(agentId)
    throw error
  } finally {
    releaseLease()
  }

  try {
    // Central attachment classifier: images → vision (passed to pi's prompt),
    // everything else → stored on disk + a path reference appended to the message.
    const env = mergeSecretsIntoEnv(db, authToken)
    const shellSecurity = resolveShellSecurityConfig(env)
    const attachments = opts.attachments ?? []
    const images = attachments.filter((a) => a.mimeType.startsWith('image/'))
    const docs = attachments.filter((a) => !a.mimeType.startsWith('image/'))
    const fileNote = saveInputFiles(
      agent.agent.dir,
      docs,
      shellSecurity.sandboxMode === 'docker' ? { referenceDir: SANDBOX_INPUTS_DIR } : {},
    )
    const message = fileNote ? (rawMessage ? `${rawMessage}\n\n${fileNote}` : fileNote) : rawMessage

    const enabledProviders = Array.from(providerStateRepo.listEnabled(db))
    const messagingHost = createDbMessagingHost(db)
    const userMdHost = createDbUserMdHost(db, paths)
    // Pre-fetch the API key for OAuth providers (`openai-codex`) before the
    // worker spawns — the worker has no DB handle, so it can't reach the
    // secrets table itself. For env-key providers this is a no-op (`{}`).
    // OAuth refresh stays daemon-owned: the worker gets the initial token on
    // stdin and a turn-scoped IPC callback for later refreshes, never a DB
    // handle or the stored refresh credential.
    const { apiKey, refreshApiKey } = await resolveAgentApiKey(db, authToken, agent, {
      withRefresher: true,
    })

    // Browser automation: expose the browser_* tools (gated by config). The
    // Playwright session is lazy — Chromium only launches on first browser call.
    const browserEnabled = isBrowserEnabled(env)
    const browserHost = browserEnabled ? createBrowserHost(resolveBrowserConfig(env)) : undefined

    // MCP: discover enabled servers' tools (connections pooled in the daemon) and
    // build the proxy host. Null when no servers are enabled.
    const mcp = await resolveMcpForTurn(db, env, authToken)

    // Telegram "typing..." indicator while the turn runs. Safe to call even
    // when the agent has no bound topic — mirror.ts checks before firing.
    mirrorTypingStart(agentId, `${authorization.attemptKind}:${authorization.attemptId}:typing`)
    let mirrorFrameIndex = 0
    for await (const frame of spawnWorkerTurn(
      {
        agent,
        message,
        enabledProviders,
        apiKey,
        browserEnabled,
        mcpTools: mcp?.tools,
        images,
        turnId: authorization.attemptId,
        bashApprovalMode: opts.bashApprovalMode ?? 'auto_deny',
      },
      {
        signal: controller.signal,
        env,
        messagingHost,
        userMdHost,
        browserHost,
        mcpHost: mcp?.host,
        bashApprovalHost: commandApprovalRegistry,
        apiKeyRefreshHost: refreshApiKey ? { refresh: refreshApiKey } : undefined,
      },
    )) {
      // Fire-and-forget Telegram mirror. Mirror failures (bot down, topic
      // deleted, transient API errors) are logged inside but never bubble
      // here — the turn's own consumers (web chat stream, scheduler, etc.)
      // see every frame regardless of mirror status.
      void mirrorAgentTurnFrame(
        agentId,
        frame,
        `${authorization.attemptKind}:${authorization.attemptId}:${mirrorFrameIndex++}`,
      ).catch((e) => {
        console.warn(
          `telegram mirror: unexpected error (agent=${agentId}) —`,
          e instanceof Error ? e.message : String(e),
        )
      })
      yield frame
    }
  } finally {
    mirrorTypingStop(agentId)
    unregisterAgent(agentId)
  }
}

import type { ChatFrame } from '@bazilion/api-types'
import { mergeSecretsIntoEnv, providerStateRepo, resolveAgent } from '../core/index.ts'
import { spawnWorkerTurn } from '../runtime/index.ts'
import { registerAgent, unregisterAgent } from './agent-cancel.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { getCtx } from './ctx.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { mirrorAgentTurnFrame, mirrorTypingStart, mirrorTypingStop } from './telegram/mirror.ts'
import { createDbUserMdHost } from './user-md-host.ts'

interface RunAgentTurnOpts {
  /** If omitted, a fresh AbortController is created internally. */
  controller?: AbortController
  /**
   * Whether to mirror this turn to the agent's Telegram topic (+ typing
   * indicator). Defaults to true. The scheduler passes `false` for triggers
   * flagged `silent_in_telegram`.
   */
  mirror?: boolean
}

/**
 * Runs one full agent turn in an isolated subprocess, streaming `ChatFrame`s
 * in NDJSON-ready order. The heavy lifting (provider calls, tool execution,
 * pi session journal append) happens inside the child; this function is a
 * thin relay that:
 *   - resolves the agent + provider gate + secrets envelope here in the
 *     daemon (the worker no longer holds a SQLite handle of its own),
 *   - spawns the worker with an IPC channel and a `MessagingHost` that
 *     services the inter-agent messaging tools the worker calls back into,
 *   - forwards stdout frames to the caller and wires cancellation through
 *     the agent-cancel registry.
 */
export async function* runAgentTurn(
  agentId: string,
  message: string,
  opts: RunAgentTurnOpts = {},
): AsyncGenerator<ChatFrame> {
  const { db, paths, authToken } = getCtx()
  const agent = resolveAgent(db, paths, agentId)
  const enabledProviders = Array.from(providerStateRepo.listEnabled(db))
  const env = mergeSecretsIntoEnv(db, authToken)
  const messagingHost = createDbMessagingHost(db)
  const userMdHost = createDbUserMdHost(db, paths)
  // Pre-fetch the API key for OAuth providers (`openai-codex`) before the
  // worker spawns — the worker has no DB handle, so it can't reach the
  // secrets table itself. For env-key providers this is a no-op (`{}`).
  // Refresher is intentionally skipped: the worker has no IPC channel for
  // OAuth refresh today, and the initial token comfortably outlives a
  // single turn for ChatGPT-backed sessions.
  const { apiKey } = await resolveAgentApiKey(db, authToken, agent)

  const controller = opts.controller ?? new AbortController()
  const mirror = opts.mirror !== false
  registerAgent(agentId, controller)
  // Telegram "typing..." indicator while the turn runs. Safe to call even
  // when the agent has no bound topic — mirror.ts checks before firing.
  // Skipped entirely for silent triggers.
  if (mirror) mirrorTypingStart(agentId)
  try {
    for await (const frame of spawnWorkerTurn(
      { agent, message, enabledProviders, apiKey },
      { signal: controller.signal, env, messagingHost, userMdHost },
    )) {
      // Fire-and-forget Telegram mirror. Mirror failures (bot down, topic
      // deleted, transient API errors) are logged inside but never bubble
      // here — the turn's own consumers (web chat stream, scheduler, etc.)
      // see every frame regardless of mirror status.
      if (mirror) {
        void mirrorAgentTurnFrame(agentId, frame).catch((e) => {
          console.warn(
            `telegram mirror: unexpected error (agent=${agentId}) —`,
            e instanceof Error ? e.message : String(e),
          )
        })
      }
      yield frame
    }
  } finally {
    if (mirror) mirrorTypingStop(agentId)
    unregisterAgent(agentId)
  }
}

// Outbound mirror — takes a ChatFrame emitted by `runAgentTurn` and (when
// the agent is bound to a forum topic) renders it as a Telegram message
// in that topic.
//
// Mirror policy is per-agent via `agents.telegram_mirror_mode`:
//   - 'minimal' (default): only `assistant_message` events + terminal
//                          errors/fatal frames. Clean conversation feel.
//   - 'verbose':           also surfaces concise tool-call summary lines
//                          so the operator can see the agent's steps.
//
// Sends route through the per-supergroup outbound queue so multiple agents
// (heartbeats firing in lockstep, etc.) don't trip Telegram's per-chat rate
// limit. Errors are logged but never crash the turn. The classic
// "topic deleted by a human" case is reconciled lazily: clear
// `agents.telegram_topic_id` and stop mirroring there.

import type { ChatFrame, TelegramMirrorMode } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo } from '../../core/index.ts'
import { enqueueOutbound } from './outbound-queue.ts'
import { clearReactionsFor } from './reactions.ts'

/** Bot API subset the mirror needs. Mirrors the pattern from directory.ts. */
export interface MirrorApi {
  sendMessage(
    chatId: number,
    text: string,
    opts: { message_thread_id?: number; parse_mode?: 'HTML' | 'MarkdownV2' },
  ): Promise<{ message_id: number }>
  /**
   * Drives Telegram's "typing..." indicator. The indicator lives for ~5s
   * server-side, so we re-fire every 4s while a turn is running.
   */
  sendChatAction(
    chatId: number,
    action: 'typing',
    opts: { message_thread_id?: number },
  ): Promise<boolean>
}

export interface MirrorDeps {
  db: BazilionDb
  api: MirrorApi
  chatId: number
}

// Live deps resolver — wired by bot.ts at start, broken cycle (same pattern
// the directory module uses).
let _liveDepsResolver: (() => MirrorDeps | null) | null = null

export function installMirrorDepsResolver(resolver: () => MirrorDeps | null): void {
  _liveDepsResolver = resolver
}

/**
 * Mirror entry point. Looks up the agent's bound topic + mirror mode,
 * renders the frame, and enqueues the send. Safe to call for every yielded
 * frame — silently no-ops when the agent isn't bound or the bot isn't
 * running. Never throws — failures are logged.
 */
export async function mirrorAgentTurnFrame(
  agentIdOrAgent: string,
  frame: ChatFrame,
): Promise<void> {
  const deps = _liveDepsResolver?.()
  if (!deps) return

  // Resolve agent + topic in one shot; if either is missing, skip.
  const agent = agentRepo.get(deps.db, agentIdOrAgent)
  if (!agent) return
  const topicId = agentRepo.getTelegramTopicId(deps.db, agent.id)
  if (topicId === null) return

  const text = renderFrame(frame, agent.telegramMirrorMode)
  if (!text) return

  // The agent is replying — drop any pending 👀 reactions on the user's
  // inbound messages. The reply itself is the canonical "I saw it".
  if (shouldClearReactionsFor(frame)) clearReactionsFor(agent.id)

  try {
    await enqueueOutbound(deps.chatId, () =>
      deps.api.sendMessage(deps.chatId, truncateForTelegram(text), {
        message_thread_id: topicId,
      }),
    )
  } catch (e) {
    if (isThreadGoneError(e)) {
      console.warn(
        `telegram mirror: topic ${topicId} for agent ${agent.id} is gone — clearing binding`,
      )
      agentRepo.setTelegramTopicId(deps.db, agent.id, null)
      return
    }
    console.warn(
      `telegram mirror: send failed for agent ${agent.id} —`,
      e instanceof Error ? e.message : String(e),
    )
  }
}

// ─── frame → text rendering ─────────────────────────────────────────────

// Telegram caps message body at 4096 chars; we truncate with an ellipsis
// to 3900 to leave headroom for emoji + decorations.
const SAFE_CHAR_BUDGET = 3900

function renderFrame(frame: ChatFrame, mode: TelegramMirrorMode): string | null {
  if (frame.kind === 'fatal') {
    return `💥 Turn crashed: ${frame.error}`
  }
  if (frame.kind === 'done') {
    return null
  }
  // frame.kind === 'event'
  const ev = frame.event
  switch (ev.type) {
    case 'assistant_message':
      return ev.text || null
    case 'error':
      return `❌ Error: ${ev.error}`
    case 'tool_call':
      return mode === 'verbose' ? `🔧 ${ev.name}(${truncateArgs(ev.arguments)})` : null
    case 'tool_result':
      return mode === 'verbose' ? `✓ ${ev.name} → ${truncateResult(ev.result)}` : null
    case 'tool_error':
      return mode === 'verbose' ? `✕ ${ev.name}: ${ev.error}` : null
    case 'user_message':
    case 'assistant_delta':
      return null
  }
}

function truncateArgs(rawArgs: string): string {
  // Args come in as a JSON string. Pretty-print attempt: parse and join
  // key-value pairs (short truncation per value). On parse failure, fall
  // back to a raw clip.
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>
    const pairs = Object.entries(parsed).map(([k, v]) => `${k}=${truncateValue(v, 40)}`)
    return clip(pairs.join(', '), 120)
  } catch {
    return clip(rawArgs, 120)
  }
}

function truncateResult(raw: string): string {
  return clip(raw, 200)
}

function truncateValue(v: unknown, limit: number): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return clip(s, limit)
}

function clip(s: string, limit: number): string {
  if (s.length <= limit) return s
  return `${s.slice(0, limit - 1)}…`
}

function truncateForTelegram(text: string): string {
  if (text.length <= SAFE_CHAR_BUDGET) return text
  return `${text.slice(0, SAFE_CHAR_BUDGET - 1)}…`
}

/**
 * True for frames that represent "the agent has responded" — used to clear
 * pending 👀 reactions on the user's inbound messages. assistant_message
 * is the obvious case; error and fatal also count (the user should know
 * something happened, even if it's a failure).
 */
function shouldClearReactionsFor(frame: ChatFrame): boolean {
  if (frame.kind === 'fatal') return true
  if (frame.kind === 'done') return false
  const t = frame.event.type
  return t === 'assistant_message' || t === 'error'
}

function isThreadGoneError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return (
    msg.includes('message thread not found') ||
    msg.includes('topic_closed') ||
    msg.includes('topic_deleted') ||
    msg.includes('chat not found')
  )
}

// ─── typing indicator ───────────────────────────────────────────────────
//
// Telegram's `sendChatAction(chat, 'typing', {message_thread_id})` shows a
// "typing..." bubble at the top of the topic for ~5s. We fire it when a
// turn begins and re-fire every 4s while it's still running so the bubble
// stays alive. `mirrorTypingStop` clears the interval — runAgentTurn's
// `finally` calls it on every exit path.

const TYPING_REFIRE_MS = 4_000

const _typingIntervals = new Map<string, ReturnType<typeof setInterval>>()

/**
 * Start the "typing..." indicator for an agent's bound topic. No-op when
 * the bot isn't running or the agent has no bound topic. Idempotent: a
 * second call for the same agent clears the prior interval first so we
 * don't leak timers if the lifecycle ever races.
 */
export function mirrorTypingStart(agentId: string): void {
  const deps = _liveDepsResolver?.()
  if (!deps) return
  const topicId = agentRepo.getTelegramTopicId(deps.db, agentId)
  if (topicId === null) return

  // Clear any prior interval for this agent before starting a new one.
  mirrorTypingStop(agentId)

  const fire = (): void => {
    deps.api.sendChatAction(deps.chatId, 'typing', { message_thread_id: topicId }).catch(() => {
      // Indicator failures are silent — losing the bubble is purely
      // cosmetic; the actual reply still mirrors when ready.
    })
  }
  fire()
  const interval = setInterval(fire, TYPING_REFIRE_MS)
  _typingIntervals.set(agentId, interval)
}

/** Stop the typing indicator. Safe to call even when none is running. */
export function mirrorTypingStop(agentId: string): void {
  const interval = _typingIntervals.get(agentId)
  if (interval) {
    clearInterval(interval)
    _typingIntervals.delete(agentId)
  }
}

/** Test-only — reset the resolver. */
export function _resetMirrorDepsForTest(): void {
  _liveDepsResolver = null
  for (const interval of _typingIntervals.values()) clearInterval(interval)
  _typingIntervals.clear()
}

/** Test-only — invoke the resolver to peek at what bot.ts wired. */
export function _peekMirrorDepsForTest(): MirrorDeps | null {
  return _liveDepsResolver?.() ?? null
}

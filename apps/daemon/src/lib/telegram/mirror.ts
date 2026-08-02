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
// (scheduled triggers firing in lockstep, etc.) don't trip Telegram's per-chat rate
// limit. Errors are logged but never crash the turn. The classic
// "topic deleted by a human" case is reconciled lazily: clear
// `agents.telegram_topic_id` and stop mirroring there.

import type { ChatFrame, TelegramMirrorMode, ToolResultImage } from '@bazilion/api-types'
import { InputFile } from 'grammy'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo } from '../../core/index.ts'
import {
  authorizeAgentEgress,
  CommunicationDeniedError,
  CommunicationPendingError,
} from '../communication.ts'
import { _resetLoopGuardForTest, allowTelegramOutboundNoise } from './loop-guard.ts'
import { renderTelegramMessages, stripTelegramHtml, TELEGRAM_SAFE_BUDGET } from './markdown.ts'
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
  /** Send an image (e.g. a browser screenshot) as a photo. */
  sendPhoto(
    chatId: number,
    photo: InputFile,
    opts: { message_thread_id?: number; caption?: string },
  ): Promise<{ message_id: number }>
  /** Fallback for images Telegram rejects as photos (too tall/large). */
  sendDocument(
    chatId: number,
    document: InputFile,
    opts: { message_thread_id?: number; caption?: string },
  ): Promise<{ message_id: number }>
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
  attemptBase: string = `telegram-mirror:${Date.now()}`,
): Promise<void> {
  const deps = _liveDepsResolver?.()
  if (!deps) return

  // Resolve agent + topic in one shot; if either is missing, skip.
  const agent = agentRepo.get(deps.db, agentIdOrAgent)
  if (!agent) return
  const topicId = agentRepo.getTelegramTopicId(deps.db, agent.id)
  if (topicId === null) return

  // Images (browser screenshots, MCP image results) are user-facing
  // deliverables — NOT tool-call noise. Send them as photos regardless of
  // mirror mode, otherwise a 'minimal'-mode Telegram user who asks for a
  // screenshot would never receive it (the tool_result text is suppressed).
  const imagePayload = frameToolResultImages(frame)
  if (imagePayload) {
    await mirrorImages(deps, topicId, agent.id, imagePayload, `${attemptBase}:images`)
    // fall through — there may also be a text line to mirror (verbose mode)
  }

  // Files the agent delivered (deliver_file) go out as Telegram documents,
  // regardless of mirror mode — they're deliverables, not tool noise.
  if (frame.kind === 'event' && frame.event.type === 'file') {
    await mirrorFile(deps, topicId, agent.id, frame.event, `${attemptBase}:file`)
  }

  const text = renderFrame(frame, agent.telegramMirrorMode)
  if (!text) return

  // Per-agent outbound-noise throttle: when a scheduled Agent floods its
  // topic with verbose tool-line frames, drop the surplus. Essential frames
  // (assistant_message / error / fatal) always pass — we never drop the
  // agent's actual reply, only the verbose scaffolding around it.
  if (!isEssentialFrame(frame) && !allowTelegramOutboundNoise(agent.id)) return

  // The agent is replying — drop any pending 👀 reactions on the user's
  // inbound messages. The reply itself is the canonical "I saw it".
  if (shouldClearReactionsFor(frame)) clearReactionsFor(agent.id)

  // Only the agent's own reply is Markdown (rendered to Telegram HTML so it
  // matches the Web UI). Scaffolding lines (errors, verbose tool traces) are
  // not Markdown — they may contain bare `<`/`>` — so they go out as plain
  // text, truncated as before.
  const isReply = frame.kind === 'event' && frame.event.type === 'assistant_message'
  const chunks = isReply
    ? renderTelegramMessages(text, TELEGRAM_SAFE_BUDGET)
    : [truncateForTelegram(text)]

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]
    if (!chunk) continue
    if (
      !telegramEgressAllowed(deps, agent.id, `${attemptBase}:text:${chunkIndex}`, 'telegram_text', {
        chatId: deps.chatId,
        topicId,
        text: chunk,
        parseMode: isReply ? 'HTML' : null,
      })
    )
      return
    try {
      await enqueueOutbound(deps.chatId, () =>
        deps.api.sendMessage(deps.chatId, chunk, {
          message_thread_id: topicId,
          ...(isReply ? { parse_mode: 'HTML' as const } : {}),
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
      // A malformed entity makes Telegram 400 the message ("can't parse
      // entities"). Retry that chunk once as plain text so a converter glitch
      // never costs the user their reply.
      if (isReply && isParseEntitiesError(e)) {
        try {
          if (
            !telegramEgressAllowed(
              deps,
              agent.id,
              `${attemptBase}:text:${chunkIndex}:fallback`,
              'telegram_text',
              {
                chatId: deps.chatId,
                topicId,
                text: stripTelegramHtml(chunk),
                parseMode: null,
              },
            )
          )
            return
          await enqueueOutbound(deps.chatId, () =>
            deps.api.sendMessage(deps.chatId, stripTelegramHtml(chunk), {
              message_thread_id: topicId,
            }),
          )
          continue
        } catch (e2) {
          console.warn(
            `telegram mirror: plain-text fallback failed for agent ${agent.id} —`,
            e2 instanceof Error ? e2.message : String(e2),
          )
          continue
        }
      }
      console.warn(
        `telegram mirror: send failed for agent ${agent.id} —`,
        e instanceof Error ? e.message : String(e),
      )
    }
  }
}

// ─── image mirroring ────────────────────────────────────────────────────

// Telegram caption cap is 1024 chars.
const CAPTION_BUDGET = 1000

/** Extract tool-result images + a caption from a frame, or null. */
function frameToolResultImages(
  frame: ChatFrame,
): { images: ToolResultImage[]; caption: string } | null {
  if (frame.kind !== 'event') return null
  const ev = frame.event
  if (ev.type !== 'tool_result' || !ev.images || ev.images.length === 0) return null
  // Caption = the first non-empty line of the result text. For a screenshot
  // that's exactly "Screenshot of <url>" — the same line the web tool view
  // shows — and it keeps captions tidy for verbose multi-line tool results.
  const firstLine = ev.result
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  return { images: ev.images, caption: firstLine || ev.name }
}

/**
 * Send each image as a Telegram photo. Falls back to sendDocument when the
 * photo is rejected (Telegram caps photo dimensions, so full-page screenshots
 * can fail as photos but go through as files). Never throws.
 */
async function mirrorImages(
  deps: MirrorDeps,
  topicId: number,
  agentId: string,
  payload: { images: ToolResultImage[]; caption: string },
  attemptBase: string,
): Promise<void> {
  const caption = clip(payload.caption, CAPTION_BUDGET)
  for (let imageIndex = 0; imageIndex < payload.images.length; imageIndex++) {
    const img = payload.images[imageIndex]
    if (!img) continue
    if (
      !telegramEgressAllowed(deps, agentId, `${attemptBase}:${imageIndex}`, 'telegram_image', {
        chatId: deps.chatId,
        topicId,
        data: img.data,
        mimeType: img.mimeType,
        caption,
      })
    )
      return
    const buf = Buffer.from(img.data, 'base64')
    const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png'
    // InputFile wraps a Buffer as a single-use stream — build a fresh one per
    // send attempt (the photo try + the document fallback).
    const file = (): InputFile => new InputFile(buf, `screenshot.${ext}`)
    try {
      await enqueueOutbound(deps.chatId, () =>
        deps.api.sendPhoto(deps.chatId, file(), { message_thread_id: topicId, caption }),
      )
    } catch (e) {
      if (isThreadGoneError(e)) {
        agentRepo.setTelegramTopicId(deps.db, agentId, null)
        return
      }
      try {
        if (
          !telegramEgressAllowed(
            deps,
            agentId,
            `${attemptBase}:${imageIndex}:fallback`,
            'telegram_image',
            {
              chatId: deps.chatId,
              topicId,
              data: img.data,
              mimeType: img.mimeType,
              caption,
              asDocument: true,
            },
          )
        ) {
          return
        }
        await enqueueOutbound(deps.chatId, () =>
          deps.api.sendDocument(deps.chatId, file(), { message_thread_id: topicId, caption }),
        )
      } catch (e2) {
        console.warn(
          `telegram mirror: image send failed for agent ${agentId} —`,
          e2 instanceof Error ? e2.message : String(e2),
        )
      }
    }
  }
}

/** Send an agent-delivered file as a Telegram document. Never throws. */
async function mirrorFile(
  deps: MirrorDeps,
  topicId: number,
  agentId: string,
  ev: { name: string; mimeType: string; data: string },
  attemptId: string,
): Promise<void> {
  if (
    !telegramEgressAllowed(deps, agentId, attemptId, 'telegram_file', {
      chatId: deps.chatId,
      topicId,
      name: ev.name,
      mimeType: ev.mimeType,
      data: ev.data,
    })
  )
    return
  const buf = Buffer.from(ev.data, 'base64')
  try {
    await enqueueOutbound(deps.chatId, () =>
      deps.api.sendDocument(deps.chatId, new InputFile(buf, ev.name), {
        message_thread_id: topicId,
        caption: ev.name,
      }),
    )
  } catch (e) {
    if (isThreadGoneError(e)) {
      agentRepo.setTelegramTopicId(deps.db, agentId, null)
      return
    }
    console.warn(
      `telegram mirror: file send failed for agent ${agentId} —`,
      e instanceof Error ? e.message : String(e),
    )
  }
}

function telegramEgressAllowed(
  deps: MirrorDeps,
  agentId: string,
  attemptId: string,
  payloadKind = 'telegram_typing',
  payload: unknown = { chatId: deps.chatId },
): boolean {
  try {
    authorizeAgentEgress(deps.db, agentId, {
      origin: 'telegram_mirror',
      attemptKind: 'telegram_egress',
      attemptId,
      approvalPayloadKind: payloadKind,
      approvalPayload: payload,
      requester: agentId,
    })
    return true
  } catch (error) {
    if (error instanceof CommunicationDeniedError || error instanceof CommunicationPendingError)
      return false
    throw error
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
    case 'file':
      // Files are delivered as documents (handled in mirrorAgentTurnFrame), not
      // as a text line.
      return null
    case 'command_approval':
      // Telegram turns are non-interactive and auto-deny. The following bash
      // tool error is sufficient; never mirror an unusable approval prompt.
      return null
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

/**
 * Essential frames always mirror — they carry the agent's reply or a failure
 * the user must see. Everything else (verbose tool_call / tool_result /
 * tool_error lines) is "noise" subject to the per-agent outbound throttle.
 */
function isEssentialFrame(frame: ChatFrame): boolean {
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

/**
 * True when Telegram rejected the HTML body it couldn't parse (unbalanced or
 * unsupported entity). grammY surfaces this as a 400 GrammyError whose
 * description mentions entities — match the message defensively.
 */
function isParseEntitiesError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return (
    msg.includes("can't parse entities") ||
    msg.includes('can not parse entities') ||
    msg.includes('unsupported start tag') ||
    msg.includes('unmatched end tag') ||
    msg.includes('cant find end tag') ||
    msg.includes("can't find end")
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
export function mirrorTypingStart(
  agentId: string,
  attemptId: string = `telegram-typing:${Date.now()}`,
): void {
  const deps = _liveDepsResolver?.()
  if (!deps) return
  const topicId = agentRepo.getTelegramTopicId(deps.db, agentId)
  if (topicId === null) return

  // Clear any prior interval for this agent before starting a new one.
  mirrorTypingStop(agentId)

  const fire = (): boolean => {
    if (
      !telegramEgressAllowed(deps, agentId, attemptId, 'telegram_typing', {
        chatId: deps.chatId,
        topicId,
      })
    ) {
      mirrorTypingStop(agentId)
      return false
    }
    deps.api.sendChatAction(deps.chatId, 'typing', { message_thread_id: topicId }).catch(() => {
      // Indicator failures are silent — losing the bubble is purely
      // cosmetic; the actual reply still mirrors when ready.
    })
    return true
  }
  if (!fire()) return
  const interval = setInterval(() => {
    fire()
  }, TYPING_REFIRE_MS)
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
  _resetLoopGuardForTest()
}

/** Test-only — invoke the resolver to peek at what bot.ts wired. */
export function _peekMirrorDepsForTest(): MirrorDeps | null {
  return _liveDepsResolver?.() ?? null
}

// Outbound mirror: renders each ChatFrame of an Agent's turn into the Agent's forum topic, when
// it has one and the bot is running.
//
// Mirror policy is per-agent via `agents.telegram_mirror_mode`:
//   - 'minimal' (default): only `assistant_message` events + terminal
//                          errors/fatal frames. Clean conversation feel.
//   - 'verbose':           also surfaces concise tool-call summary lines
//                          so the operator can see the agent's steps.
// Images, delivered files and questions always go out.
//
// Sends route through the per-supergroup outbound queue so several agents don't trip Telegram's
// per-chat rate limit. Errors are logged but never fail the turn. A topic deleted in Telegram
// clears `agents.telegram_topic_id` on the next failed send.

import type { ChatFrame, TelegramMirrorMode, ToolResultImage } from '@bazilion/api-types'
import { InputFile } from 'grammy'
import { agentRepo } from '../../core/index.ts'
import * as results from '../../core/repos/results.ts'
import { type TelegramLive, telegramLive } from './live.ts'
import { _resetLoopGuardForTest, allowTelegramOutboundNoise } from './loop-guard.ts'
import {
  clip,
  renderTelegramMessages,
  stripTelegramHtml,
  TELEGRAM_SAFE_BUDGET,
} from './markdown.ts'
import { enqueueOutbound } from './outbound-queue.ts'
import { sendQuestionPrompt } from './questions.ts'
import { clearReactionsFor } from './reactions.ts'

/**
 * Mirror one frame. Safe to call for every yielded frame — silently no-ops when the agent isn't
 * bound or the bot isn't running. Never throws for Telegram failures.
 */
export async function mirrorAgentTurnFrame(agentId: string, frame: ChatFrame): Promise<void> {
  const live = telegramLive()
  if (!live) return
  const agent = agentRepo.get(live.db, agentId)
  const topicId = agent ? agentRepo.getTelegramTopicId(live.db, agent.id) : null
  if (!agent || topicId === null) return

  // Images (browser screenshots, MCP image results) are deliverables, not tool noise: a
  // minimal-mode user who asks for a screenshot must still receive it.
  const imagePayload = frameToolResultImages(frame)
  if (imagePayload) await mirrorImages(live, topicId, agent.id, imagePayload)

  if (frame.kind === 'event' && frame.event.type === 'file') {
    await mirrorFile(live, topicId, agent.id, frame.event)
  }
  if (frame.kind === 'event' && frame.event.type === 'agent_question') {
    await sendQuestionPrompt(live, topicId, frame.event.question).catch(() =>
      logMirrorAdapterFailure('telegram_mirror_question_failed', agent.id),
    )
    return
  }

  const text = renderFrame(frame, agent.telegramMirrorMode)
  if (!text) return

  // The agent's reply and failures always pass; the per-agent noise budget only drops verbose
  // tool lines from an Agent that floods its topic.
  const reply = isReplyFrame(frame)
  if (!reply && !allowTelegramOutboundNoise(agent.id)) return

  // The agent is replying: the reply replaces the 👀 on the user's messages.
  if (reply) clearReactionsFor(agent.id)

  // Only the agent's own reply is Markdown (rendered to Telegram HTML like the web UI).
  // Scaffolding lines may contain bare `<`/`>`, so they go out as plain text.
  const isAssistant = frame.kind === 'event' && frame.event.type === 'assistant_message'
  const chunks = isAssistant
    ? renderTelegramMessages(text, TELEGRAM_SAFE_BUDGET)
    : [clip(text, TELEGRAM_SAFE_BUDGET)]

  for (const chunk of chunks) {
    if (!chunk) continue
    try {
      await enqueueOutbound(live.chatId, () =>
        live.api.sendMessage(live.chatId, chunk, {
          message_thread_id: topicId,
          ...(isAssistant ? { parse_mode: 'HTML' as const } : {}),
        }),
      )
    } catch (e) {
      if (isThreadGoneError(e)) {
        console.warn(
          `telegram mirror: topic ${topicId} for agent ${agent.id} is gone — clearing binding`,
        )
        agentRepo.setTelegramTopicId(live.db, agent.id, null)
        return
      }
      // A malformed entity makes Telegram reject the message; resend that chunk as plain text
      // so a converter glitch never costs the user their reply.
      if (isAssistant && isParseEntitiesError(e)) {
        try {
          await enqueueOutbound(live.chatId, () =>
            live.api.sendMessage(live.chatId, stripTelegramHtml(chunk), {
              message_thread_id: topicId,
            }),
          )
        } catch {
          logMirrorAdapterFailure('telegram_mirror_text_fallback_failed', agent.id)
        }
        continue
      }
      logMirrorAdapterFailure('telegram_mirror_text_failed', agent.id)
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
  live: TelegramLive,
  topicId: number,
  agentId: string,
  payload: { images: ToolResultImage[]; caption: string },
): Promise<void> {
  const caption = clip(payload.caption, CAPTION_BUDGET)
  for (const img of payload.images) {
    const buf = Buffer.from(img.data, 'base64')
    const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png'
    // InputFile wraps a Buffer as a single-use stream — build a fresh one per
    // send attempt (the photo try + the document fallback).
    const file = (): InputFile => new InputFile(buf, `screenshot.${ext}`)
    try {
      await enqueueOutbound(live.chatId, () =>
        live.api.sendPhoto(live.chatId, file(), { message_thread_id: topicId, caption }),
      )
    } catch (e) {
      if (isThreadGoneError(e)) {
        agentRepo.setTelegramTopicId(live.db, agentId, null)
        return
      }
      try {
        await enqueueOutbound(live.chatId, () =>
          live.api.sendDocument(live.chatId, file(), { message_thread_id: topicId, caption }),
        )
      } catch {
        logMirrorAdapterFailure('telegram_mirror_image_failed', agentId)
      }
    }
  }
}

/** Send an agent-delivered file, read from the saved results, as a Telegram document. Never throws. */
async function mirrorFile(
  live: TelegramLive,
  topicId: number,
  agentId: string,
  ev: { name: string; result: { resultId: string } },
): Promise<void> {
  try {
    const buf = results.read(live.db, ev.result.resultId)
    await enqueueOutbound(live.chatId, () =>
      live.api.sendDocument(live.chatId, new InputFile(buf, ev.name), {
        message_thread_id: topicId,
        caption: ev.name,
      }),
    )
  } catch (e) {
    if (isThreadGoneError(e)) {
      agentRepo.setTelegramTopicId(live.db, agentId, null)
      return
    }
    logMirrorAdapterFailure('telegram_mirror_file_failed', agentId)
  }
}

function logMirrorAdapterFailure(event: string, agentId: string): void {
  // Grammy errors can embed the Bot API URL, including the bot token. Keep
  // adapter diagnostics metadata-only at this Bazilion-authored log boundary.
  console.warn(JSON.stringify({ event, agentId, failure: 'telegram_adapter_failed' }))
}

// ─── frame → text rendering ─────────────────────────────────────────────

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
      return mode === 'verbose' ? `✓ ${ev.name} → ${clip(ev.result, 200)}` : null
    case 'tool_error':
      return mode === 'verbose' ? `✕ ${ev.name}: ${ev.error}` : null
    case 'command_approval':
      // Telegram turns are non-interactive and auto-deny. The following bash
      // tool error is sufficient; never mirror an unusable approval prompt.
      return null
    case 'file':
    case 'agent_question':
    case 'tool_progress':
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
    const pairs = Object.entries(parsed).map(
      ([k, v]) => `${k}=${clip(typeof v === 'string' ? v : JSON.stringify(v), 40)}`,
    )
    return clip(pairs.join(', '), 120)
  } catch {
    return clip(rawArgs, 120)
  }
}

/** The agent's reply or a failure the user must see: never throttled, and clears 👀. */
function isReplyFrame(frame: ChatFrame): boolean {
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
// Telegram's "typing..." bubble lasts about 5 s, so it is re-sent every 4 s while a turn runs.
// runAgentTurn's `finally` stops it on every exit path.

const TYPING_REFIRE_MS = 4_000

const _typingIntervals = new Map<string, ReturnType<typeof setInterval>>()

/** Start the typing indicator in the agent's topic. Idempotent per agent. */
export function mirrorTypingStart(agentId: string): void {
  const live = telegramLive()
  if (!live) return
  const topicId = agentRepo.getTelegramTopicId(live.db, agentId)
  if (topicId === null) return
  mirrorTypingStop(agentId)
  const fire = (): void => {
    // Losing the bubble is cosmetic; a stopped bot gets no more of them.
    const current = telegramLive()
    current?.api
      .sendChatAction(current.chatId, 'typing', { message_thread_id: topicId })
      .catch(() => {})
  }
  fire()
  _typingIntervals.set(agentId, setInterval(fire, TYPING_REFIRE_MS))
}

/** Stop the typing indicator. Safe to call even when none is running. */
export function mirrorTypingStop(agentId: string): void {
  const interval = _typingIntervals.get(agentId)
  if (interval) {
    clearInterval(interval)
    _typingIntervals.delete(agentId)
  }
}

/** Test-only. */
export function _resetMirrorForTest(): void {
  for (const interval of _typingIntervals.values()) clearInterval(interval)
  _typingIntervals.clear()
  _resetLoopGuardForTest()
}

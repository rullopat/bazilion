// One-shot Bot API calls used to validate a freshly-pasted token+chatId
// pair on the /config/integrations/telegram setup page. Step 1 has no live
// bot — we just need to confirm the four facts the user can fix themselves
// before Step 2 wires up the polling singleton:
//
//   1. The token resolves to a bot account (getMe).
//   2. The supergroup exists and is forum-enabled (getChat → is_forum).
//   3. The bot is admin in the supergroup with can_manage_topics
//      (getChatMember).
//   4. Privacy Mode is OFF (getMe → can_read_all_group_messages).
//
// Bare `fetch` against api.telegram.org — no grammY dep yet; that lands in
// Step 2 alongside the polling driver.

import type { TelegramHealth, TelegramPreflight } from '@bazilion/api-types'

/** Default Bot API base URL. Overridable in tests via the optional `apiBase` arg. */
const TELEGRAM_API_BASE = 'https://api.telegram.org'

/** Wall-clock cap per Bot API call. The user is waiting on a setup form. */
const PREFLIGHT_TIMEOUT_MS = 10_000

type PreflightStep = NonNullable<TelegramHealth['error']>['step']

interface BotApiResult<T> {
  ok: boolean
  result?: T
  description?: string
}

interface GetMeResult {
  id: number
  username: string
  /** Critical: when Privacy Mode is OFF, this is true. */
  can_read_all_group_messages: boolean
}

interface GetChatResult {
  id: number
  type: string
  title: string
  is_forum?: boolean
}

interface GetChatMemberResult {
  status: string
  can_manage_topics?: boolean
}

export interface RunPreflightArgs {
  botToken: string
  chatId: string
  /** Defaults to https://api.telegram.org. Overridden in tests. */
  apiBase?: string
  /** Wired through to the underlying fetch — overridable for tests. */
  fetchFn?: typeof fetch
}

/**
 * Run the four-step preflight against Telegram's Bot API. Returns a
 * fully-populated `TelegramHealth` regardless of outcome — callers can
 * render the result without further error handling.
 */
export async function runPreflight(args: RunPreflightArgs): Promise<TelegramHealth> {
  const base = args.apiBase ?? TELEGRAM_API_BASE
  const f = args.fetchFn ?? fetch

  const call = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
    const url = `${base}/bot${args.botToken}/${method}`
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), PREFLIGHT_TIMEOUT_MS)
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      // Telegram returns 4xx for "ok: false" with a JSON body — we still want
      // to read the description rather than collapsing into the HTTP status.
      const json = (await res.json().catch(() => null)) as BotApiResult<T> | null
      if (!json) throw new Error(`HTTP ${res.status} ${res.statusText} (no JSON body)`)
      if (!json.ok || json.result === undefined) {
        throw new Error(json.description ?? `HTTP ${res.status} ${res.statusText}`)
      }
      return json.result
    } finally {
      clearTimeout(t)
    }
  }

  const fail = (step: PreflightStep, message: string): TelegramHealth => ({
    configured: true,
    preflight: null,
    error: { step, message },
    polling: null,
  })

  let me: GetMeResult
  try {
    me = await call<GetMeResult>('getMe', {})
  } catch (e) {
    return fail('getMe', errorMessage(e))
  }

  let chat: GetChatResult
  try {
    chat = await call<GetChatResult>('getChat', { chat_id: chatId(args.chatId) })
  } catch (e) {
    return fail('getChat', errorMessage(e))
  }

  let member: GetChatMemberResult
  try {
    member = await call<GetChatMemberResult>('getChatMember', {
      chat_id: chatId(args.chatId),
      user_id: me.id,
    })
  } catch (e) {
    return fail('getChatMember', errorMessage(e))
  }

  // Admins have can_manage_topics surfaced as a boolean; non-admins won't have
  // the field at all, so default to false. The supergroup owner ('creator')
  // implicitly has all rights — surface that as true.
  const hasManageTopics = member.status === 'creator' || member.can_manage_topics === true

  const preflight: TelegramPreflight = {
    botUsername: me.username,
    chatTitle: chat.title,
    isForum: chat.is_forum === true,
    hasManageTopics,
    privacyModeOff: me.can_read_all_group_messages === true,
  }

  return {
    configured: true,
    preflight,
    error: null,
    polling: null,
  }
}

function chatId(raw: string): number | string {
  // Telegram accepts both `@username` and numeric ids. Coerce to number when
  // it parses cleanly so the JSON body is `{"chat_id": -100…}` not
  // `{"chat_id": "-100…"}` — both work but numeric is canonical.
  const trimmed = raw.trim()
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return 'request timed out after 10s'
    return e.message
  }
  return String(e)
}

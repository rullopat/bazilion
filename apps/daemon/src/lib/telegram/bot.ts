// grammY bot singleton + long-polling loop + first-activation orchestrator.
//
// Module-scoped state holds at most one live bot at a time. start/stop/restart
// are serialized through a Promise mutex so callers can't race two starts.
//
// Polling uses our own loop over `bot.api.getUpdates` rather than grammY's
// `bot.start()` so we can:
//   • Persist the offset to TELEGRAM_LAST_UPDATE_ID after every fully-dispatched
//     update — a daemon restart mid-turn resumes exactly where it left off,
//     since Telegram retains updates server-side for 24h.
//   • Surface the watermark + last-successful-poll timestamp on the health
//     endpoint without reaching into grammY internals.
//
// Inbound updates in Step 2 are logged-and-advanced. Step 3 will replace
// dispatchUpdate with the real routing layer.

import type { TelegramPollingState } from '@bazilion/api-types'
import { Bot, GrammyError } from 'grammy'
import type { Update } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { openConfig, openSecrets, type Paths, resolvePaths } from '../../core/index.ts'
import { type ActivationApi, runActivation } from './activation.ts'
import { type DirectoryApi, installLiveDepsResolver } from './directory.ts'
import { installMirrorDepsResolver, type MirrorApi } from './mirror.ts'
import { installStickerApiResolver, type StickerApi } from './profile-emojis.ts'
import { installReactionsDepsResolver, type ReactionsApi } from './reactions.ts'
import { type ReplyApi, routeUpdate } from './routing.ts'

const POLL_TIMEOUT_S = 25
const STALL_MS_DEFAULT = 120_000
const GETUPDATES_RETRY_MS = 5_000

const BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN'
const CHAT_ID_KEY = 'TELEGRAM_CHAT_ID'
const LAST_UPDATE_KEY = 'TELEGRAM_LAST_UPDATE_ID'

interface BotHandle {
  bot: Bot
  chatId: number
  /** Cached resolvePaths() so each routed update doesn't re-walk env vars. */
  paths: Paths
  /** Same auth token the rest of the daemon uses — needed for secrets store access from inside commands. */
  authToken: string
  state: TelegramPollingState
  stopRequested: boolean
  pollPromise: Promise<void> | null
  stallTimer: NodeJS.Timeout | null
}

let _handle: BotHandle | null = null
// Serialize start/stop/restart so callers can't race. Each enqueued task
// chains off the previous one regardless of whether it resolved or rejected.
let _mutex: Promise<unknown> = Promise.resolve()

/** Snapshot of the current polling state. `null` when no bot is running. */
export function getTelegramBotState(): TelegramPollingState | null {
  if (!_handle) return null
  // Return a copy so consumers can't mutate live state.
  return { ..._handle.state }
}

/** Whether a bot instance is currently held by the module. */
export function isTelegramBotRunning(): boolean {
  return _handle !== null
}

/**
 * Live bot api + chat id for the consumers that need to make outbound
 * Bot API calls outside the standard `runAgentTurn` / mirror path (HTTP
 * endpoints for explicit bind/unbind, future admin tooling, etc).
 * Returns `null` when the bot isn't running — callers should 503 in
 * that case rather than queueing.
 */
export function getTelegramBotApi(): { api: Bot['api']; chatId: number } | null {
  if (!_handle) return null
  return { api: _handle.bot.api, chatId: _handle.chatId }
}

/**
 * Boot the bot if credentials are present. No-op if a bot is already running
 * or credentials are missing. Safe to call from daemon startup before the
 * user has configured Telegram.
 */
export function maybeStartTelegramBot(db: BazilionDb, authToken: string): Promise<void> {
  return enqueue(async () => {
    if (_handle) return
    const creds = readCreds(db, authToken)
    if (!creds) return
    await startInternal(db, authToken, creds.botToken, creds.chatId)
  })
}

/**
 * Restart the bot — tears down any running instance and brings a fresh one
 * up from the current creds. No-op tear-down if no bot is running.
 * No start if creds are absent.
 */
export function restartTelegramBot(db: BazilionDb, authToken: string): Promise<void> {
  return enqueue(async () => {
    await stopInternal()
    const creds = readCreds(db, authToken)
    if (!creds) return
    await startInternal(db, authToken, creds.botToken, creds.chatId)
  })
}

/** Stop the bot if one is running. No-op otherwise. */
export function stopTelegramBot(): Promise<void> {
  return enqueue(stopInternal)
}

// ─── internals ───────────────────────────────────────────────────────────

function readCreds(db: BazilionDb, authToken: string): { botToken: string; chatId: number } | null {
  const botToken = openSecrets(db, authToken).get(BOT_TOKEN_KEY) ?? ''
  const chatIdRaw = openConfig(db).get(CHAT_ID_KEY) ?? ''
  if (!botToken || !chatIdRaw) return null
  const chatId = Number(chatIdRaw)
  if (!Number.isFinite(chatId)) {
    console.error(`telegram: stored chat id is not numeric: ${chatIdRaw}`)
    return null
  }
  return { botToken, chatId }
}

async function startInternal(
  db: BazilionDb,
  authToken: string,
  botToken: string,
  chatId: number,
): Promise<void> {
  const bot = new Bot(botToken)
  const state: TelegramPollingState = {
    running: false,
    activated: false,
    lastUpdateId: null,
    lastSuccessfulPollAt: null,
    startedAt: Date.now(),
    error: null,
  }
  const handle: BotHandle = {
    bot,
    chatId,
    paths: resolvePaths(),
    authToken,
    state,
    stopRequested: false,
    pollPromise: null,
    stallTimer: null,
  }

  // Webhook conflict recovery. If a webhook is set on this token (because
  // the user once configured one, or a different process did), getUpdates
  // returns 409. Clear it up-front; failures here are non-fatal because the
  // bot might never have had a webhook.
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false })
  } catch (e) {
    console.warn('telegram: deleteWebhook failed (continuing):', errMsg(e))
  }

  // Read persisted watermark. offset = lastUpdateId + 1 (so we resume past
  // the last fully-dispatched update); 0 means "from oldest available".
  const persistedLastUpdate = readConfigNumber(db, LAST_UPDATE_KEY)
  state.lastUpdateId = persistedLastUpdate
  const initialOffset = persistedLastUpdate !== null ? persistedLastUpdate + 1 : 0

  _handle = handle
  state.running = true

  // Stall watchdog. Compares now() − lastSuccessfulPollAt to the configured
  // threshold; triggers a self-restart if exceeded. Tick at half the stall
  // threshold so we detect within ~stallMs/2 after a hang.
  const stallMs = Number(process.env.BAZILION_TELEGRAM_POLLING_STALL_MS ?? STALL_MS_DEFAULT)
  if (Number.isFinite(stallMs) && stallMs > 0) {
    handle.stallTimer = setInterval(
      () => {
        if (handle.stopRequested) return
        // Use startedAt as the baseline until the first successful poll lands.
        const reference = handle.state.lastSuccessfulPollAt ?? handle.state.startedAt ?? Date.now()
        if (Date.now() - reference > stallMs) {
          console.warn(
            `telegram: poll stall detected (no successful getUpdates in >${Math.round(stallMs / 1000)}s) — restarting bot`,
          )
          // Fire-and-forget restart on a microtask so we don't block the timer.
          void restartTelegramBot(db, _cachedAuthToken!).catch((e) =>
            console.error('telegram: stall-triggered restart failed:', errMsg(e)),
          )
        }
      },
      Math.max(stallMs / 2, 5_000),
    )
  }

  // Wire the live-deps resolver so notifyDirectoryDirty() (called from
  // command handlers and the daemon's agent CRUD routes) can find this
  // bot's chatId / api / db / paths without a static import cycle.
  installLiveDepsResolver(() => ({
    db,
    paths: handle.paths,
    api: handle.bot.api as unknown as DirectoryApi,
    chatId: handle.chatId,
  }))

  // Mirror lives in a separate module to avoid pulling agent-turn deps into
  // the activation path. Same lazy-resolution pattern.
  installMirrorDepsResolver(() => ({
    db,
    api: handle.bot.api as unknown as MirrorApi,
    chatId: handle.chatId,
  }))

  // Reactions: 👀 "bot saw it" indicator on inbound user messages.
  installReactionsDepsResolver(() => ({
    api: handle.bot.api as unknown as ReactionsApi,
    chatId: handle.chatId,
  }))

  // Profile-derived topic emojis: give the resolver the live api so it can
  // fetch + cache Telegram's forum-icon sticker set on first use.
  installStickerApiResolver(() => handle.bot.api as unknown as StickerApi)

  // Activation runs in the background — polling does NOT block on it.
  // If activation fails (e.g. forum mode off after creds saved, transient
  // network), we still want incoming messages to be observed.
  void runActivation({ db, paths: handle.paths, api: bot.api as unknown as ActivationApi, chatId })
    .then((result) => {
      handle.state.activated = true
      console.log(
        `telegram: activated — service topic=${result.serviceTopicId} directory msg=${result.directoryMessageId}`,
      )
    })
    .catch((e) => {
      handle.state.error = `activation: ${errMsg(e)}`
      console.error('telegram: activation failed:', errMsg(e))
    })

  // Start the poll loop. Don't await — startInternal returns once setup is
  // complete; pollPromise keeps running.
  handle.pollPromise = pollLoop(handle, db, initialOffset).catch((e) => {
    console.error('telegram: poll loop crashed:', errMsg(e))
    handle.state.error = errMsg(e)
    handle.state.running = false
  })

  console.log(`telegram: bot started — polling from offset=${initialOffset}`)
}

async function pollLoop(handle: BotHandle, db: BazilionDb, initialOffset: number): Promise<void> {
  let offset = initialOffset
  while (!handle.stopRequested) {
    let updates: Update[] = []
    try {
      updates = await handle.bot.api.getUpdates({
        offset,
        timeout: POLL_TIMEOUT_S,
      })
      handle.state.lastSuccessfulPollAt = Date.now()
      handle.state.error = null
    } catch (e) {
      if (handle.stopRequested) break
      const msg = errMsg(e)
      handle.state.error = msg
      // 409 conflicts are usually a stale webhook or another instance — log
      // loud and back off.
      if (e instanceof GrammyError && e.error_code === 409) {
        console.error('telegram: getUpdates 409 conflict (webhook or duplicate poller):', msg)
      } else {
        console.error('telegram: getUpdates failed:', msg)
      }
      await sleep(GETUPDATES_RETRY_MS)
      continue
    }

    for (const u of updates) {
      try {
        await dispatchUpdate(handle, db, u)
      } catch (e) {
        console.error('telegram: dispatch threw (advancing offset to avoid retry loop):', errMsg(e))
      }
      offset = u.update_id + 1
      handle.state.lastUpdateId = u.update_id
      // Persist the watermark synchronously so a crash here doesn't
      // re-deliver updates we've already logged.
      try {
        openConfig(db).set(LAST_UPDATE_KEY, String(u.update_id))
      } catch (e) {
        // Persistence failure shouldn't kill the loop; we'll lose the
        // watermark on next restart but Telegram will redeliver.
        console.warn('telegram: failed to persist last update id:', errMsg(e))
      }
    }
  }
  handle.state.running = false
}

/**
 * Step-3 dispatch. Delegates to the routing helper which classifies the
 * update + sends an appropriate Telegram reply where warranted. We still
 * log every update so the daemon log stays useful for debugging.
 */
async function dispatchUpdate(handle: BotHandle, db: BazilionDb, u: Update): Promise<void> {
  const m = u.message ?? u.edited_message ?? u.channel_post ?? null
  if (m) {
    const preview = (m.text ?? m.caption ?? '').slice(0, 80)
    const thread = m.message_thread_id ?? 'none'
    console.log(
      `telegram update ${u.update_id} · chat=${m.chat.id} thread=${thread} · "${preview}"`,
    )
  } else {
    console.log(`telegram update ${u.update_id} · non-message: ${Object.keys(u).join(',')}`)
  }

  // Route chat messages + callback_query taps. Member/poll/etc. flow past
  // the router untouched.
  if (!u.message && !u.edited_message && !u.callback_query) return
  const outcome = await routeUpdate(
    {
      db,
      paths: handle.paths,
      authToken: handle.authToken,
      api: handle.bot.api as unknown as ReplyApi,
      chatId: handle.chatId,
      botToken: handle.bot.token,
    },
    u,
  )
  if (outcome.kind === 'service_command' || outcome.kind === 'service_unknown_command') {
    console.log(`telegram: dispatched /${outcome.name} (kind=${outcome.kind})`)
  } else if (outcome.kind === 'agent_topic') {
    console.log(
      `telegram: agent-topic inbound for agent=${outcome.agentId} (chat-back ships in step 6)`,
    )
  } else if (outcome.kind === 'callback_spawn_profile') {
    console.log(`telegram: callback spawn:profile:${outcome.profileId}`)
  } else if (outcome.kind === 'callback_spawn_team') {
    console.log(`telegram: callback spawn:team:${outcome.profileGroupId}`)
  } else if (outcome.kind === 'spawn_name_input') {
    console.log(
      `telegram: spawn-name input completed for profile=${outcome.profileId} spawned=${outcome.spawned}`,
    )
  } else if (outcome.kind === 'rate_limited') {
    console.warn(
      `telegram: inbound rate budget tripped for agent=${outcome.agentId} — dropping message`,
    )
  } else if (outcome.kind === 'ignored_bot') {
    console.log('telegram: ignored inbound from a bot account')
  } else if (outcome.kind === 'chat_migrated') {
    console.warn(
      `telegram: supergroup migrated to chat id ${outcome.toChatId} — reconnect via /api/config/telegram/reconnect`,
    )
  } else if (outcome.kind === 'unauthorized') {
    console.log(`telegram: ignored unauthorized user ${outcome.userId}`)
  } else if (outcome.kind === 'owner_claimed') {
    console.log(`telegram: user ${outcome.userId} claimed owner (TOFU bootstrap)`)
  }
}

async function stopInternal(): Promise<void> {
  if (!_handle) return
  const h = _handle
  _handle = null
  h.stopRequested = true
  if (h.stallTimer) {
    clearInterval(h.stallTimer)
    h.stallTimer = null
  }
  // Wait for the in-flight getUpdates to finish. The 25s long-poll caps the
  // wait. We swallow exceptions because we're tearing down anyway.
  try {
    await h.pollPromise
  } catch {
    /* ignore */
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = _mutex.then(fn, fn)
  // Keep the mutex chain going regardless of success/failure of this task.
  _mutex = next.catch(() => null)
  return next
}

function readConfigNumber(db: BazilionDb, key: string): number | null {
  const raw = openConfig(db).get(key) ?? ''
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── auth token cache for stall-triggered restarts ───────────────────────
// The stall watchdog runs in setInterval scope and doesn't have access to
// the ctx singleton's authToken without re-bootstrapping. We cache it on
// first start; rotation tears down and re-caches on the next start.

let _cachedAuthToken: string | null = null

/** Caller passes the daemon's auth token so the watchdog can re-bootstrap on stall. */
export function setTelegramAuthToken(token: string): void {
  _cachedAuthToken = token
}

/**
 * Helper for tests — reset the singleton state so test files can build a
 * fresh bot lifecycle. Production code never needs this.
 */
export function _resetTelegramBotForTest(): void {
  if (_handle) {
    _handle.stopRequested = true
    if (_handle.stallTimer) clearInterval(_handle.stallTimer)
  }
  _handle = null
  _mutex = Promise.resolve()
  _cachedAuthToken = null
}

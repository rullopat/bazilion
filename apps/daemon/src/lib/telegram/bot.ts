// grammY bot singleton, long-polling loop and first-activation orchestrator.
//
// At most one bot runs at a time; start/stop/restart are serialized through a promise mutex.
// Polling is our own loop over `bot.api.getUpdates` rather than grammY's `bot.start()`, so the
// offset is persisted to TELEGRAM_LAST_UPDATE_ID after every dispatched update (a restart resumes
// where it left off; Telegram keeps updates for 24 h) and the health endpoint can show the
// watermark and the last successful poll.

import type { TelegramPollingState } from '@bazilion/api-types'
import { Bot, GrammyError } from 'grammy'
import type { Update } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { openConfig, type Paths, resolvePaths } from '../../core/index.ts'
import { type ActivationApi, runActivation } from './activation.ts'
import { LAST_UPDATE_KEY, readConfigNumber, readCreds, redactToken } from './config.ts'
import { setTelegramLive } from './live.ts'
import { type ReplyApi, routeUpdate } from './routing.ts'

const POLL_TIMEOUT_S = 25
const GETUPDATES_RETRY_MS = 5_000

interface BotHandle {
  bot: Bot
  chatId: number
  paths: Paths
  state: TelegramPollingState
  stopRequested: boolean
  pollPromise: Promise<void> | null
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
 * Boot the bot if credentials are present. No-op if a bot is already running
 * or credentials are missing. Safe to call from daemon startup before the
 * user has configured Telegram.
 */
export function maybeStartTelegramBot(db: BazilionDb, authToken: string): Promise<void> {
  return enqueue(async () => {
    if (_handle) return
    const creds = readCreds(db, authToken)
    if (!creds) return
    await startInternal(db, creds.botToken, creds.chatId)
  })
}

/**
 * Restart the bot — tears down any running instance and brings a fresh one
 * up from the current creds. No start if creds are absent.
 */
export function restartTelegramBot(db: BazilionDb, authToken: string): Promise<void> {
  return enqueue(async () => {
    await stopInternal()
    const creds = readCreds(db, authToken)
    if (!creds) return
    await startInternal(db, creds.botToken, creds.chatId)
  })
}

/** Stop the bot if one is running. No-op otherwise. */
export function stopTelegramBot(): Promise<void> {
  return enqueue(stopInternal)
}

// ─── internals ───────────────────────────────────────────────────────────

async function startInternal(db: BazilionDb, botToken: string, chatId: number): Promise<void> {
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
    state,
    stopRequested: false,
    pollPromise: null,
  }

  // getUpdates returns 409 while a webhook is set on this token. Clear it up
  // front; failure is fine because there may never have been one.
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false })
  } catch (e) {
    console.warn('telegram: deleteWebhook failed (continuing):', errMsg(e))
  }

  // Resume past the last fully-dispatched update; 0 means "from oldest available".
  const persistedLastUpdate = readConfigNumber(db, LAST_UPDATE_KEY)
  state.lastUpdateId = persistedLastUpdate
  const initialOffset = persistedLastUpdate !== null ? persistedLastUpdate + 1 : 0

  _handle = handle
  state.running = true
  setTelegramLive({ api: bot.api, chatId, db, paths: handle.paths })

  // Activation runs in the background: if it fails (forum mode turned off,
  // a network blip) incoming messages are still observed.
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
    // A silently dropped connection leaves the fetch hanging far past the long-poll window
    // (grammY's default client timeout is ~500 s). Aborting at +5 s turns it into an ordinary
    // retry on the next iteration.
    const ac = new AbortController()
    const abortTimer = setTimeout(() => ac.abort(), (POLL_TIMEOUT_S + 5) * 1000)
    try {
      updates = await handle.bot.api.getUpdates(
        {
          offset,
          timeout: POLL_TIMEOUT_S,
        },
        // grammY's Node shim types the signal param as the `abort-controller`
        // package's AbortSignal, not the global one — runtime-compatible, so
        // cast through the method's own parameter type.
        ac.signal as unknown as Parameters<typeof handle.bot.api.getUpdates>[1],
      )
      handle.state.lastSuccessfulPollAt = Date.now()
      handle.state.error = null
    } catch (e) {
      if (handle.stopRequested) break
      const msg = errMsg(e)
      handle.state.error = msg
      if (ac.signal.aborted) {
        console.warn(
          `telegram: getUpdates exceeded ${POLL_TIMEOUT_S + 5}s (connection likely dropped) — retrying`,
        )
        continue
      }
      // 409 conflicts are usually a stale webhook or another instance.
      if (e instanceof GrammyError && e.error_code === 409) {
        console.error('telegram: getUpdates 409 conflict (webhook or duplicate poller):', msg)
      } else {
        console.error('telegram: getUpdates failed:', msg)
      }
      await sleep(GETUPDATES_RETRY_MS)
      continue
    } finally {
      clearTimeout(abortTimer)
    }

    for (const u of updates) {
      try {
        await dispatchUpdate(handle, db, u)
      } catch (e) {
        console.error('telegram: dispatch threw (advancing offset to avoid retry loop):', errMsg(e))
      }
      offset = u.update_id + 1
      handle.state.lastUpdateId = u.update_id
      // Persist the watermark synchronously so a crash here doesn't redeliver it.
      try {
        openConfig(db).set(LAST_UPDATE_KEY, String(u.update_id))
      } catch (e) {
        // Telegram redelivers on the next restart; the queue makes that harmless.
        console.warn('telegram: failed to persist last update id:', errMsg(e))
      }
    }
  }
  handle.state.running = false
}

/** Route messages and button taps; member changes, polls and the like pass by. */
async function dispatchUpdate(handle: BotHandle, db: BazilionDb, u: Update): Promise<void> {
  if (!u.message && !u.edited_message && !u.callback_query) return
  const outcome = await routeUpdate(
    {
      db,
      paths: handle.paths,
      api: handle.bot.api as unknown as ReplyApi,
      chatId: handle.chatId,
      botToken: handle.bot.token,
    },
    u,
  )
  if (outcome.kind === 'chat_migrated') {
    console.warn(
      `telegram: supergroup migrated to chat id ${outcome.toChatId} — reconnect via /api/config/telegram/reconnect`,
    )
  } else {
    console.log(`telegram: update ${u.update_id} → ${outcome.kind}`)
  }
}

async function stopInternal(): Promise<void> {
  if (!_handle) return
  const h = _handle
  _handle = null
  h.stopRequested = true
  // Nothing reaches Telegram once the bot is stopped.
  setTelegramLive(null)
  // Wait for the in-flight getUpdates to finish (the 25 s long-poll caps the wait).
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

function errMsg(e: unknown): string {
  return redactToken(e instanceof Error ? e.message : String(e))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

import type { NotificationSettings, NotificationSettingsResponse } from '@bazilion/api-types'
import { ATTENTION_KINDS, projectAttention } from '../core/attention.ts'
import type { BazilionDb } from '../core/db/client.ts'
import * as repo from '../core/repos/notifications.ts'
import { attentionNotificationMessage } from './notification-message.ts'
import {
  isNotificationQuiet,
  notificationQuietHours,
  notificationTimezone,
} from './notification-quiet-hours.ts'
import { readServiceTopicId } from './telegram/config.ts'
import { telegramLive } from './telegram/live.ts'
import { enqueueOutbound } from './telegram/outbound-queue.ts'

const TICK_MS = 30_000
/** At most this many notices per tick, so switching on never floods the topic. */
const SENDS_PER_TICK = 10

function telegramReady(db: BazilionDb): boolean {
  const live = telegramLive()
  return live !== null && live.db === db && readServiceTopicId(db) !== null
}

export function readNotificationSettings(db: BazilionDb): NotificationSettingsResponse {
  const { enabledAt: _enabledAt, ...settings } = repo.settings(db)
  return { ...settings, telegramReady: telegramReady(db) }
}

export function saveNotificationSettings(
  db: BazilionDb,
  body: unknown,
): NotificationSettingsResponse {
  const input = (body ?? {}) as Record<string, unknown>
  if (typeof input.enabled !== 'boolean') throw new Error('enabled must be true or false')
  const kinds = input.kinds
  if (
    !Array.isArray(kinds) ||
    kinds.length === 0 ||
    kinds.some((kind) => !(ATTENTION_KINDS as readonly unknown[]).includes(kind))
  )
    throw new Error(`kinds must list one or more of: ${ATTENTION_KINDS.join(', ')}`)
  const settings: NotificationSettings = {
    enabled: input.enabled,
    kinds: ATTENTION_KINDS.filter((kind) => kinds.includes(kind)),
    timezone: notificationTimezone(input.timezone),
    quietHours: notificationQuietHours(input.quietHours ?? null),
  }
  repo.save(db, settings)
  return readNotificationSettings(db)
}

/**
 * Send each new open Attention item of a selected kind to the Telegram service topic once.
 * Nothing goes out while notifications are off, during quiet hours or while the bot is stopped;
 * an item that fails to send stays unmarked and is tried again on the next tick.
 */
export async function sendAttentionNotifications(db: BazilionDb, now = Date.now()): Promise<void> {
  const settings = repo.settings(db)
  if (!settings.enabled || settings.enabledAt === null) return
  const projection = projectAttention(db, { state: 'open', limit: 100_000 })
  if (projection.degraded.length === 0)
    repo.forgetClosed(db, new Set(projection.items.map((item) => item.key)))
  if (isNotificationQuiet(now, settings.timezone, settings.quietHours)) return
  const live = telegramLive()
  const topicId = readServiceTopicId(db)
  if (!live || live.db !== db || topicId === null) return
  const sent = repo.notifiedKeys(db)
  const due = projection.items
    .filter(
      (item) =>
        settings.kinds.includes(item.kind) &&
        item.updatedAt >= (settings.enabledAt ?? now) &&
        !sent.has(item.key),
    )
    .reverse()
    .slice(0, SENDS_PER_TICK)
  for (const item of due) {
    try {
      await enqueueOutbound(live.chatId, () =>
        live.api.sendMessage(live.chatId, attentionNotificationMessage(item), {
          message_thread_id: topicId,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
      )
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'attention_notification_failed',
          kind: item.kind,
          error: error instanceof Error ? error.name : 'unknown',
        }),
      )
      return
    }
    repo.markNotified(db, item.kind, item.sourceId)
  }
}

const pumpKey = Symbol.for('bazilion.notifications')
const registry = globalThis as typeof globalThis & { [pumpKey]?: { stop(): void } }

/** One process-wide pump; starting it again replaces the previous one. */
export function startNotifications(db: BazilionDb): { stop(): void } {
  registry[pumpKey]?.stop()
  let running = false
  const tick = () => {
    if (running) return
    running = true
    sendAttentionNotifications(db)
      .catch((error) =>
        console.warn('attention notifications:', error instanceof Error ? error.message : error),
      )
      .finally(() => {
        running = false
      })
  }
  const timer = setInterval(tick, TICK_MS)
  timer.unref()
  const pump = {
    stop() {
      clearInterval(timer)
      if (registry[pumpKey] === pump) delete registry[pumpKey]
    },
  }
  registry[pumpKey] = pump
  tick()
  return pump
}

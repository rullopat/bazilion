// Topic-name templating + group icon-color allocation.
//
// Names:  default group → bare agent.name;
//         every other group → "<group.id> › <agent.name>".
// Colors: Telegram exposes a 6-value icon-color enum. Red (16478047) is
//         reserved for the ⚙ bazilion service topic. The remaining 5 are
//         dealt out round-robin to bazilion groups in the order each group's
//         first agent first touches Telegram. Past the 5th group, colors
//         repeat — name prefixing is authoritative for disambiguation, color
//         is a visual hint.

import type { Agent, Group } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { groupRepo } from '../../core/index.ts'

/** ⚙ bazilion service topic uses red; groups get the other 5. */
export const SERVICE_TOPIC_COLOR = 16478047

/** Telegram's non-red icon-color enum values, in round-robin order. */
export const GROUP_COLORS: readonly number[] = [
  7322096, // light blue / cyan
  16766590, // orange
  13338331, // purple / lavender
  9367192, // green
  16749490, // pink / rose
]

/** The seeded default group id — bare topic names for its agents. */
export const DEFAULT_GROUP_ID = 'default'

/**
 * Build the forum-topic name for an agent in a group. Default group uses the
 * bare agent name (single-tenant feel); every other group prefixes the slug
 * + arrow separator so cross-group topics are visually distinguishable when
 * they share a supergroup.
 *
 * Length budget: Telegram caps topic names at 128 characters. We compose
 * something like "<group-id> › <agent-name>"; in practice slugs and agent
 * names are short. We don't truncate here — let `createForumTopic` reject
 * if the operator picks pathological names.
 */
export function topicNameFor(agent: Pick<Agent, 'name'>, group: Pick<Group, 'id'>): string {
  if (group.id === DEFAULT_GROUP_ID) return agent.name
  return `${group.id} › ${agent.name}`
}

/**
 * Pick (and persist) the icon color for a bazilion group. Idempotent: a
 * second call returns the previously-allocated color. The first call
 * computes `GROUP_COLORS[allocatedCount % 5]` and stores it.
 */
export function allocateGroupColor(db: BazilionDb, groupId: string): number {
  const existing = groupRepo.getTelegramIconColor(db, groupId)
  if (existing !== null) return existing
  const idx = groupRepo.countAllocatedColors(db) % GROUP_COLORS.length
  // GROUP_COLORS has 5 elements; idx is bounded — non-null assert avoids the
  // noUncheckedIndexedAccess complaint.
  const color = GROUP_COLORS[idx]!
  groupRepo.setTelegramIconColor(db, groupId, color)
  return color
}

/**
 * HTTPS form: `https://t.me/c/<chat>/<topic>`. Used in inline `<a href>`
 * links (e.g. `/list`) where the message body needs to render as text
 * even outside Telegram. Works on Telegram desktop / Android / web; iOS
 * client routes it to the chat's topic-list view rather than into the
 * topic itself (a known iOS-only limitation we cannot work around for
 * inline links in private supergroups).
 *
 * The chat short id strips the `-100` supergroup prefix:
 * `-1003964430972` → `3964430972`.
 */
export function topicDeepLink(chatId: number, topicId: number): string {
  const absStr = String(Math.abs(chatId))
  const shortId = absStr.startsWith('100') ? absStr.slice(3) : absStr
  return `https://t.me/c/${shortId}/${topicId}`
}

/**
 * Native scheme form: `tg://privatepost?channel=<short>&post=<topic>&thread=<topic>`.
 * URL-button-only — when an inline-keyboard URL button carries a `tg://`
 * URL, Telegram clients route it through their internal handler rather
 * than the OS link-opener. On iOS this hits a different code path than
 * `https://t.me/...` and reliably navigates INTO the topic.
 *
 * The `thread` parameter is the topic identifier; `post` is the anchor
 * message inside the topic (we point at the topic creation system
 * message, whose id equals the topic id). `channel` is the short chat id
 * without the `-100` prefix — same as the HTTPS form.
 *
 * Don't use this URL outside an inline-keyboard button — Telegram clients
 * are the only thing that knows what to do with `tg://`.
 */
export function topicDeepLinkTg(chatId: number, topicId: number): string {
  const absStr = String(Math.abs(chatId))
  const shortId = absStr.startsWith('100') ? absStr.slice(3) : absStr
  return `tg://privatepost?channel=${shortId}&post=${topicId}&thread=${topicId}`
}

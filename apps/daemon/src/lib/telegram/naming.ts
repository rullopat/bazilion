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
 * Build a deep-link to a specific topic in the configured supergroup.
 *
 * Telegram's `t.me/c/<chat>/<topic>` short-link format requires the
 * "supergroup" portion of the chat id without the `-100` prefix. A chat id of
 * `-1003964430972` becomes `3964430972` in the URL. Channel-style negative
 * ids (`-100…`) are the only form we ever store, so we can strip the prefix
 * with confidence.
 */
export function topicDeepLink(chatId: number, topicId: number): string {
  const absStr = String(Math.abs(chatId))
  const shortId = absStr.startsWith('100') ? absStr.slice(3) : absStr
  return `https://t.me/c/${shortId}/${topicId}`
}

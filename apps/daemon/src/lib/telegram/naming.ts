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

/** Template tokens a group's `telegramTopicNameFormat` may reference. */
export const TOPIC_NAME_TOKENS = ['{agent.name}', '{group.name}', '{group.slug}'] as const

/**
 * Build the forum-topic name for an agent in a group.
 *
 * When the group has an explicit `telegramTopicNameFormat`, it wins: the
 * template is rendered with {agent.name}/{group.name}/{group.slug}. Otherwise
 * the built-in convention applies — the default group uses the bare agent name
 * (single-tenant feel); every other group prefixes the slug + arrow separator
 * so cross-group topics are visually distinguishable when they share a
 * supergroup.
 *
 * Length budget: Telegram caps topic names at 128 characters. In practice
 * slugs and agent names are short. We don't truncate here — let
 * `createForumTopic` / `editForumTopic` reject pathological names.
 */
export function topicNameFor(
  agent: Pick<Agent, 'name'>,
  group: Pick<Group, 'id'> & Partial<Pick<Group, 'name' | 'telegramTopicNameFormat'>>,
): string {
  const fmt = group.telegramTopicNameFormat ?? null
  if (fmt) {
    return renderTopicNameFormat(fmt, {
      agentName: agent.name,
      groupName: group.name ?? group.id,
      groupSlug: group.id,
    })
  }
  if (group.id === DEFAULT_GROUP_ID) return agent.name
  return `${group.id} › ${agent.name}`
}

/** Substitute the supported tokens into a topic-name template. */
export function renderTopicNameFormat(
  fmt: string,
  vals: { agentName: string; groupName: string; groupSlug: string },
): string {
  return fmt
    .replaceAll('{agent.name}', vals.agentName)
    .replaceAll('{group.name}', vals.groupName)
    .replaceAll('{group.slug}', vals.groupSlug)
}

/**
 * Validate a topic-name template before persisting it. Returns an error
 * message string when invalid, or `null` when the template is acceptable.
 * Rules: non-empty, only known {tokens}, and must contain {agent.name} —
 * without it every agent in the group would collide on one topic title.
 */
export function validateTopicNameFormat(fmt: string): string | null {
  if (fmt.trim().length === 0) return 'Format cannot be empty.'
  const used = fmt.match(/\{[^}]*\}/g) ?? []
  for (const token of used) {
    if (!TOPIC_NAME_TOKENS.includes(token as (typeof TOPIC_NAME_TOKENS)[number])) {
      return `Unknown token ${token}. Allowed tokens: ${TOPIC_NAME_TOKENS.join(', ')}.`
    }
  }
  if (!fmt.includes('{agent.name}')) {
    return 'Format must include {agent.name} so each agent gets a distinct topic name.'
  }
  return null
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
 * Build a deep-link to a forum topic in the configured supergroup:
 * `https://t.me/c/<chat>/<topic>`. Strips the `-100` supergroup prefix
 * from the chat id (`-1003964430972` → `3964430972`); channel-style
 * negative ids are the only form we ever store, so the strip is safe.
 *
 * ⚠ **iOS Telegram has a known limitation for private-supergroup topic
 * deep-links.** Tapping these URLs on iOS opens the chat's topic-list
 * view rather than navigating INTO the topic — regardless of whether
 * the link is rendered as inline HTML, an inline-keyboard URL button,
 * or expressed in the native `tg://privatepost?...&thread=...` scheme.
 * Telegram desktop, web, and Android all open the topic correctly.
 *
 * Until Telegram closes the iOS gap there's no workaround beyond
 * navigating manually. The bot still emits the link/button so desktop +
 * Android users have one-tap access; iOS users go through the topic
 * picker.
 */
export function topicDeepLink(chatId: number, topicId: number): string {
  const absStr = String(Math.abs(chatId))
  const shortId = absStr.startsWith('100') ? absStr.slice(3) : absStr
  return `https://t.me/c/${shortId}/${topicId}`
}

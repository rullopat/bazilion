// Topic-name templating + team icon-color allocation.
//
// Names:  default team → bare agent.name;
//         every other team → "<team.id> › <agent.name>".
// Colors: Telegram exposes a 6-value icon-color enum. Red (16478047) is
//         reserved for the ⚙ bazilion service topic. The remaining 5 are
//         dealt out round-robin to bazilion teams in the order each team's
//         first agent first touches Telegram. Past the 5th team, colors
//         repeat — name prefixing is authoritative for disambiguation, color
//         is a visual hint.

import type { Agent, Team } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { teamRepo } from '../../core/index.ts'

/** ⚙ bazilion service topic uses red; teams get the other 5. */
export const SERVICE_TOPIC_COLOR = 16478047

/** Telegram's non-red icon-color enum values, in round-robin order. */
export const TEAM_COLORS: readonly number[] = [
  7322096, // light blue / cyan
  16766590, // orange
  13338331, // purple / lavender
  9367192, // green
  16749490, // pink / rose
]

/** The seeded default team id — bare topic names for its agents. */
export const DEFAULT_TEAM_ID = 'default'

/** Template tokens a team's `telegramTopicNameFormat` may reference. */
export const TOPIC_NAME_TOKENS = ['{agent.name}', '{team.name}', '{team.slug}'] as const

/**
 * Build the forum-topic name for an agent in a team.
 *
 * When the team has an explicit `telegramTopicNameFormat`, it wins: the
 * template is rendered with {agent.name}/{team.name}/{team.slug}. Otherwise
 * the built-in convention applies — the default team uses the bare agent name
 * (single-tenant feel); every other team prefixes the slug + arrow separator
 * so cross-team topics are visually distinguishable when they share a
 * supergroup.
 *
 * Length budget: Telegram caps topic names at 128 characters. In practice
 * slugs and agent names are short. We don't truncate here — let
 * `createForumTopic` / `editForumTopic` reject pathological names.
 */
export function topicNameFor(
  agent: Pick<Agent, 'name'>,
  team: Pick<Team, 'id'> & Partial<Pick<Team, 'name' | 'telegramTopicNameFormat'>>,
): string {
  const fmt = team.telegramTopicNameFormat ?? null
  if (fmt) {
    return renderTopicNameFormat(fmt, {
      agentName: agent.name,
      teamName: team.name ?? team.id,
      teamSlug: team.id,
    })
  }
  if (team.id === DEFAULT_TEAM_ID) return agent.name
  return `${team.id} › ${agent.name}`
}

/** Substitute the supported tokens into a topic-name template. */
export function renderTopicNameFormat(
  fmt: string,
  vals: { agentName: string; teamName: string; teamSlug: string },
): string {
  return fmt
    .replaceAll('{agent.name}', vals.agentName)
    .replaceAll('{team.name}', vals.teamName)
    .replaceAll('{team.slug}', vals.teamSlug)
}

/**
 * Validate a topic-name template before persisting it. Returns an error
 * message string when invalid, or `null` when the template is acceptable.
 * Rules: non-empty, only known {tokens}, and must contain {agent.name} —
 * without it every agent in the team would collide on one topic title.
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
 * Pick (and persist) the icon color for a bazilion team. Idempotent: a
 * second call returns the previously-allocated color. The first call
 * computes `TEAM_COLORS[allocatedCount % 5]` and stores it.
 */
export function allocateGroupColor(db: BazilionDb, teamId: string): number {
  const existing = teamRepo.getTelegramIconColor(db, teamId)
  if (existing !== null) return existing
  const idx = teamRepo.countAllocatedColors(db) % TEAM_COLORS.length
  // TEAM_COLORS has 5 elements; idx is bounded — non-null assert avoids the
  // noUncheckedIndexedAccess complaint.
  const color = TEAM_COLORS[idx]!
  teamRepo.setTelegramIconColor(db, teamId, color)
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

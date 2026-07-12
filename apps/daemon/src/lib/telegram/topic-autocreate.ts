// Idempotent forum-topic auto-create primitive. Given an agent id, ensures
// the agent has a bound topic in the configured supergroup and returns the
// topic id + deep-link. Steps:
//
//   1. If `agents.telegram_topic_id` is already set → return it (no-op).
//   2. Allocate the team's icon color if not yet allocated.
//   3. Compose the topic name via `topicNameFor`.
//   4. Call `bot.api.createForumTopic(chatId, name, { icon_color })`.
//   5. Persist the returned `message_thread_id` to `agents.telegram_topic_id`.
//
// Topic icons: resolved per-agent at creation via emojiForAgent (per-agent
// override → profile-name default → null) + resolveStickerId. Falls back to
// color-only when no emoji applies or the char isn't in Telegram's set.

import type { Agent } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo, profileRepo, teamRepo } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import { notifyDirectoryDirty } from './directory.ts'
import { allocateGroupColor, topicDeepLink, topicNameFor } from './naming.ts'
import { emojiForAgent, resolveStickerId } from './profile-emojis.ts'

/**
 * Subset of grammY's Bot API surface used by topic auto-create. Mirrors the
 * `ActivationApi` pattern from activation.ts — production passes
 * `bot.api`, tests pass a mock.
 */
export interface TopicCreateApi {
  createForumTopic(
    chatId: number,
    name: string,
    opts: { icon_color: number; icon_custom_emoji_id?: string },
  ): Promise<{ message_thread_id: number }>
}

export interface EnsureTopicArgs {
  db: BazilionDb
  paths: Paths
  api: TopicCreateApi
  chatId: number
  agentId: string
}

export type EnsureTopicResult =
  | { kind: 'ok'; topicId: number; deepLink: string; created: boolean; agent: Agent }
  | { kind: 'agent-not-found' }
  | { kind: 'team-not-found' }

/**
 * Idempotent ensure-topic-exists call.
 *
 * `created` distinguishes "we just made this" from "it was already bound" so
 * the caller can phrase its Telegram reply differently ("Created topic for X"
 * vs "Already bound").
 */
export async function ensureAgentTopic(args: EnsureTopicArgs): Promise<EnsureTopicResult> {
  const agent = agentRepo.get(args.db, args.agentId)
  if (!agent) return { kind: 'agent-not-found' }

  const existing = agentRepo.getTelegramTopicId(args.db, agent.id)
  if (existing !== null) {
    return {
      kind: 'ok',
      topicId: existing,
      deepLink: topicDeepLink(args.chatId, existing),
      created: false,
      agent,
    }
  }

  const team = teamRepo.get(args.db, agent.teamId, args.paths)
  if (!team) return { kind: 'team-not-found' }

  const color = allocateGroupColor(args.db, team.id)
  const name = topicNameFor(agent, team)
  const profile = profileRepo.get(args.db, agent.profileId)
  const stickerId = await resolveStickerId(emojiForAgent(agent, profile?.name ?? ''))
  const result = await args.api.createForumTopic(args.chatId, name, {
    icon_color: color,
    ...(stickerId ? { icon_custom_emoji_id: stickerId } : {}),
  })
  agentRepo.setTelegramTopicId(args.db, agent.id, result.message_thread_id)
  notifyDirectoryDirty()

  return {
    kind: 'ok',
    topicId: result.message_thread_id,
    deepLink: topicDeepLink(args.chatId, result.message_thread_id),
    created: true,
    agent,
  }
}

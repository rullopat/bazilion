// Propagate topic-name changes to live Telegram forum topics.
//
// Called when a group's `telegram_topic_name_format` changes: every bound,
// non-locked topic in the group is re-rendered via editForumTopic so existing
// topics pick up the new template immediately (not just newly-created ones).
//
// Best-effort and self-contained:
//   - No-op when the bot isn't running (getTelegramBotApi() === null).
//   - Goes through the per-supergroup outbound queue so renames share the same
//     rate-limit budget as sends + createForumTopic.
//   - Per-topic failures are logged, never thrown — one gone/locked topic must
//     not abort the rest of the batch.

import type { BazilionDb } from '../../core/db/client.ts'
import { groupRepo, profileRepo } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import * as agentRepo from '../../core/repos/agents.ts'
import { getTelegramBotApi } from './bot.ts'
import { topicNameFor } from './naming.ts'
import { enqueueOutbound } from './outbound-queue.ts'
import { emojiForAgent, resolveStickerId } from './profile-emojis.ts'

export async function syncGroupTopicNames(
  db: BazilionDb,
  paths: Paths,
  groupId: string,
): Promise<void> {
  const live = getTelegramBotApi()
  if (!live) return
  const group = groupRepo.get(db, groupId, paths)
  if (!group) return

  const topics = agentRepo.listBoundUnlockedTopicsInGroup(db, groupId)
  for (const t of topics) {
    const name = topicNameFor({ name: t.name }, group)
    await enqueueOutbound(live.chatId, () =>
      live.api.editForumTopic(live.chatId, t.topicId, { name }),
    ).catch((e) => {
      console.warn(
        `telegram: editForumTopic failed for topic ${t.topicId} (agent ${t.agentId}):`,
        e instanceof Error ? e.message : String(e),
      )
    })
  }
}

/**
 * Push an agent's resolved emoji icon to its live forum topic. Called after a
 * per-agent icon change. No-op when the bot isn't running or the agent has no
 * bound topic. Passes `icon_custom_emoji_id: ''` to clear back to color-only.
 */
export async function syncAgentTopicIcon(db: BazilionDb, agentId: string): Promise<void> {
  const live = getTelegramBotApi()
  if (!live) return
  const topicId = agentRepo.getTelegramTopicId(db, agentId)
  if (topicId === null) return
  const agent = agentRepo.get(db, agentId)
  if (!agent) return
  const profile = profileRepo.get(db, agent.profileId)
  const stickerId = await resolveStickerId(emojiForAgent(agent, profile?.name ?? ''))
  await enqueueOutbound(live.chatId, () =>
    live.api.editForumTopic(live.chatId, topicId, { icon_custom_emoji_id: stickerId ?? '' }),
  ).catch((e) => {
    console.warn(
      `telegram: editForumTopic icon update failed for agent ${agentId}:`,
      e instanceof Error ? e.message : String(e),
    )
  })
}

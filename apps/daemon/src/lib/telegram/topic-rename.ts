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
import { groupRepo } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import * as agentRepo from '../../core/repos/agents.ts'
import { getTelegramBotApi } from './bot.ts'
import { topicNameFor } from './naming.ts'
import { enqueueOutbound } from './outbound-queue.ts'

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

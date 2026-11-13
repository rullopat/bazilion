// `/queue`, `/stop` and `/resume`: the follow-up queue of the Agent bound to this topic.

import * as queue from '../../../core/repos/user-queue.ts'
import { stopAgentTurn } from '../../user-queue.ts'
import { clip } from '../markdown.ts'
import { notifyTelegramQueueOutcome } from '../queue-notice.ts'
import type { CommandHandler } from './types.ts'

const NOT_IN_TOPIC = { text: 'Run this inside an Agent topic.' }

/** `/queue` lists waiting messages; `/queue drop <n|all>` removes them. */
export const handleQueue: CommandHandler = async (ctx) => {
  if (!ctx.agent) return NOT_IN_TOPIC
  const agentId = ctx.agent.id
  const { paused, items } = queue.list(ctx.db, agentId)
  const open = items.filter((item) => item.status !== 'failed')
  const [command, target] = ctx.args.trim().split(/\s+/).filter(Boolean)
  if (!command) {
    return {
      text: [
        paused ? 'Queue paused. /resume continues it.' : 'Queue running.',
        ...open.map((item, index) => {
          const text = item.text.replace(/\s+/g, ' ').trim()
          return `${index + 1}. ${item.status} · ${clip(text || '(attachment)', 60)}`
        }),
        open.length ? '/queue drop <n|all> removes waiting messages.' : 'Nothing waiting.',
      ].join('\n'),
    }
  }
  if (command !== 'drop' || !target) return { text: 'Usage: /queue, or /queue drop <n|all>.' }
  const chosen = target === 'all' ? open : [open[Number(target) - 1]]
  let dropped = 0
  for (const item of chosen) {
    if (item?.status !== 'pending') continue
    try {
      const removed = queue.remove(ctx.db, agentId, item.id)
      await notifyTelegramQueueOutcome(removed.item, removed.origin, 'removed')
      dropped++
    } catch {
      // It started meanwhile.
    }
  }
  return {
    text: dropped
      ? `Dropped ${dropped} message${dropped === 1 ? '' : 's'}.`
      : 'Nothing dropped: only waiting messages can be dropped.',
  }
}

/** Cancel the running turn; waiting messages are paused until /resume. */
export const handleStop: CommandHandler = async (ctx) => {
  if (!ctx.agent) return NOT_IN_TOPIC
  const { cancelled, queuePaused } = stopAgentTurn(ctx.db, ctx.agent.id)
  return {
    text: [
      cancelled ? 'Turn cancelled.' : 'No turn is running.',
      ...(queuePaused ? ['Waiting messages are paused. /resume continues them.'] : []),
    ].join(' '),
  }
}

export const handleResume: CommandHandler = async (ctx) => {
  if (!ctx.agent) return NOT_IN_TOPIC
  queue.setPaused(ctx.db, ctx.agent.id, false)
  return { text: 'Queue running.' }
}

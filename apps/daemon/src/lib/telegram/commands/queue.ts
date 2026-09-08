import { agentRepo, mergeSecretsIntoEnv, telegramPairingRepo } from '../../../core/index.ts'
import * as queue from '../../../core/repos/user-queue.ts'
import { cancelAgent } from '../../agent-cancel.ts'
import type { CommandHandler } from './types.ts'

export const handle: CommandHandler = async (ctx) => {
  const agent = ctx.agent && agentRepo.get(ctx.db, ctx.agent.id)
  const config = mergeSecretsIntoEnv(ctx.db, ctx.authToken)
  if (
    !agent ||
    ctx.from.is_bot ||
    telegramPairingRepo.status(ctx.db).ownerUserId !== ctx.from.id ||
    agent.telegramTopicId !== ctx.topicId ||
    Number(config.TELEGRAM_CHAT_ID) !== ctx.chatId ||
    !config.TELEGRAM_BOT_TOKEN
  )
    return { text: 'Queue controls require the paired owner in the current Agent topic.' }
  const [command = 'list', arg, rev, acknowledgement] = ctx.args.trim().split(/\s+/).filter(Boolean)
  try {
    queue.reconcileApprovalHolds(ctx.db)
    if (command === 'list' || command === 'history') {
      const state = queue.list(ctx.db, agent.id, {
        all: command === 'history',
        offset: command === 'history' && arg ? revision(arg) : 0,
      })
      return {
        text: [
          `Queue ${state.control.paused ? 'paused' : 'ready'}; control revision ${state.control.revision}.`,
          ...state.items.map(
            (item) => `${item.id} · ${item.status} · revision ${item.revision} · ${item.source}`,
          ),
          '/queue pause <control-revision> | resume <control-revision> | stop <control-revision>',
          '/queue remove <item-id> <item-revision>',
          'Review uncertain work in web/CLI before acknowledging it.',
        ].join('\n'),
      }
    }
    if (command === 'pause' || command === 'resume' || command === 'stop') {
      const expected = revision(arg)
      const control = queue.setPaused(
        ctx.db,
        agent.id,
        command !== 'resume',
        expected,
        command === 'resume' ? null : 'telegram_operator',
      )
      const cancelled = command === 'stop' && cancelAgent(agent.id)
      return {
        text: `Queue ${control.paused ? 'paused' : 'resumed'}; control revision ${control.revision}.${cancelled ? ' Active turn cancellation requested.' : ''}`,
      }
    }
    if (command === 'remove' && arg) {
      const item = queue.remove(ctx.db, agent.id, arg, revision(rev))
      return { text: `Follow-up ${item.id}: ${item.status}.` }
    }
    if (command === 'reconcile' && arg && acknowledgement === 'acknowledge') {
      const item = queue.get(ctx.db, agent.id, arg)
      if (!item || item.revision !== revision(rev) || item.status !== 'uncertain')
        throw new queue.QueueConflictError('Queue item changed or is not uncertain')
      queue.transition(ctx.db, agent.id, arg, 'uncertain', 'cancelled', {
        diagnostic: 'Telegram owner acknowledged uncertain outcome; no replay',
      })
      return { text: 'Uncertain input closed without replay. The queue remains paused.' }
    }
    return {
      text: 'Run /queue for items and current revisions. Reconciliation requires /queue reconcile <id> <revision> acknowledge after reviewing possible effects.',
    }
  } catch (error) {
    return {
      text:
        error instanceof queue.QueueConflictError
          ? `${error.message}. Run /queue for current state.`
          : 'Invalid queue command. Run /queue for current state and syntax.',
    }
  }
}
function revision(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid revision')
  return Number(value)
}

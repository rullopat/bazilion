// Daemon-side `MessagingHost` implementation backed by the local SQLite handle.
//
// Two consumers:
//   1. In-process callers (compact / context / truncate endpoints) that build
//      a Bazilion session for inspection and want messaging tools enumerated
//      with the same shape the chat path sees.
//   2. The IPC handler that services messaging requests issued by worker
//      subprocesses. Workers no longer hold a SQLite handle of their own —
//      they call `process.send({type: 'rpc', ...})` and the parent dispatches
//      through this host.

import { agentRepo, type BazilionDb, messageRepo } from '../core/index.ts'
import type { MessagingHost } from '../runtime/index.ts'
import { sendAgentMessage } from './communication.ts'

export function createDbMessagingHost(
  db: BazilionDb,
  opts: { causalParentMessageId?: string | null } = {},
): MessagingHost {
  return {
    agentExists(agentId) {
      return agentRepo.get(db, agentId) !== null
    },
    sendMessage(input) {
      // The model may name the recipient by unique name or id prefix, as agentExists allows.
      const to = agentRepo.get(db, input.to)?.id ?? input.to
      const m = sendAgentMessage(db, {
        ...input,
        to,
        causalParentMessageId: opts.causalParentMessageId,
        origin: 'agent_tool',
      })
      return { messageId: m.id }
    },
    listInbox(agentId, opts) {
      return messageRepo.listInbox(db, agentId, { unreadOnly: opts?.unreadOnly === true })
    },
    markRead(messageId) {
      messageRepo.markRead(db, messageId)
    },
    findReplies(agentId, replyTo) {
      return messageRepo.listInbox(db, agentId).filter((message) => message.replyTo === replyTo)
    },
  }
}

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

import {
  agentRepo,
  type BazilionDb,
  communicationApprovalRepo,
  messageRepo,
} from '../core/index.ts'
import type { MessagingHost } from '../runtime/index.ts'
import { deliverableInbox, deliverableReplies, sendAgentMessage } from './communication.ts'

export function createDbMessagingHost(db: BazilionDb): MessagingHost {
  return {
    agentExists(agentId) {
      return agentRepo.get(db, agentId) !== null
    },
    sendMessage(input) {
      const m = sendAgentMessage(db, { ...input, origin: 'agent_tool' })
      return { messageId: m.id }
    },
    listInbox(agentId, opts) {
      return deliverableInbox(db, agentId, opts?.unreadOnly === true)
    },
    markRead(messageId) {
      messageRepo.markRead(db, messageId)
    },
    findReplies(agentId, replyTo) {
      return deliverableReplies(db, agentId, replyTo)
    },
    approvalStatus(agentId, approvalId) {
      const approval = communicationApprovalRepo.get(db, approvalId)
      return approval?.requester === agentId ? approval : null
    },
  }
}

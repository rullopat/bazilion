import type { Paths } from '../core/paths.ts'
import { overlappingWorkspaceRoots, workspaceIdentity } from './coding-environment/workspace.ts'
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
  teamRepo,
} from '../core/index.ts'
import type { MessagingHost } from '../runtime/index.ts'
import { deliverableInbox, deliverableReplies, sendAgentMessage } from './communication.ts'

export function createDbMessagingHost(
  db: BazilionDb,
  opts: {
    causalParentMessageId?: string | null
    workspace?: { root: string; paths: Paths; agentId: string }
  } = {},
): MessagingHost {
  return {
    agentExists(agentId) {
      return agentRepo.get(db, agentId) !== null
    },
    sendMessage(input) {
      const m = sendAgentMessage(db, {
        ...input,
        causalParentMessageId: opts.causalParentMessageId,
        origin: 'agent_tool',
      })
      return { messageId: m.id }
    },
    listInbox(agentId, opts) {
      return deliverableInbox(db, agentId, opts?.unreadOnly === true)
    },
    markRead(messageId) {
      messageRepo.markRead(db, messageId)
    },
    findReplies(agentId, replyTo) {
      const replies = deliverableReplies(db, agentId, replyTo)
      if (!replies.length && opts.workspace?.agentId === agentId) {
        const sent = messageRepo.get(db, replyTo)
        const recipient = sent?.fromAgentId === agentId ? agentRepo.get(db, sent.toAgentId) : null
        const team = recipient ? teamRepo.get(db, recipient.teamId, opts.workspace.paths) : null
        if (
          team &&
          overlappingWorkspaceRoots(
            workspaceIdentity(opts.workspace.root).root,
            workspaceIdentity(team.path).root,
          )
        )
          throw new Error(
            'Shared workspace handoff: end this turn so the teammate can acquire the workspace. Resume from its inbox reply; do not wait_for_reply while holding the workspace.',
          )
      }
      return replies
    },
    approvalStatus(agentId, approvalId) {
      const approval = communicationApprovalRepo.get(db, approvalId)
      return approval?.requester === agentId ? approval : null
    },
  }
}

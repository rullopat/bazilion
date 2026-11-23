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

import { join } from 'node:path'
import { chosenName } from '@bazilion/api-types'
import { agentRepo, type BazilionDb, loadIdentityFromFile, messageRepo } from '../core/index.ts'
import type { MessagingHost } from '../runtime/index.ts'
import { sendAgentMessage } from './communication.ts'

/**
 * The Agent `ref` names for a message from `from`: an id, else a name of the sender's Team (any
 * case), else a name or id prefix unique across Teams.
 */
export function recipientOf(db: BazilionDb, from: string, ref: string): string {
  const wanted = ref.trim()
  const exact = db.raw
    .query<{ id: string }, [string]>('SELECT id FROM agents WHERE id = ?')
    .get(wanted)
  if (exact) return exact.id
  const sender = agentRepo.get(db, from)
  if (sender) {
    // Compared in JavaScript: SQLite's lower() leaves letters outside ASCII as they are.
    const key = wanted.toLowerCase()
    const team = agentRepo.list(db).filter((agent) => agent.teamId === sender.teamId)
    const teammates = team.filter((agent) => agent.name.trim().toLowerCase() === key)
    if (teammates.length === 1 && teammates[0]) return teammates[0].id
    if (teammates.length > 1) {
      throw new Error(`send_message: more than one teammate is named "${wanted}"; use the id`)
    }
    // The name a teammate gave itself ("Sally" for the Sales Director) reaches it too.
    const calling = team.filter(
      (agent) =>
        chosenName({
          name: agent.name,
          identity: loadIdentityFromFile(join(agent.dir, 'IDENTITY.md')),
        })?.toLowerCase() === key,
    )
    if (calling.length === 1 && calling[0]) return calling[0].id
  }
  const found = agentRepo.get(db, wanted)
  if (found) return found.id
  throw new Error(
    `send_message: no Agent "${wanted}". Use an id or an exact name from your teammates list.`,
  )
}

export function createDbMessagingHost(
  db: BazilionDb,
  opts: { causalParentMessageId?: string | null } = {},
): MessagingHost {
  return {
    sendMessage(input) {
      const to = recipientOf(db, input.from, input.to)
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

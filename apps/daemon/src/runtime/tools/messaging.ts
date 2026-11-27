import type { MessagingHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

interface MessagePayload {
  text: string
  [key: string]: unknown
}

function decodeText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as MessagePayload
    if (parsed && typeof parsed.text === 'string') return parsed.text
  } catch {
    // not JSON; return raw payload
  }
  return payload
}

export function messagingTools(host: MessagingHost, fromAgentId: string): ToolHandler[] {
  return [
    {
      def: {
        name: 'send_message',
        description:
          'Send a message to another agent: `to` is its id, or its exact name (your teammates are listed in your instructions). Use this ONLY for things the recipient needs to ACT on: delegating a task, asking a peer for information you cannot get yourself, escalating a decision. Do NOT use it for status updates or to announce changes to team-shared resources — USER.md and the team memory backend both propagate to every agent in the team automatically on their next turn, so messages like "I updated USER.md" or "I wrote a new memory note" are pure noise and will trigger an inbox-wake loop on the recipient.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient Agent id, or its exact name' },
            text: { type: 'string', description: 'Message text' },
            reply_to: {
              type: 'string',
              description: 'Optional: id of the message you are replying to',
            },
            wake: {
              type: 'boolean',
              description:
                'false: deliver it without starting a turn for the recipient; it reads it at its next turn. For something it should know but need not act on now.',
            },
          },
          required: ['to', 'text'],
        },
      },
      async invoke(args) {
        const to = String(args.to ?? '')
        const text = String(args.text ?? '')
        if (!to) throw new Error('send_message: "to" is required')
        if (!text) throw new Error('send_message: "text" is required')
        const replyTo = typeof args.reply_to === 'string' ? args.reply_to : null
        const quiet = args.wake === false
        const { messageId } = await host.sendMessage({
          from: fromAgentId,
          to,
          payload: JSON.stringify(quiet ? { text, wake: false } : { text }),
          replyTo,
        })
        return quiet
          ? `sent message ${messageId}; it waits for the recipient's next turn`
          : `sent message ${messageId}`
      },
    },
    {
      def: {
        name: 'read_inbox',
        description: 'Read messages addressed to you. Marks unread messages as read by default.',
        parameters: {
          type: 'object',
          properties: {
            include_read: {
              type: 'boolean',
              description: 'Also include already-read messages (default false)',
            },
          },
        },
      },
      async invoke(args) {
        const includeRead = args.include_read === true
        const messages = await host.listInbox(fromAgentId, { unreadOnly: !includeRead })
        if (messages.length === 0) return '(no messages)'
        const lines: string[] = []
        for (const m of messages) {
          lines.push(`from ${m.fromAgentId} [${m.id}]: ${decodeText(m.payload)}`)
          if (!m.readAt) await host.markRead(m.id)
        }
        return lines.join('\n')
      },
    },
    {
      def: {
        name: 'wait_for_reply',
        description:
          'Block until the replies to messages you sent arrive, or until the timeout expires. With message_ids, it returns each reply as it comes and ends when all have answered.',
        parameters: {
          type: 'object',
          properties: {
            message_id: {
              type: 'string',
              description: 'id of the message you sent',
            },
            message_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'ids of several messages you sent, to wait for all their replies',
            },
            timeout_ms: {
              type: 'number',
              description: 'max wait in milliseconds (default 30000)',
            },
            poll_ms: {
              type: 'number',
              description: 'poll interval in milliseconds (default 200)',
            },
          },
        },
      },
      async invoke(args) {
        const ids = [
          ...(typeof args.message_id === 'string' && args.message_id ? [args.message_id] : []),
          ...(Array.isArray(args.message_ids) ? args.message_ids.map(String).filter(Boolean) : []),
        ]
        if (ids.length === 0)
          throw new Error('wait_for_reply: "message_id" or "message_ids" is required')
        const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : 30000
        const poll = typeof args.poll_ms === 'number' ? args.poll_ms : 200
        const start = Date.now()
        const answered = new Map<string, string>()
        while (answered.size < ids.length && Date.now() - start < timeout) {
          for (const id of ids) {
            if (answered.has(id)) continue
            const r = (await host.findReplies(fromAgentId, id))[0]
            if (!r) continue
            if (!r.readAt) await host.markRead(r.id)
            answered.set(
              id,
              `reply from ${r.fromAgentId} [${r.id}] to ${id}: ${decodeText(r.payload)}`,
            )
          }
          if (answered.size < ids.length) await new Promise((r) => setTimeout(r, poll))
        }
        const lines = ids.flatMap((id) => answered.get(id) ?? [])
        const missing = ids.filter((id) => !answered.has(id))
        if (ids.length === 1) return lines[0] ?? `no reply within ${timeout}ms`
        if (missing.length > 0) lines.push(`no reply within ${timeout}ms to ${missing.join(', ')}`)
        return lines.join('\n')
      },
    },
  ]
}

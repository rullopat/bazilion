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
          'Send a message to another agent. Use the recipient\'s agent id (UUID). Use this ONLY for things the recipient needs to ACT on: delegating a task, asking a peer for information you cannot get yourself, escalating a decision. Do NOT use it for status updates or to announce changes to group-shared resources — USER.md and the group memory backend both propagate to every agent in the group automatically on their next turn, so messages like "I updated USER.md" or "I wrote a new memory note" are pure noise and will trigger an inbox-wake loop on the recipient.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient agent id' },
            text: { type: 'string', description: 'Message text' },
            reply_to: {
              type: 'string',
              description: 'Optional: id of the message you are replying to',
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
        if (!(await host.agentExists(to))) {
          throw new Error(`send_message: agent not found: ${to}`)
        }
        const replyTo = typeof args.reply_to === 'string' ? args.reply_to : null
        const { messageId } = await host.sendMessage({
          from: fromAgentId,
          to,
          payload: JSON.stringify({ text }),
          replyTo,
        })
        return `sent message ${messageId}`
      },
    },
    {
      def: {
        name: 'approval_status',
        description:
          'Check the current status of a communication approval request that you created.',
        parameters: {
          type: 'object',
          properties: {
            approval_id: {
              type: 'string',
              description: 'Approval request id returned by a protected communication attempt',
            },
          },
          required: ['approval_id'],
        },
      },
      async invoke(args) {
        const approvalId = String(args.approval_id ?? '')
        if (!approvalId) throw new Error('approval_status: "approval_id" is required')
        const approval = await host.approvalStatus(fromAgentId, approvalId)
        if (!approval) throw new Error(`approval_status: approval not found: ${approvalId}`)
        const decision = approval.decidedBy
          ? `; decided by ${approval.decidedBy}${approval.decisionReason ? ` (${approval.decisionReason})` : ''}`
          : ''
        const failure = approval.deliveryError ? `; delivery error: ${approval.deliveryError}` : ''
        return `approval ${approval.id}: ${approval.status}; expires ${approval.expiresAt}${decision}${failure}`
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
          'Block until a reply to a message you sent arrives, or until the timeout expires.',
        parameters: {
          type: 'object',
          properties: {
            message_id: {
              type: 'string',
              description: 'id of the message you sent',
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
          required: ['message_id'],
        },
      },
      async invoke(args) {
        const messageId = String(args.message_id ?? '')
        if (!messageId) throw new Error('wait_for_reply: "message_id" is required')
        const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : 30000
        const poll = typeof args.poll_ms === 'number' ? args.poll_ms : 200
        const start = Date.now()
        while (Date.now() - start < timeout) {
          const replies = await host.findReplies(fromAgentId, messageId)
          if (replies.length > 0) {
            const r = replies[0]
            if (r) {
              if (!r.readAt) await host.markRead(r.id)
              return `reply from ${r.fromAgentId} [${r.id}]: ${decodeText(r.payload)}`
            }
          }
          await new Promise((r) => setTimeout(r, poll))
        }
        return `no reply within ${timeout}ms`
      },
    },
  ]
}

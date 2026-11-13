import type { Message, SendMessageRequest } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional } from '../command-helpers.ts'

export const sendCommand = defineCommand({
  meta: {
    name: 'send',
    description: 'Send a message from one agent to another',
  },
  args: {
    from: positional('Sender agent id or prefix'),
    to: positional('Recipient agent id or prefix'),
    message: positional('Message text'),
    'reply-to': { type: 'string', description: 'Id of the message this one answers' },
  },
  async run({ args }) {
    const body: SendMessageRequest = {
      from: args.from,
      payload: { text: args.message },
      ...(args['reply-to'] ? { replyTo: args['reply-to'] } : {}),
    }
    const result = await createClient().post<Message>(apiPath('agents', args.to, 'messages'), body)
    console.log(`sent message ${result.id}`)
  },
})

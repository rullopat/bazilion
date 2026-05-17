import type { Message, SendMessageRequest } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

export const sendCommand = defineCommand({
  meta: {
    name: 'send',
    description: 'Send a message from one agent to another',
  },
  args: {
    from: { type: 'positional', required: true, description: 'Sender agent id' },
    to: { type: 'positional', required: true, description: 'Recipient agent id' },
    message: { type: 'positional', required: true, description: 'Message text' },
  },
  async run({ args }) {
    const client = createClient()
    const body: SendMessageRequest = {
      from: args.from,
      payload: { text: args.message },
    }
    const msg = await client.post<Message>(`/api/agents/${args.to}/messages`, body)
    console.log(`sent message ${msg.id}`)
  },
})

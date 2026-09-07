import { randomUUID } from 'node:crypto'
import type { AgentQuestionAnswer } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

const positional = { type: 'positional', required: true } as const
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2))
export function questionAnswer(args: {
  choice?: string
  text?: string
  skip?: boolean
}): AgentQuestionAnswer {
  const count =
    Number(args.choice !== undefined) + Number(args.text !== undefined) + Number(args.skip === true)
  if (count !== 1) throw new Error('Specify exactly one of --choice, --text, or --skip')
  if (args.skip) return { kind: 'skip' }
  if (args.text !== undefined) {
    if (!args.text.trim() || Buffer.byteLength(args.text, 'utf8') > 4096)
      throw new Error('Answer text must contain 1–4096 UTF-8 bytes')
    return { kind: 'text', text: args.text }
  }
  if (!/^[1-4]$/.test(args.choice ?? '')) throw new Error('--choice must be a number from 1 to 4')
  return { kind: 'choice', index: Number(args.choice) - 1 }
}
export const questionCommand = defineCommand({
  meta: {
    name: 'question',
    description: 'Inspect and answer an Agent clarification; answers grant no permissions',
  },
  subCommands: {
    list: defineCommand({
      args: { agent: positional, conversation: { type: 'string' } },
      async run({ args }) {
        output(await createClient().questions(args.agent).list(args.conversation))
      },
    }),
    show: defineCommand({
      args: { agent: positional, id: positional },
      async run({ args }) {
        output(await createClient().questions(args.agent).get(args.id))
      },
    }),
    answer: defineCommand({
      args: {
        agent: positional,
        id: positional,
        choice: { type: 'string', description: 'Choice number, starting at 1' },
        text: { type: 'string', description: 'Free-text answer' },
        skip: { type: 'boolean', description: 'Continue without an answer' },
        'request-id': { type: 'string', description: 'Reuse the original UUID for an exact retry' },
        conversation: {
          type: 'string',
          description: 'Original conversation ID; required for retries',
        },
      },
      async run({ args }) {
        const answer = questionAnswer(args)
        if (args['request-id'] && !args.conversation)
          throw new Error('Retry requires the original --conversation and identical answer')
        const client = createClient().questions(args.agent)
        const observed = await client.get(args.id)
        const conversationId = args.conversation ?? observed.conversationId
        if (conversationId !== observed.conversationId)
          throw new Error('Question conversation differs')
        if (answer.kind === 'choice' && answer.index >= observed.question.choices.length)
          throw new Error('That choice does not exist for this question')
        const requestId = args['request-id'] ?? randomUUID()
        console.error(
          `Question request: ${requestId}; exact retry uses --request-id ${requestId} --conversation ${conversationId} and the same answer. Acceptance does not prove consumption or task completion.`,
        )
        output(await client.answer(args.id, { requestId, conversationId, answer }))
      },
    }),
  },
})

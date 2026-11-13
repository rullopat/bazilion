import type { AgentQuestionAnswer } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, jsonFlag, positional, printJson } from '../command-helpers.ts'
import { questionLines } from '../question-prompt.ts'

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
    if (!args.text.trim() || args.text.length > 4096)
      throw new Error('Answer text must be 1–4096 characters')
    return { kind: 'text', text: args.text }
  }
  if (!/^[1-4]$/.test(args.choice ?? '')) throw new Error('--choice must be a number from 1 to 4')
  return { kind: 'choice', index: Number(args.choice) - 1 }
}

export const questionCommand = defineCommand({
  meta: { name: 'question', description: "List and answer an Agent's waiting questions" },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'Questions the Agent is waiting on' },
      args: { agent: agentArg, json: jsonFlag },
      async run({ args }) {
        const { questions } = await createClient().questions(args.agent).list()
        if (args.json) return printJson(questions)
        if (!questions.length) return console.log('(no waiting questions)')
        for (const item of questions) {
          console.log(`${item.id} · expires ${new Date(item.expiresAt).toLocaleTimeString()}`)
          for (const line of questionLines(item)) console.log(`  ${line}`)
        }
      },
    }),
    answer: defineCommand({
      meta: { name: 'answer', description: 'Answer a waiting question' },
      args: {
        agent: agentArg,
        id: positional('Question id'),
        choice: { type: 'string', description: 'Choice number, starting at 1' },
        text: { type: 'string', description: 'Free-text answer' },
        skip: { type: 'boolean', description: 'Continue without an answer' },
      },
      async run({ args }) {
        await createClient().questions(args.agent).answer(args.id, questionAnswer(args))
        console.log(args.skip ? 'Skipped.' : 'Answered.')
      },
    }),
  },
})

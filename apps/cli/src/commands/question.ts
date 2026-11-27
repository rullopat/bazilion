import type { AgentQuestionAnswer, AgentQuestionItemAnswer } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, jsonFlag, positional, printJson } from '../command-helpers.ts'
import { questionLines } from '../question-prompt.ts'
import { collectFlagValues } from '../repeatable-args.ts'

/** One `--answer`: a number, several (`1,3`), `skip`, or the answer in words. */
export function itemAnswer(value: string): AgentQuestionItemAnswer {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === 'skip') return { kind: 'skip' }
  const numbers = trimmed.split(/[\s,]+/).filter(Boolean)
  if (numbers.length > 0 && numbers.every((n) => /^\d+$/.test(n) && Number(n) >= 1)) {
    const indexes = numbers.map((n) => Number(n) - 1)
    return indexes.length === 1
      ? { kind: 'choice', index: indexes[0] as number }
      : { kind: 'choices', indexes }
  }
  if (!trimmed || value.length > 4096) throw new Error('An answer must be 1–4096 characters')
  return { kind: 'text', text: value }
}

export function questionAnswer(args: {
  choice?: string
  text?: string
  skip?: boolean
  answers?: string[]
  done?: boolean
  cannot?: boolean
  decline?: boolean
  note?: string
}): AgentQuestionAnswer {
  const answers = args.answers ?? []
  const given = [
    args.choice !== undefined,
    args.text !== undefined,
    args.skip === true,
    answers.length > 0,
    args.done === true,
    args.cannot === true,
    args.decline === true,
  ].filter(Boolean).length
  if (given !== 1)
    throw new Error(
      'Specify exactly one of --choice, --text, --answer (per question), --skip, --done, --cannot or --decline',
    )
  const note = args.note !== undefined ? { note: args.note } : {}
  if (args.decline) return { kind: 'decline', ...note }
  if (args.done) return { kind: 'done', ...note }
  if (args.cannot) return { kind: 'cannot', ...note }
  if (args.skip) return { kind: 'skip' }
  if (answers.length > 0) return { kind: 'answers', answers: answers.map(itemAnswer) }
  if (args.text !== undefined) {
    if (!args.text.trim() || args.text.length > 4096)
      throw new Error('Answer text must be 1–4096 characters')
    return { kind: 'answers', answers: [{ kind: 'text', text: args.text }] }
  }
  if (!/^\d+$/.test(args.choice ?? '') || Number(args.choice) < 1)
    throw new Error('--choice must be a choice number, starting at 1')
  return { kind: 'answers', answers: [{ kind: 'choice', index: Number(args.choice) - 1 }] }
}

export const questionCommand = defineCommand({
  meta: { name: 'question', description: "List and answer an Agent's waiting questions" },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'Questions and actions the Agent is waiting on' },
      args: { agent: agentArg, json: jsonFlag },
      async run({ args }) {
        const { questions } = await createClient().questions(args.agent).list()
        if (args.json) return printJson(questions)
        if (!questions.length) return console.log('(no waiting questions)')
        for (const item of questions) {
          console.log(
            item.question.secret
              ? `${item.id} · a secret request: bazilion agent secret set ${args.agent} ${item.question.secret.name}`
              : item.expiresAt === null
                ? `${item.id} · an action, waiting until you answer it`
                : `${item.id} · expires ${new Date(item.expiresAt).toLocaleTimeString()}`,
          )
          for (const line of questionLines(item)) console.log(`  ${line}`)
        }
      },
    }),
    answer: defineCommand({
      meta: { name: 'answer', description: 'Answer a waiting question card or action' },
      args: {
        agent: agentArg,
        id: positional('Question id'),
        choice: {
          type: 'string',
          description: 'A card of one question: the choice number, from 1',
        },
        text: { type: 'string', description: 'A card of one question: the answer in words' },
        answer: {
          type: 'string',
          description:
            'One per question, in order: a number, several (1,3), skip, or words (repeatable)',
        },
        skip: { type: 'boolean', description: 'Skip the whole card' },
        done: { type: 'boolean', description: 'An action: it is done' },
        cannot: { type: 'boolean', description: 'An action: you cannot do it' },
        decline: {
          type: 'boolean',
          description: 'A secret request: do not give it (store one with agent secret set)',
        },
        note: {
          type: 'string',
          description: 'With --done, --cannot or --decline: a note for the Agent',
        },
      },
      async run({ args, rawArgs }) {
        const answer = questionAnswer({
          ...(args.choice !== undefined ? { choice: args.choice } : {}),
          ...(args.text !== undefined ? { text: args.text } : {}),
          ...(args.skip ? { skip: true } : {}),
          ...(args.done ? { done: true } : {}),
          ...(args.cannot ? { cannot: true } : {}),
          ...(args.decline ? { decline: true } : {}),
          ...(args.note !== undefined ? { note: args.note } : {}),
          answers: collectFlagValues(rawArgs, 'answer'),
        })
        await createClient().questions(args.agent).answer(args.id, answer)
        console.log(
          answer.kind === 'skip'
            ? 'Skipped.'
            : answer.kind === 'done'
              ? 'Done: the Agent goes on from here.'
              : answer.kind === 'cannot'
                ? 'Told the Agent you cannot.'
                : answer.kind === 'decline'
                  ? 'Told the Agent you declined.'
                  : 'Answered.',
        )
      },
    }),
  },
})

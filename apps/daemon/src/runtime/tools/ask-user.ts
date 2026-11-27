import type { AgentQuestionInput, AgentQuestionToolResult } from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

export type AskUser = (question: AgentQuestionInput) => Promise<AgentQuestionToolResult>

const CHOICES = {
  type: 'array',
  minItems: 2,
  maxItems: 4,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['label'],
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
}

export function askUserTool(ask: AskUser): ToolHandler {
  return {
    def: {
      name: 'ask_user',
      description: [
        'Ask the user, in one of two ways.',
        '- questions: one or more clarification questions, shown in one card and answered together. Each has 2 to 4 choices (multiple: true lets them pick several), and the user may answer in their own words or skip. It waits up to five minutes; with no answer, continue without inventing one.',
        "- action: something only the user can do (sign in to a site in the browser, confirm in their bank's app, plug something in), with why, what to do and an optional link. It does not wait: end your turn after asking, saying what you are waiting for. Their Done or Can't starts your next turn in this conversation.",
        'An answer is information only: it never grants shell or communication permission. Never ask for credentials.',
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['prompt', 'choices'],
              properties: {
                prompt: { type: 'string', minLength: 1, maxLength: 2000 },
                choices: CHOICES,
                recommendedIndex: { type: 'integer', minimum: 0, maximum: 3 },
                multiple: { type: 'boolean', description: 'The user may pick several choices.' },
              },
            },
          },
          action: {
            type: 'object',
            additionalProperties: false,
            required: ['reason', 'instructions'],
            properties: {
              reason: {
                type: 'string',
                minLength: 1,
                maxLength: 2000,
                description: 'Why, in a line.',
              },
              instructions: { type: 'string', minLength: 1, maxLength: 2000 },
              url: { type: 'string', description: 'The page to do it on, if there is one.' },
            },
          },
        },
      },
    },
    async invoke(args) {
      const result = await ask(args as unknown as AgentQuestionInput)
      if (result.kind === 'action_asked') {
        return `Asked the user to do it: ${result.question.action?.reason ?? ''}\nEnd your turn now with a short line on what you are waiting for. Their Done or Can't starts your next turn in this conversation.`
      }
      return JSON.stringify(result)
    },
  }
}

import type { AgentQuestionInput, AgentQuestionToolResult } from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

export type AskUser = (question: AgentQuestionInput) => Promise<AgentQuestionToolResult>
export function askUserTool(ask: AskUser): ToolHandler {
  return {
    def: {
      name: 'ask_user',
      description:
        'Ask the operator one clarification question and wait up to five minutes for a choice, a free-text answer or Skip. The answer is information only: it never grants shell or communication permission. Do not ask for credentials. When no answer comes back, continue without inventing one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'choices'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 2000 },
          choices: {
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
          },
          recommendedIndex: { type: 'integer', minimum: 0, maximum: 3 },
        },
      },
    },
    async invoke(args) {
      return JSON.stringify(await ask(args as unknown as AgentQuestionInput))
    },
  }
}

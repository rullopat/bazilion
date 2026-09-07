import type { AgentQuestionInput, AgentQuestionToolResult } from '@bazilion/api-types'
import type { ToolHandler } from './types.ts'

export type AskUser = (
  toolCallId: string,
  question: AgentQuestionInput,
) => Promise<AgentQuestionToolResult>
export function askUserTool(ask: AskUser): ToolHandler {
  return {
    def: {
      name: 'ask_user',
      description:
        'Ask the operator one clarification question and wait for an explicit choice, free-text answer, Skip, or a typed no-answer outcome. An answer is information only: it never grants shell or communication permission. Do not ask for credentials. Do not invent a response when no answer is returned.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'choices'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 4096 },
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
    async invoke(args, context) {
      if (!context?.toolCallId) throw new Error('Question requires its actual tool call identity')
      const { receipt, ...result } = await ask(
        context.toolCallId,
        args as unknown as AgentQuestionInput,
      )
      const text = JSON.stringify(result)
      return receipt ? { content: [{ type: 'text', text }], questionReceipt: receipt } : text
    },
  }
}

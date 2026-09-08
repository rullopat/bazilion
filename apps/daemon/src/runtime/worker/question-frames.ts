import type { ChatFrame } from '@bazilion/api-types'

/** Worker stdout cannot create daemon-owned cards or release question payloads. */
export function sanitizeQuestionWorkerFrame(frame: ChatFrame): ChatFrame {
  if (frame.kind === 'done')
    return {
      ...frame,
      messages: frame.messages.map((message) => {
        if (message.role === 'tool' && message.toolName === 'ask_user')
          return {
            role: 'tool',
            toolName: 'ask_user',
            toolCallId: message.toolCallId,
            content: 'Question outcome is available through authorized conversation history.',
          }
        if (message.role === 'assistant' && message.toolCalls)
          return {
            ...message,
            toolCalls: message.toolCalls.map((call) =>
              call.name === 'ask_user' ? { ...call, arguments: '{}' } : call,
            ),
          }
        return message
      }),
    }
  if (frame.kind !== 'event') return frame
  const event = frame.event
  if (event.type === 'agent_question')
    return { kind: 'fatal', error: 'Worker cannot emit daemon-owned question cards' }
  if (event.type === 'tool_call' && event.name === 'ask_user')
    return {
      kind: 'event',
      event: { type: 'tool_call', id: event.id, name: 'ask_user', arguments: '{}' },
    }
  if ((event.type === 'tool_result' || event.type === 'tool_error') && event.name === 'ask_user')
    return {
      kind: 'event',
      event: {
        type: 'tool_result',
        id: event.id,
        name: 'ask_user',
        result:
          'Question outcome is available through the question card or authorized conversation history.',
      },
    }
  return frame
}

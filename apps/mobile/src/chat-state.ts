import type {
  ChatFrame,
  CommandApproval,
  CommunicationPendingResponse,
  ProviderMessage,
  SessionEvent,
  ToolResultImage,
} from '@bazilion/api-types'

export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | {
      id: string
      kind: 'tool'
      name: string
      arguments?: string
      result?: string
      error?: string
      images?: ToolResultImage[]
    }
  | { id: string; kind: 'file'; name: string; mimeType: string; data: string }
  | { id: string; kind: 'approval'; approval: CommandApproval }
  | { id: string; kind: 'notice'; tone: 'info' | 'error'; text: string }

export interface ChatState {
  items: ChatItem[]
  /** The assistant item currently receiving delta chunks for this model pass. */
  assistantDraftId: string | null
  terminal: 'idle' | 'streaming' | 'done' | 'fatal'
}

export type ChatItemId = () => string

let itemSequence = 0
export const nextChatItemId: ChatItemId = () => `mobile-chat-${++itemSequence}`

/** Runtime validation for the chat endpoint's non-streaming 202 response. */
export function parseCommunicationPending(value: unknown): CommunicationPendingResponse {
  if (!value || typeof value !== 'object') throw new Error('invalid approval response')
  const pending = value as Record<string, unknown>
  if (
    pending.decision !== 'approval_required' ||
    typeof pending.approvalId !== 'string' ||
    pending.status !== 'pending' ||
    typeof pending.expiresAt !== 'number' ||
    typeof pending.attemptKind !== 'string' ||
    typeof pending.attemptId !== 'string'
  ) {
    throw new Error('invalid approval response')
  }
  return pending as unknown as CommunicationPendingResponse
}

/** Project the daemon's persisted provider transcript into mobile display rows. */
export function historyToChatItems(
  messages: ProviderMessage[],
  nextId: ChatItemId = nextChatItemId,
): ChatItem[] {
  const items: ChatItem[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      items.push({ id: nextId(), kind: 'user', text: message.content })
      continue
    }
    if (message.role === 'assistant') {
      if (message.content) {
        items.push({ id: nextId(), kind: 'assistant', text: message.content })
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          id: call.id,
          kind: 'tool',
          name: call.name,
          arguments: call.arguments,
        })
      }
      continue
    }
    if (message.role !== 'tool') continue

    const index = items.findIndex(
      (item) => item.kind === 'tool' && item.id === message.toolCallId,
    )
    const result = {
      result: message.content,
      ...(message.images?.length ? { images: message.images } : {}),
    }
    if (index === -1) {
      items.push({
        id: message.toolCallId ?? nextId(),
        kind: 'tool',
        name: message.toolName ?? 'tool',
        ...result,
      })
      continue
    }
    const existing = items[index]
    if (existing?.kind === 'tool') items[index] = { ...existing, ...result }
  }
  return items
}

export function chatStateFromHistory(
  messages: ProviderMessage[],
  nextId: ChatItemId = nextChatItemId,
): ChatState {
  return {
    items: historyToChatItems(messages, nextId),
    assistantDraftId: null,
    terminal: 'idle',
  }
}

export function appendLocalUser(
  state: ChatState,
  text: string,
  nextId: ChatItemId = nextChatItemId,
): ChatState {
  return {
    items: [...state.items, { id: nextId(), kind: 'user', text }],
    assistantDraftId: null,
    terminal: 'streaming',
  }
}

export function appendChatNotice(
  state: ChatState,
  tone: 'info' | 'error',
  text: string,
  nextId: ChatItemId = nextChatItemId,
): ChatState {
  return {
    ...state,
    items: [...state.items, { id: nextId(), kind: 'notice', tone, text }],
  }
}

export function updateCommandApproval(
  state: ChatState,
  approval: CommandApproval,
): ChatState {
  const index = state.items.findIndex(
    (item) => item.kind === 'approval' && item.approval.id === approval.id,
  )
  if (index === -1) {
    return {
      ...state,
      items: [...state.items, { id: approval.id, kind: 'approval', approval }],
    }
  }
  const items = [...state.items]
  items[index] = { id: approval.id, kind: 'approval', approval }
  return { ...state, items }
}

function applySessionEvent(
  state: ChatState,
  event: SessionEvent,
  nextId: ChatItemId,
): ChatState {
  if (event.type === 'user_message') return state

  if (event.type === 'assistant_delta') {
    if (state.assistantDraftId) {
      const index = state.items.findIndex((item) => item.id === state.assistantDraftId)
      const existing = state.items[index]
      if (index !== -1 && existing?.kind === 'assistant') {
        const items = [...state.items]
        items[index] = { ...existing, text: existing.text + event.delta }
        return { ...state, items }
      }
    }
    const id = nextId()
    return {
      ...state,
      items: [...state.items, { id, kind: 'assistant', text: event.delta }],
      assistantDraftId: id,
    }
  }

  if (event.type === 'assistant_message') {
    if (state.assistantDraftId) {
      const index = state.items.findIndex((item) => item.id === state.assistantDraftId)
      const existing = state.items[index]
      if (index !== -1 && existing?.kind === 'assistant') {
        const items = [...state.items]
        // message_end is authoritative. Replace the accumulated deltas instead
        // of appending a second assistant bubble.
        items[index] = { ...existing, text: event.text }
        return { ...state, items, assistantDraftId: null }
      }
    }
    return {
      ...state,
      items: [...state.items, { id: nextId(), kind: 'assistant', text: event.text }],
      assistantDraftId: null,
    }
  }

  if (event.type === 'tool_call') {
    return {
      ...state,
      items: [
        ...state.items,
        {
          id: event.id,
          kind: 'tool',
          name: event.name,
          arguments: event.arguments,
        },
      ],
      assistantDraftId: null,
    }
  }

  if (event.type === 'tool_result' || event.type === 'tool_error') {
    const index = state.items.findIndex((item) => item.kind === 'tool' && item.id === event.id)
    const existing = state.items[index]
    const update =
      event.type === 'tool_result'
        ? {
            result: event.result,
            ...(event.images?.length ? { images: event.images } : {}),
          }
        : { error: event.error }
    if (index === -1 || existing?.kind !== 'tool') {
      return {
        ...state,
        items: [
          ...state.items,
          { id: event.id, kind: 'tool', name: event.name, ...update },
        ],
        assistantDraftId: null,
      }
    }
    const items = [...state.items]
    items[index] = { ...existing, ...update }
    return { ...state, items, assistantDraftId: null }
  }

  if (event.type === 'file') {
    return {
      ...state,
      items: [
        ...state.items,
        {
          id: nextId(),
          kind: 'file',
          name: event.name,
          mimeType: event.mimeType,
          data: event.data,
        },
      ],
      assistantDraftId: null,
    }
  }

  if (event.type === 'command_approval') {
    return updateCommandApproval({ ...state, assistantDraftId: null }, event.approval)
  }

  return appendChatNotice(
    { ...state, assistantDraftId: null },
    'error',
    event.error,
    nextId,
  )
}

/** Apply one NDJSON frame without closing over stale React state. */
export function applyChatFrame(
  state: ChatState,
  frame: ChatFrame,
  nextId: ChatItemId = nextChatItemId,
): ChatState {
  if (frame.kind === 'event') return applySessionEvent(state, frame.event, nextId)

  if (frame.kind === 'fatal') {
    return {
      ...appendChatNotice(state, 'error', frame.error, nextId),
      assistantDraftId: null,
      terminal: 'fatal',
    }
  }

  // Files and ephemeral shell decisions are not part of ProviderMessage[];
  // retain those cards while reconciling all persisted messages from the
  // authoritative done frame.
  const transient = state.items.filter(
    (item) => item.kind === 'file' || item.kind === 'approval' || item.kind === 'notice',
  )
  return {
    items: [...historyToChatItems(frame.messages, nextId), ...transient],
    assistantDraftId: null,
    terminal: 'done',
  }
}

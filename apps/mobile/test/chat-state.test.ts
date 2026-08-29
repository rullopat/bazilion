import type { ChatFrame, CommandApproval, ProviderMessage } from '@bazilion/api-types'
import { describe, expect, it } from 'vitest'
import {
  appendLocalUser,
  applyChatFrame,
  chatStateFromHistory,
  historyToChatItems,
  parseCommunicationPending,
} from '../src/chat-state.ts'
import { NdjsonDecoder } from '../src/ndjson.ts'
import { mobileErrorMessage } from '../src/errors.ts'

function ids(): () => string {
  let id = 0
  return () => `test-${++id}`
}

describe('mobile chat state', () => {
  it('retains the optimistic user message when the first stream frame arrives', () => {
    const nextId = ids()
    let state = appendLocalUser(chatStateFromHistory([], nextId), 'hello', nextId)
    state = applyChatFrame(
      state,
      { kind: 'event', event: { type: 'assistant_delta', delta: 'Hi' } },
      nextId,
    )

    expect(state.items).toMatchObject([
      { kind: 'user', text: 'hello' },
      { kind: 'assistant', text: 'Hi' },
    ])
  })

  it('replaces accumulated deltas with the authoritative final assistant message', () => {
    const nextId = ids()
    let state = appendLocalUser(chatStateFromHistory([], nextId), 'hello', nextId)
    for (const frame of [
      { kind: 'event', event: { type: 'assistant_delta', delta: 'Hel' } },
      { kind: 'event', event: { type: 'assistant_delta', delta: 'lo' } },
      { kind: 'event', event: { type: 'assistant_message', text: 'Hello!' } },
    ] satisfies ChatFrame[]) {
      state = applyChatFrame(state, frame, nextId)
    }

    expect(state.items.filter((item) => item.kind === 'assistant')).toMatchObject([
      { text: 'Hello!' },
    ])
  })

  it('uses done messages as the persisted transcript without duplicating the turn', () => {
    const nextId = ids()
    let state = appendLocalUser(chatStateFromHistory([], nextId), 'hello', nextId)
    state = applyChatFrame(
      state,
      { kind: 'event', event: { type: 'assistant_delta', delta: 'Hi' } },
      nextId,
    )
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    state = applyChatFrame(state, { kind: 'done', messages }, nextId)

    expect(state.terminal).toBe('done')
    expect(state.items.map((item) => item.kind)).toEqual(['user', 'assistant'])
  })

  it('retains transient deliverables and approvals across the done reconciliation', () => {
    const nextId = ids()
    const approval: CommandApproval = {
      id: 'approval-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      agentId: 'agent-1',
      teamId: 'team-1',
      command: 'ls',
      risks: [],
      status: 'pending',
      expiresAt: Date.now() + 1000,
    }
    let state = chatStateFromHistory([], nextId)
    state = applyChatFrame(
      state,
      {
        kind: 'event',
        event: { type: 'file', name: 'report.txt', mimeType: 'text/plain', data: 'eA==' },
      },
      nextId,
    )
    state = applyChatFrame(
      state,
      { kind: 'event', event: { type: 'command_approval', approval } },
      nextId,
    )
    state = applyChatFrame(state, { kind: 'done', messages: [] }, nextId)

    expect(state.items.map((item) => item.kind)).toEqual(['file', 'approval'])
  })

  it('marks fatal frames and keeps the preceding conversation visible', () => {
    const nextId = ids()
    const start = appendLocalUser(chatStateFromHistory([], nextId), 'hello', nextId)
    const state = applyChatFrame(start, { kind: 'fatal', error: 'provider unavailable' }, nextId)

    expect(state.terminal).toBe('fatal')
    expect(state.items).toMatchObject([
      { kind: 'user', text: 'hello' },
      { kind: 'notice', tone: 'error', text: 'provider unavailable' },
    ])
  })

  it('projects tool results even when a call row is missing', () => {
    const items = historyToChatItems(
      [
        {
          role: 'tool',
          content: 'done',
          toolCallId: 'tool-1',
          toolName: 'read',
          images: [{ data: 'eA==', mimeType: 'image/png' }],
        },
      ],
      ids(),
    )
    expect(items).toMatchObject([
      {
        id: 'tool-1',
        kind: 'tool',
        name: 'read',
        result: 'done',
        images: [{ mimeType: 'image/png' }],
      },
    ])
  })
})

describe('NDJSON decoder', () => {
  it('parses frames split across arbitrary network chunks', () => {
    const decoder = new NdjsonDecoder<ChatFrame>()
    expect(decoder.push('{"kind":"event","event":{"type":"assistant_delta",')).toEqual([])
    const frames = decoder.push('"delta":"hello"}}\n{"kind":"done",')
    expect(frames).toHaveLength(1)
    expect(decoder.finish('"messages":[]}')).toEqual([{ kind: 'done', messages: [] }])
  })
})

describe('accepted chat approval response', () => {
  it('accepts the 202 payload separately from NDJSON frames', () => {
    expect(
      parseCommunicationPending({
        code: 'communication_pending',
        decision: 'approval_required',
        approvalId: 'approval-1',
        status: 'pending',
        expiresAt: 123,
        attemptKind: 'http_chat_ingress',
        attemptId: 'attempt-1',
      }),
    ).toMatchObject({ approvalId: 'approval-1', status: 'pending' })
  })

  it('rejects an arbitrary successful JSON body as an approval', () => {
    expect(() => parseCommunicationPending({ ok: true })).toThrow('invalid approval response')
  })
})

describe('mobile connection errors', () => {
  it('turns native fetch failures into a private-gateway recovery hint', () => {
    expect(
      mobileErrorMessage(new TypeError('Network request failed'), 'https://bazilion.test'),
    ).toBe(
      'Can’t reach https://bazilion.test. Check that Tailscale is connected and ' +
        'the private HTTPS gateway is running.',
    )
  })

  it('preserves a useful API error message', () => {
    expect(mobileErrorMessage(new Error('agent not found'), 'https://bazilion.test')).toBe(
      'agent not found',
    )
  })
})

// "Bot saw it" reactions — the 👀 indicator on inbound user messages that
// clears once the agent's reply lands.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import {
  _pendingCountForTest,
  _resetReactionsForTest,
  clearReactionsFor,
  installReactionsDepsResolver,
  type ReactionsApi,
  reactSeen,
} from '../../src/lib/telegram/reactions.ts'

const CHAT_ID = -1003964430972

function makeApi(): {
  api: ReactionsApi
  calls: { chatId: number; messageId: number; reaction: unknown }[]
} {
  const calls: { chatId: number; messageId: number; reaction: unknown }[] = []
  const api: ReactionsApi = {
    async setMessageReaction(chatId, messageId, reaction) {
      calls.push({ chatId, messageId, reaction })
      return true
    },
  }
  return { api, calls }
}

beforeEach(() => {
  _resetReactionsForTest()
  _resetOutboundQueueForTest()
})
afterEach(() => {
  _resetReactionsForTest()
  _resetOutboundQueueForTest()
})

describe('reactSeen / clearReactionsFor', () => {
  test('no-op when no deps resolver is installed', () => {
    reactSeen('a1', CHAT_ID, 100)
    expect(_pendingCountForTest('a1')).toBe(0)
  })

  test('react adds a pending entry; clear removes it', async () => {
    const { api, calls } = makeApi()
    installReactionsDepsResolver(() => ({ api, chatId: CHAT_ID }))

    reactSeen('a1', CHAT_ID, 100)
    expect(_pendingCountForTest('a1')).toBe(1)

    // Outbound queue is async — give it a microtask to drain the eyes call.
    await new Promise((r) => setTimeout(r, 5))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.messageId).toBe(100)
    expect(calls[0]?.reaction).toEqual([{ type: 'emoji', emoji: '👀' }])

    clearReactionsFor('a1')
    expect(_pendingCountForTest('a1')).toBe(0)

    await new Promise((r) => setTimeout(r, 5))
    // The clear call ships an empty reaction array.
    expect(calls).toHaveLength(2)
    expect(calls[1]?.messageId).toBe(100)
    expect(calls[1]?.reaction).toEqual([])
  })

  test('multiple inbounds stack 👀s; clear drains them all', async () => {
    const { api, calls } = makeApi()
    installReactionsDepsResolver(() => ({ api, chatId: CHAT_ID }))

    reactSeen('a1', CHAT_ID, 100)
    reactSeen('a1', CHAT_ID, 101)
    reactSeen('a1', CHAT_ID, 102)
    expect(_pendingCountForTest('a1')).toBe(3)

    clearReactionsFor('a1')
    expect(_pendingCountForTest('a1')).toBe(0)

    await new Promise((r) => setTimeout(r, 20))
    // 3 react calls + 3 clear calls.
    const reactCalls = calls.filter(
      (c) => Array.isArray(c.reaction) && (c.reaction as unknown[]).length > 0,
    )
    const clearCalls = calls.filter(
      (c) => Array.isArray(c.reaction) && (c.reaction as unknown[]).length === 0,
    )
    expect(reactCalls.length).toBe(3)
    expect(clearCalls.length).toBe(3)
    // All three of the original message ids are in the clear set.
    expect(clearCalls.map((c) => c.messageId).sort()).toEqual([100, 101, 102])
  })

  test('different agents track reactions independently', () => {
    const { api } = makeApi()
    installReactionsDepsResolver(() => ({ api, chatId: CHAT_ID }))

    reactSeen('a1', CHAT_ID, 100)
    reactSeen('a2', CHAT_ID, 200)
    expect(_pendingCountForTest('a1')).toBe(1)
    expect(_pendingCountForTest('a2')).toBe(1)

    clearReactionsFor('a1')
    expect(_pendingCountForTest('a1')).toBe(0)
    expect(_pendingCountForTest('a2')).toBe(1) // unaffected
  })

  test('clearReactionsFor is a no-op when no pending exist', () => {
    const { api } = makeApi()
    installReactionsDepsResolver(() => ({ api, chatId: CHAT_ID }))
    // Heartbeat-triggered turn — no inbound to react to.
    clearReactionsFor('a1')
    expect(_pendingCountForTest('a1')).toBe(0)
  })
})

import type { Message } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { messageText, pairKey, trafficByPair } from '../src/lib/messages.ts'

const message = (from: string, to: string, at: number): Message => ({
  id: `${from}-${to}-${at}`,
  fromAgentId: from,
  toAgentId: to,
  replyTo: null,
  causalChainId: 'chain',
  causalHop: 0,
  payload: '{"text":"hi"}',
  createdAt: at,
  readAt: null,
})

test('a message shows its text, whatever its payload looks like', () => {
  expect(messageText('{"text":"hello"}')).toBe('hello')
  expect(messageText('plain words')).toBe('plain words')
  expect(messageText('{"other":1}')).toBe('{"other":1}')
})

test('messages are counted per pair of Agents, each way', () => {
  const traffic = trafficByPair([message('a', 'b', 1), message('a', 'b', 5), message('b', 'a', 3)])
  expect(pairKey('b', 'a')).toBe('a|b')
  expect(traffic.get('a|b')).toEqual({ forward: 2, back: 1, lastAt: 5 })
  expect(traffic.size).toBe(1)
})

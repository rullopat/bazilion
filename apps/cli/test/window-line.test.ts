import { expect, test } from 'vitest'
import { windowLine } from '../src/commands/agent-context.ts'

test("chat-context says how full the model's window is, as the conversation bar does", () => {
  expect(windowLine({ tokens: 41_200, window: 272_000 })).toBe(
    '41,200 of 272,000 tokens used (15%); older messages are summarized near the end',
  )
  expect(windowLine({ tokens: null, window: 272_000 })).toBe(
    "272,000 tokens; this conversation's size shows after the next reply",
  )
  expect(windowLine({ tokens: 900, window: null })).toBe(
    '900 tokens used; older messages are summarized near the end',
  )
})

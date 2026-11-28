import { expect, test } from 'vitest'
import { isToolCallId } from '../../src/core/tool-call-id.ts'

test.each([
  'call-1',
  'call_fixture|fc_fixture',
  'call:a.b_1|fc-x',
  'a'.repeat(256),
  `${'a'.repeat(254)}|b`,
  // A call a codemode script made, and one a call inside it made (BAZ-100).
  'tool:1795823160202:5034snauu4o/1',
  'call_fixture|fc_fixture/2/3',
])('accepts bounded canonical tool identity %s', (value) => {
  expect(isToolCallId(value)).toBe(true)
})

test.each([
  undefined,
  null,
  1,
  {},
  '',
  '|',
  '|item',
  'call|',
  'call||item',
  'call|item|extra',
  'call/item',
  'call/',
  'call/1/',
  '/1',
  'call/1|item',
  'call\\item',
  'call item',
  'call\nitem',
  'call|item\n',
  'é',
  'a'.repeat(257),
  `${'a'.repeat(255)}|b`,
])('refuses malformed or oversized tool identity %j', (value) => {
  expect(isToolCallId(value)).toBe(false)
})

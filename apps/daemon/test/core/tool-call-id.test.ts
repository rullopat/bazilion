import { expect, test } from 'vitest'
import { isToolCallId } from '../../src/core/tool-call-id.ts'

test.each([
  'call-1',
  'call_fixture|fc_fixture',
  'call:a.b_1|fc-x',
  'a'.repeat(256),
  `${'a'.repeat(254)}|b`,
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

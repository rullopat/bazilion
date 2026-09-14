import { expect, test } from 'vitest'
import { codingLogReference } from '../../src/lib/coding-environment/receipt-reference.ts'

const receipt = {
  id: 'command-1',
  teamId: 'team-1',
  agentId: 'agent-1',
  diagnostic: 'PRIVATE_SENTINEL',
}

test('lifts the opaque pointer from a raw coding_command receipt', () => {
  expect(codingLogReference(JSON.stringify(receipt))).toEqual({
    commandId: 'command-1',
    teamId: 'team-1',
  })
})

test('reads the same pointer through pi content blocks and the coding_receipt wrapper', () => {
  expect(codingLogReference([{ type: 'text', text: JSON.stringify(receipt) }])).toEqual({
    commandId: 'command-1',
    teamId: 'team-1',
  })
  expect(codingLogReference(JSON.stringify({ receipt, applicability: 'fresh' }))).toEqual({
    commandId: 'command-1',
    teamId: 'team-1',
  })
})

test('never returns captured output', () => {
  const ref = codingLogReference(JSON.stringify(receipt))
  expect(JSON.stringify(ref)).not.toContain('PRIVATE_SENTINEL')
})

test.each([
  [
    'a coding_log page carrying only a commandId',
    { commandId: 'command-1', text: 'PRIVATE_SENTINEL' },
  ],
  ['a pointer missing its team', { id: 'command-1' }],
  ['an empty team', { id: 'command-1', teamId: '' }],
  ['an empty command', { id: '', teamId: 'team-1' }],
  ['an unrelated object', { command: 'ls' }],
  ['an array', [receipt]],
  ['a number', 42],
])('yields nothing for %s', (_label, content) => {
  expect(codingLogReference(content)).toBeNull()
})

test('yields nothing for unparseable content', () => {
  expect(codingLogReference('not json')).toBeNull()
  expect(codingLogReference(undefined)).toBeNull()
})

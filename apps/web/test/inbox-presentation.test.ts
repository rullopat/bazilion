import { expect, test } from 'vitest'
import { inboxUpdateLabel, parseInboxWake } from '../src/lib/inbox-presentation.ts'

test('inbox summary hides runtime instructions and opaque identifiers', () => {
  const id = '541fd306-6a08-4071-8bac-e299fad86aaf'
  expect(
    inboxUpdateLabel(
      `You have 1 new message\n--- from demo-tester (${id}) (message ${id}, reply to ${id}) ---\nResult\nYou MUST reply`,
    ),
  ).toBe('Update from demo-tester')
  expect(inboxUpdateLabel(`--- from ${id} (message ${id}) ---`)).toBe('Teammate update received')
  expect(inboxUpdateLabel('Unrecognized runtime message')).toBe('Teammate update received')
})

test('an inbox wake gives each teammate message without the instructions to the Agent', () => {
  const mira = '541fd306-6a08-4071-8bac-e299fad86aaf'
  const msg = '0f4c2a1e-1111-4222-8333-944455556666'
  const body = [
    'You have 2 new messages in your inbox:',
    '',
    `--- from Mira (${mira}) (message ${msg}) ---`,
    'Can you check the deploy?',
    '',
    'It failed twice.',
    '',
    `--- from ${mira} (message ${msg}, reply to ${msg}) ---`,
    'Done: the tests pass.',
    '',
    'You MUST reply to the 1 new message above (the ones that are NOT marked as a reply).',
    'The other message is a reply to something you sent.',
    '',
    'These messages continue an exchange between Agents that began with Mira.',
    `(recipient: ${msg})`,
  ].join('\n')
  expect(parseInboxWake(body)).toEqual([
    {
      fromName: 'Mira',
      fromId: mira,
      reply: false,
      text: 'Can you check the deploy?\n\nIt failed twice.',
    },
    { fromName: mira, fromId: mira, reply: true, text: 'Done: the tests pass.' },
  ])
  expect(parseInboxWake('Unrecognized runtime message')).toBeNull()
})

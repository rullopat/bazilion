import { expect, test } from 'vitest'
import { inboxUpdateLabel } from '../src/lib/inbox-presentation.ts'

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

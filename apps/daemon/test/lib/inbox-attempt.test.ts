import { expect, test } from 'vitest'
import { inboxAttemptId } from '../../src/lib/inbox-attempt.ts'

test('inbox turn correlation stays bounded for large ordered claims without storing message payloads', () => {
  const messages = Array.from({ length: 10000 }, (_, index) => ({ id: `message-${index}` }))
  const id = inboxAttemptId('agent', messages)
  expect(id).toMatch(/^inbox:[a-f0-9]{64}$/)
  expect(id).toBe(inboxAttemptId('agent', messages))
  expect(id).not.toContain('message-')
})
test('Actor, ordered message membership and boundaries remain distinct', () => {
  const first = inboxAttemptId('agent', [{ id: 'one' }, { id: 'two' }])
  expect(first).not.toBe(inboxAttemptId('other', [{ id: 'one' }, { id: 'two' }]))
  expect(first).not.toBe(inboxAttemptId('agent', [{ id: 'two' }, { id: 'one' }]))
  expect(first).not.toBe(inboxAttemptId('agent', [{ id: 'one' }]))
  expect(inboxAttemptId('a', [{ id: 'bc' }])).not.toBe(inboxAttemptId('ab', [{ id: 'c' }]))
  expect(inboxAttemptId('é', [{ id: 'a' }])).not.toBe(inboxAttemptId('e', [{ id: 'éa' }]))
})

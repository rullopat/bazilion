import { expect, test } from 'vitest'
import { workerFailureMessage } from '../../src/runtime/worker/cancellation.ts'

test.each([
  'This operation was aborted',
  'Request was aborted.',
  'The operation was aborted.',
  'aborted',
])('a signalled worker reports known abort %s canonically without rewriting the transcript', (message) => {
  expect(workerFailureMessage(message, true)).toBe('cancelled')
  expect(workerFailureMessage(message, false)).toBe(message)
})
test.each([
  'provider authentication failed',
  'worker cleanup could not be confirmed',
  'Native execution recovery_required',
  'command timed out',
  'provider aborted after invalid credentials',
  'completed',
])('a late cancellation cannot overwrite %s', (message) => {
  expect(workerFailureMessage(message, true)).toBe(message)
})

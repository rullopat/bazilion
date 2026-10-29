import { expect, test } from 'vitest'
import { NativeCommandError } from '../../src/lib/native-execution/command.ts'
import {
  nativeVerificationFailureState,
  nativeVerificationResultState,
} from '../../src/lib/verification/native-outcome.ts'

// Reporting-only metadata tests; these are not evidence of native execution or cleanup.
test.each([
  [new NativeCommandError('cancelled', true), true, 'cancelled'],
  [new NativeCommandError('timed_out', true), true, 'timed_out'],
  [new NativeCommandError('unavailable', true), true, 'cancelled'],
  [new NativeCommandError('unavailable', true), false, 'unknown'],
  [new NativeCommandError('recovery_required', false), true, 'unknown'],
  [{ code: 'cancelled', cleanupConfirmed: true }, true, 'unknown'],
  [new Error('cancelled'), true, 'unknown'],
] as const)('cancelled reporting requires genuine positive cleanup facts (%#)', (error, cancelled, state) => {
  expect(nativeVerificationFailureState(error, cancelled)).toBe(state)
})
test.each([
  [{ code: 0, signal: null }, true, 'succeeded'],
  [{ code: 1, signal: null }, true, 'failed'],
  [{ code: null, signal: 'SIGTERM' }, true, 'cancelled'],
  [{ code: null, signal: 'SIGTERM' }, false, 'unknown'],
] as const)('terminal reporting preserves known exit facts and distinguishes cancellation (%#)', (value, cancelled, state) => {
  expect(
    nativeVerificationResultState(
      { ...value, stdoutTruncated: false, stderrTruncated: false },
      cancelled,
    ),
  ).toBe(state)
})

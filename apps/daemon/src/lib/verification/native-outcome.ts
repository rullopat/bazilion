import type { NativeExecutionResult } from '@bazilion/api-types'
import { NativeCommandError } from '../native-execution/command.ts'

/** Reporting only, never cleanup/signalling authority. Callers supply actual executor facts. */
export function nativeVerificationFailureState(
  error: unknown,
  cancelled: boolean,
): 'unknown' | 'timed_out' | 'cancelled' {
  if (error instanceof NativeCommandError && error.cleanupConfirmed) {
    if (error.code === 'timed_out') return 'timed_out'
    if (error.code === 'cancelled' || (error.code === 'unavailable' && cancelled))
      return 'cancelled'
  }
  return 'unknown'
}
/** A terminal result is available only after the common executor positively proves cleanup. */
export function nativeVerificationResultState(
  result: NativeExecutionResult,
  cancelled: boolean,
): 'unknown' | 'succeeded' | 'failed' | 'cancelled' {
  return result.signal || result.code === null
    ? cancelled
      ? 'cancelled'
      : 'unknown'
    : result.code === 0
      ? 'succeeded'
      : 'failed'
}

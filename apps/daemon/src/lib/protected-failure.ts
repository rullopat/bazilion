import type { ChatFrame } from '@bazilion/api-types'
import { ProtectedExecutionUnavailableError } from './protected-provider.ts'
import { turnFrameFailure } from './turn-outcome.ts'

/** Return one bounded, secret-free reason suitable for durable owner state. */
export function protectedFailureMessage(error: unknown, subject = 'Protected Agent turn'): string {
  if (error instanceof ProtectedExecutionUnavailableError) return bound(error.message)
  if (error instanceof Error && error.message === 'cancelled') return 'Agent turn cancelled.'
  return `${subject} failed. Check Bazilion Config or bazilion doctor.`
}

export function protectedFrameFailure(frame: ChatFrame): string | null {
  const failure = turnFrameFailure(frame)
  if (!failure) return null
  return failure === 'cancelled'
    ? 'Agent turn cancelled.'
    : 'Protected Agent turn failed. Check Bazilion Config or bazilion doctor.'
}

/** Approval adapters may include credential-bearing request URLs; keep only curated errors. */
export function approvalDeliveryFailureMessage(error: unknown): string {
  if (error instanceof ProtectedExecutionUnavailableError) return bound(error.message)
  return 'Approval delivery failed. Check Bazilion Config or bazilion doctor.'
}

function bound(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

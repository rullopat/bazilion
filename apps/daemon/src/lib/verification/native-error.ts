import type { NativeCommandFailureObservation } from '../native-execution/command.ts'
import { ProtectedExecutionUnavailableError } from '../protected-execution-error.ts'

/** Closed preparation facts, never process identity or permission to release a resource. */
export class NativeVerificationPreparationError extends ProtectedExecutionUnavailableError {
  readonly reason:
    | 'unavailable'
    | 'runtime_changed'
    | 'source_changed'
    | 'source_unverifiable'
    | 'recovery_required'
  readonly cleanupConfirmed: boolean
  readonly observation: NativeCommandFailureObservation | undefined
  constructor(
    reason: NativeVerificationPreparationError['reason'],
    cleanupConfirmed: boolean,
    observation?: NativeCommandFailureObservation,
  ) {
    super(
      'Protected native verification runtime is unavailable. Run `bazilion doctor` for remediation.',
    )
    this.name = 'NativeVerificationPreparationError'
    this.reason = reason
    this.cleanupConfirmed = cleanupConfirmed
    this.observation = observation
  }
}

import { DomainError } from '../core/errors.ts'

/**
 * A turn or learning review cannot run: its provider is unknown, disabled or not connected, or the
 * review's credentials or endpoint are unavailable.
 */
export class ExecutionUnavailableError extends DomainError {
  constructor(message: string) {
    super(409, message)
  }
}

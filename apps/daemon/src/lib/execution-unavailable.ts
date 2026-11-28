import { DomainError } from '../core/errors.ts'

/** A turn cannot run: its provider is unknown, disabled or not connected. */
export class ExecutionUnavailableError extends DomainError {
  constructor(message: string) {
    super(409, message)
  }
}

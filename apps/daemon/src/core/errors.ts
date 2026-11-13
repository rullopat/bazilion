/** The HTTP status a route answers a DomainError with. */
export type DomainErrorStatus = 400 | 403 | 404 | 409 | 429

/**
 * An expected failure the caller can act on: a not-found id, invalid input, a conflict. Routes
 * answer it with `status` and `{ error: message }`, plus `code` where a client branches on it.
 * Any other error is a daemon fault.
 */
export class DomainError extends Error {
  readonly status: DomainErrorStatus
  readonly code: string | undefined

  constructor(status: DomainErrorStatus, message: string, code?: string) {
    super(message)
    this.name = new.target.name
    this.status = status
    this.code = code
  }
}

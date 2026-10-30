/** Dependency-free shared error identity; provider and worker admission may import it in either order. */
export class ProtectedExecutionUnavailableError extends Error {
  readonly code = 'protected_execution_unavailable'
  constructor(message: string) {
    super(message)
    this.name = 'ProtectedExecutionUnavailableError'
  }
}

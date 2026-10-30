/** Native command wire facts. No Node modules, live handles, policy text or host overrides. */
export type NativeExecutionBackend = 'linux-bwrap' | 'darwin-seatbelt'
export interface NativeExecutionFacts {
  readonly backend: NativeExecutionBackend
  readonly architecture: 'x64' | 'arm64'
  readonly nodeVersion: string
  readonly kernelRelease: string
  readonly policyFingerprint: string
  readonly fingerprint: string
}
/** Worker-visible description only; these facts cannot construct or recover execution authority. */
export interface NativeExecutionAdmission {
  readonly facts: NativeExecutionFacts
  readonly cwd: string
}
/** Addressed only through the daemon's already-bound Agent/turn capability. */
export interface NativeExecutionRequest {
  readonly toolCallId: string
  readonly command: string
  readonly cwd: string
  readonly timeoutMs: number
}
export interface NativeExecutionCancelRequest {
  readonly toolCallId: string
}
export interface NativeExecutionCancelResult {
  /** Request accepted, never proof that a command or its writers have stopped. */
  readonly requested: boolean
}
export interface NativeExecutionResult {
  readonly code: number | null
  readonly signal: string | null
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}
/** Producer-observed bytes before redaction; a lower bound if the producer already truncated. */
export interface NativeExecutionCapture {
  readonly observedBytes: number
  readonly redacted: boolean
}
export interface NativeExecutionOutput extends NativeExecutionCapture {
  readonly stream: 'stdout' | 'stderr'
  readonly sequence: number
  /** Bounded canonical base64; never decoded as UTF-8 before the owned diagnostics pipeline. */
  readonly data: string
}
/** Bounded failure diagnostics only. These facts never confer cleanup/signalling authority. */
export interface NativeExecutionFailureObservation {
  readonly backend: 'darwin-seatbelt'
  readonly phase:
    | 'idle'
    | 'ready'
    | 'term'
    | 'kill'
    | 'command-eof'
    | 'census'
    | 'exit'
    | 'group'
    | 'settled'
  readonly ownerLive: boolean
  readonly commandCompleted: boolean
  readonly commandNaturalEOF: boolean
  readonly fenced: boolean
  readonly terminalProof: boolean
  readonly captures: readonly ('empty_at_capture' | 'busy' | 'drift' | 'unknown')[]
}
export interface NativeExecutionFailure {
  readonly observation?: NativeExecutionFailureObservation
  readonly code: 'unavailable' | 'approval_denied' | 'cancelled' | 'timed_out' | 'recovery_required'
  readonly cleanupConfirmed: boolean
}

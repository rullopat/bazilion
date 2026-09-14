/** Optional durable defaults; never a prerequisite for Agent coding commands. */
export interface CodingEnvironmentValues {
  CI?: 'true' | 'false'
  NO_COLOR?: '0' | '1'
  TZ?: 'UTC'
}
export interface CodingEnvironmentConfig {
  image: string
  cwd: string
  env: CodingEnvironmentValues
}
export interface TeamCodingEnvironment {
  teamId: string
  revision: number
  config: CodingEnvironmentConfig
  updatedAt: number
}
export interface ConfigureCodingEnvironmentRequest {
  expectedRevision: number
  config: CodingEnvironmentConfig
}
export interface CodingEnvironmentStatus {
  environment: TeamCodingEnvironment | null
  configuredExecution: 'host' | 'docker'
  image: string
  workspaceRecovery: 'none' | 'required' | 'restored'
}
export type CodingPurpose = 'runtime' | 'dependency' | 'prepare' | 'build' | 'test'
export interface CodingCommandInput {
  command: string
  cwd: string
  purpose: CodingPurpose
  timeoutSeconds: number
}
export type CodingCommandState =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted'
export interface CodingEnvironmentSnapshot {
  posture: 'host' | 'docker' | 'protected'
  imageId: string | null
  cwd: string
  rootIdentity: string
  inputFingerprint: string | null
  capturedAt: number
  restrictions: string[]
}
export interface CodingCommandOutcome {
  state: Exclude<CodingCommandState, 'running'>
  exitCode: number | null
  diagnostic: string
  truncated: boolean
  reason: string | null
}
export interface CodingCommandReceipt extends Omit<CodingCommandOutcome, 'state'> {
  state: CodingCommandState
  id: string
  agentId: string
  teamId: string
  turnId: string
  toolCallId: string
  input: CodingCommandInput
  environment: CodingEnvironmentSnapshot
  startedAt: number
  finishedAt: number | null
}
export interface CodingReceiptView {
  receipt: CodingCommandReceipt
  applicability: 'fresh' | 'stale' | 'unknown'
}

/** BAZ-041: truthful retention state for captured diagnostic evidence. */
export type CodingCommandLogAvailability =
  | 'available'
  | 'truncated'
  | 'expired'
  | 'deleted'
  | 'unavailable'
/** Metadata only. Retained text is read through bounded, opaque-reference pages. */
export interface CodingCommandLogView {
  commandId: string
  teamId: string
  agentId: string
  turnId: string
  toolCallId: string
  availability: CodingCommandLogAvailability
  /** Retained UTF-8 bytes; zero once the log stops retaining text. */
  byteLength: number
  /** Bytes the command produced before the per-command cap; never reduced by eviction. */
  observedBytes: number
  /** True when redaction rewrote at least one credential before retention. */
  redacted: boolean
  createdAt: number
  expiresAt: number
  /** Source-owned egress released the captured bytes for disclosure. */
  releasedAt: number | null
  /** When the row stopped retaining bytes (expired or deleted). */
  retiredAt: number | null
}
export interface CodingCommandLogPage {
  commandId: string
  availability: CodingCommandLogAvailability
  /** Byte offset of `text` inside the retained tail. */
  offset: number
  text: string
  /** True when the page does not reach the end of the retained tail. */
  hasMore: boolean
  byteLength: number
}
export interface CodingCommandLogMatch {
  /** Byte offset of the match inside the retained tail. */
  offset: number
  /** 1-based line number inside the retained tail. */
  line: number
  excerpt: string
}
export interface CodingCommandLogSearchResult {
  commandId: string
  availability: CodingCommandLogAvailability
  matches: CodingCommandLogMatch[]
  /** True when the scan or hit limit stopped the search early. */
  bounded: boolean
}
/** Operator response for a retained-log metadata + page read. `page` is null when the
 *  audience may not disclose the bytes, which is distinct from an empty page. */
export interface CodingCommandLogResponse {
  view: CodingCommandLogView
  page: CodingCommandLogPage | null
}
/** Operator response for a retained-log search. `result` is null when withheld. */
export interface CodingCommandLogSearchResponse {
  view: CodingCommandLogView
  result: CodingCommandLogSearchResult | null
}

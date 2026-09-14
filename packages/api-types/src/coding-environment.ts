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

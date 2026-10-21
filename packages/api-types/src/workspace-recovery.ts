export type WorkspaceRecoveryOutcome =
  | 'recovered'
  | 'blocked'
  | 'active'
  | 'restored'
  | 'root_changed'
  | 'not_found'
  | 'selection_changed'

/** Why management cannot attempt cleanup. These codes carry no process/path authority. */
export type WorkspaceRecoveryBlocker =
  | 'host_commands'
  | 'worker_cleanup_unconfirmed'
  | 'resource_records_unavailable'

export interface WorkspaceRecoveryReport {
  teamId: string
  truncated: boolean
  writers: Array<{
    writerId: string
    posture: 'active' | 'restored' | 'root_changed' | 'recovery_required'
    blocker?: WorkspaceRecoveryBlocker
  }>
}

export interface WorkspaceRecoveryResponse {
  outcome: WorkspaceRecoveryOutcome
  report: WorkspaceRecoveryReport
}

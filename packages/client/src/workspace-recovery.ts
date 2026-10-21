import type { WorkspaceRecoveryOutcome, WorkspaceRecoveryReport } from '@bazilion/api-types'

type Writer = WorkspaceRecoveryReport['writers'][number]

/** Shared operator wording; does not perform cleanup or establish ownership. */
export function workspaceRecoveryExplanation(writer: Writer): string {
  if (writer.posture === 'restored')
    return 'Restored metadata is not cleanup authority. Management recovery is unavailable.'
  if (writer.posture === 'root_changed')
    return 'The registered workspace identity changed. No cleanup will be attempted.'
  if (writer.posture === 'active')
    return 'This writer is active. Recovery cannot interrupt active work.'
  switch (writer.blocker) {
    case 'host_commands':
      return 'Host commands may outlive a failed turn. Recovery of unconfirmed host-command cleanup is not supported in this release; the workspace stays blocked.'
    case 'worker_cleanup_unconfirmed':
      return 'Worker cleanup is not confirmed. Management will not signal an unconfirmed worker; the workspace stays blocked.'
    case 'resource_records_unavailable':
      return 'Recorded ownership is missing or inconsistent. Cleanup cannot be confirmed; the workspace stays blocked.'
    default:
      return 'Recorded resource cleanup can be attempted. The workspace stays blocked until cleanup is confirmed.'
  }
}

export const WORKSPACE_RECOVERY_OUTCOME_TEXT: Record<WorkspaceRecoveryOutcome, string> = {
  recovered: 'Recorded cleanup confirmed and writer released. Previous work was not retried.',
  blocked: 'Cleanup could not be confirmed. The workspace stays blocked.',
  active: 'A writer or recovery attempt is active. No additional cleanup was started.',
  restored: 'Restored metadata is not cleanup authority. The workspace stays blocked.',
  root_changed: 'The registered workspace identity changed. No cleanup was attempted.',
  not_found: 'The selected writer was not found for this Team. This is not a cleanup confirmation.',
  selection_changed:
    'The selection changed during cleanup. Recovery was not confirmed; review the current status.',
}

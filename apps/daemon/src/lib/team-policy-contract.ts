export const TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION = 1 as const

export function teamPolicyEnforcementRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BAZILION_TEAM_POLICY_ENFORCEMENT === 'on'
}

export function assertTeamPolicyEnforcementReleaseReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (teamPolicyEnforcementRequested(env) && TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION < 1) {
    throw new Error(
      'teamPolicy_enforcement_release_not_ready: management contract version 1 is required',
    )
  }
}

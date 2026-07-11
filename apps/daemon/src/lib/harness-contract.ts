export const HARNESS_MANAGEMENT_CONTRACT_VERSION = 0 as const

export function harnessEnforcementRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BAZILION_HARNESS_ENFORCEMENT === 'on'
}

export function assertHarnessEnforcementReleaseReady(env: NodeJS.ProcessEnv = process.env): void {
  if (harnessEnforcementRequested(env) && HARNESS_MANAGEMENT_CONTRACT_VERSION < 1) {
    throw new Error(
      'harness_enforcement_release_not_ready: management contract version 1 is required',
    )
  }
}

/** Product support policy only: no probe, process authority, fallback or experimental opt-in. */
export const MAC_NATIVE_EXECUTION_UNAVAILABLE =
  'Native macOS isolation is deferred and unqualified. Use sandbox off only for trusted host execution; isolation-required work remains unavailable.'
export const MAC_PROTECTED_EXECUTION_UNAVAILABLE =
  'Protected execution is unavailable on macOS because no qualified isolation backend is available. Trusted host execution cannot satisfy this requirement.'
export const MAC_DOCKER_EXECUTION_UNAVAILABLE =
  'Docker execution is not supported on macOS. Use sandbox off only for trusted host execution; isolation-required work remains unavailable.'

/** Passive selection support; Linux must still prove actual per-turn readiness and ownership. */
export function supportedIsolationBackends(
  platform: string = process.platform,
): readonly ('native' | 'docker')[] {
  return platform === 'linux' ? ['native', 'docker'] : []
}

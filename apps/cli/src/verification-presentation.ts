import type { VerificationEnvironmentFacts } from '@bazilion/api-types'

/** Captured comparison metadata, never current runtime readiness. */
export function verificationEnvironmentLabel(environment: VerificationEnvironmentFacts): string {
  return environment.sandbox === 'native'
    ? `native ${environment.native.backend} · ${environment.native.architecture} · Node ${environment.native.nodeVersion} (captured, not current readiness)`
    : `${environment.image} (shell ${environment.sandbox})`
}

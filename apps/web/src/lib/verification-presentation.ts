import type { VerificationEnvironmentFacts } from '@bazilion/api-types'

/** Wire-only captured facts, never a native availability or verification badge. */
export function verificationEnvironmentLabel(environment: VerificationEnvironmentFacts): string {
  return environment.sandbox === 'native'
    ? `native ${environment.native.backend} · ${environment.native.architecture} · Node ${environment.native.nodeVersion} (captured, not current readiness)`
    : `${environment.image} (shell ${environment.sandbox})`
}

import type { VerificationEnvironmentFacts } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { verificationEnvironmentLabel as web } from '../../web/src/lib/verification-presentation.ts'
import { verificationEnvironmentLabel as cli } from '../src/verification-presentation.ts'

test.each([
  'linux-bwrap',
  'darwin-seatbelt',
] as const)('CLI/web render captured %s facts without an image or current-readiness claim', (backend) => {
  const facts: VerificationEnvironmentFacts = {
    sandbox: 'native',
    image: null,
    inputScope: 'team-memory',
    cwd: '.',
    env: {},
    native: {
      backend,
      architecture: 'arm64',
      nodeVersion: '26.12.1',
      kernelRelease: 'synthetic-display-only',
      policyFingerprint: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
    },
  }
  expect(cli(facts)).toBe(web(facts))
  expect(cli(facts)).toContain(backend)
  expect(cli(facts)).toContain('captured, not current readiness')
  expect(cli(facts)).not.toContain('null')
  expect(cli(facts)).not.toContain('Docker')
})
test.each([
  'off',
  'docker',
] as const)('legacy %s presentation remains explicit and consistent', (sandbox) => {
  const facts: VerificationEnvironmentFacts = { sandbox, image: 'captured/image', cwd: '.' }
  expect(cli(facts)).toBe(`captured/image (shell ${sandbox})`)
  expect(web(facts)).toBe(cli(facts))
})

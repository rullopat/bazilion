import { expect, test } from 'vitest'
import { runNativeVerificationCaptureFixture } from '../fixtures/native-verification-capture.ts'

const enabled = process.env.BAZILION_TEST_NATIVE === '1' && process.platform === 'linux'
test.skipIf(!enabled)(
  'native operator capture freezes actual readiness and preserves one-use proof, policy and canonical admission',
  async () => {
    expect(await runNativeVerificationCaptureFixture()).toMatchObject({
      actualNativeCapture: true,
      forgedRetaggedReplayedObservationsRefused: true,
      intentSnapshottedBeforeAwait: true,
      policyDenyThenAllow: true,
      canonicalAdmission: true,
      actualCapturedExecution: true,
      resourcesSettled: true,
      providerTransport: 'none',
      publicSelectorQualified: false,
      specialistWorkerQualified: false,
    })
  },
  60_000,
)

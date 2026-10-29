import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'
import { runNativeVerificationApiFixture } from '../fixtures/native-verification-api.ts'

test.skipIf(!enabled)(
  'authenticated operator HTTP captures actual native facts, dispatches once and fences backend drift/shutdown without legacy fallback',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-api-')))
    expect(await runNativeVerificationApiFixture(root)).toMatchObject({
      authenticatedCanonicalHttpCapture: true,
      forgedEnvironmentAndImpersonationRejected: true,
      secretCommandsRefusedBeforeStorage: true,
      actualNativeFactsNotJson: true,
      noProviderBeforeReadiness: true,
      actualTwoToolSpecialist: true,
      actualCapturedExecution: true,
      nativeOffRefusesBeforeAttempt: true,
      legacyCaptureCannotFallBackToHostUnderNativeSelection: true,
      midReadinessSelectionChangeRefused: true,
      operatorShutdownFencesAndDrainsReadiness: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
    })
    rmSync(root, { recursive: true })
  },
  60_000,
)

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'
import { runCanonicalNativeVerificationFixture } from '../fixtures/native-verification-dispatch.ts'

test.skipIf(!enabled)(
  'canonical native verification dispatch owns its restricted worker and exposes only captured check tools',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-canonical-')))
    expect(await runCanonicalNativeVerificationFixture(root)).toMatchObject({
      actualCanonicalDispatch: true,
      restrictedTwoTools: true,
      workerOwnershipObserved: true,
      replayedAndUndeclaredChecksRefused: true,
      unknownBashToolDenied: true,
      nativeDurableReceipts: true,
      modelVerdictIgnored: true,
      readonlyMemory: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      productionNativeSelectionEnabled: false,
    })
    rmSync(root, { recursive: true })
  },
  60_000,
)

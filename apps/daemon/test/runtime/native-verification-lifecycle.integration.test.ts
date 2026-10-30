import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'
import { runNativeVerificationLifecycleFixture } from '../fixtures/native-verification-lifecycle.ts'

test.skipIf(!enabled)(
  'native verification disconnect/cancel retires owned workers and checks before receipt/attempt settlement',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-lifecycle-')))
    expect(await runNativeVerificationLifecycleFixture(root)).toMatchObject({
      actualNativeCommands: true,
      ownedRestrictedTransport: true,
      disconnectCancelsPendingCheck: true,
      operatorCancellation: true,
      receiptsFinalizedBeforeSettlement: true,
      noAutomaticReplay: true,
      resourcesSettled: true,
      providerTransport: 'none',
      productionNativeSelectionEnabled: false,
    })
    rmSync(root, { recursive: true })
  },
  60_000,
)

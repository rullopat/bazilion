import { expect, test } from 'vitest'
import { runNativeVerificationExecutorFixture } from '../fixtures/native-verification.ts'

const enabled = process.env.BAZILION_TEST_NATIVE === '1' && process.platform === 'linux'
test.skipIf(!enabled)(
  'native captured-check executor uses real admission, readonly memory, timeout and durable receipts without host fallback',
  async () => {
    expect(await runNativeVerificationExecutorFixture()).toMatchObject({
      actualNativeExecution: true,
      durableVerificationReceipts: true,
      liveRedaction: true,
      readonlyMemory: true,
      capturedTimeout: true,
      unattendedApprovalDenied: true,
      resourcesSettled: true,
      providerTransport: 'none',
      publicDispatchQualified: false,
    })
  },
  60_000,
)

import { expect, test } from 'vitest'
import { runNativeWorkerRetirementFixture } from '../fixtures/native-worker-retirement.ts'

test.skipIf(
  process.env.BAZILION_TEST_NATIVE !== '1' ||
    process.platform !== 'darwin' ||
    process.arch !== 'arm64',
)(
  'actual native bash double-drift preserves closed IPC failure facts in the canonical transcript without replay',
  async () => {
    expect(await runNativeWorkerRetirementFixture('bash')).toMatchObject({
      expectedControlledFailureObserved: true,
      canonicalBashFailureFactsPersisted: true,
      canonicalLiveOwnerRecoveryPositive: true,
      originalRunStillFailed: true,
      effectsReplayed: false,
    })
  },
  30_000,
)

const enabled =
  process.env.BAZILION_TEST_NATIVE === '1' &&
  process.platform === 'darwin' &&
  process.arch === 'arm64'
test.skipIf(!enabled)(
  'actual native worker double-drift holds, persists interrupted evidence and retires only through later live-owned proof',
  async () => {
    expect(await runNativeWorkerRetirementFixture()).toMatchObject({
      expectedControlledFailureObserved: true,
      realInventoryUnmodified: true,
      interruptedReceiptPersisted: true,
      canonicalLiveOwnerRecoveryPositive: true,
      templateRetiredOnlyAfterPositiveViewRelease: true,
      originalRunStillFailed: true,
      effectsReplayed: false,
      productionBackendQualified: false,
    })
  },
  30_000,
)

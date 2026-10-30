import { expect, test } from 'vitest'
import { runNativeDarwinLifetimeFixture } from '../fixtures/native-darwin-lifetime.ts'

const enabled =
  process.env.BAZILION_TEST_NATIVE === '1' &&
  process.platform === 'darwin' &&
  process.arch === 'arm64'
test.skipIf(!enabled)(
  'double-forked setsid TERM-resistant closed-pipe writer holds the native workspace until fresh live-owned settlement',
  async () => {
    expect(await runNativeDarwinLifetimeFixture()).toEqual({
      outsideProcargsDenied: true,
      inheritedDescriptorsClosed: true,
      detachedWriterHeld: true,
      naturalCommandEOFWasInsufficient: true,
      originalLiveOwnerRecoveryPositive: true,
      expiryWasNotSettlementAuthority: true,
      effectsReplayed: false,
    })
  },
  30_000,
)

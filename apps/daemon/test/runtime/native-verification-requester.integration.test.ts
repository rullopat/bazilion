import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runCanonicalNativeInboxFixture } from '../fixtures/native-canonical-turn.ts'

const enabled = process.env.BAZILION_TEST_NATIVE === '1' && process.platform === 'linux'
test.skipIf(!enabled)(
  'a native coding Agent freezes its change for an owned restricted specialist and receives the policy-authorized result',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-agent-verification-')))
    expect(await runCanonicalNativeInboxFixture(root, true)).toMatchObject({
      actualDaemonPreparationAndTurn: true,
      readinessBeforeMessageClaim: true,
      nativeAgentRequesterAdmitted: true,
      copiedWrongAndStaleRequesterRefused: true,
      nativeVerificationRequestedAndDispatched: true,
      nativeSpecialistResultDelivered: true,
      writerReleased: true,
      providerTransport: 'synthetic-loopback',
      productionNativeSelectionEnabled: false,
    })
    rmSync(root, { recursive: true })
  },
  45_000,
)

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runCanonicalNativeInboxFixture } from '../fixtures/native-canonical-turn.ts'

const enabled = process.env.BAZILION_TEST_NATIVE === '1' && process.platform === 'linux'
// One isolated context, never restarted in situ. Public selector/installed-client acceptance is separate.
test.skipIf(!enabled)(
  'canonical native prepared inbox turn preserves Team Policy claims, tool admission and durable coding evidence',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-canonical-turn-')))
    expect(await runCanonicalNativeInboxFixture(root)).toMatchObject({
      actualDaemonPreparationAndTurn: true,
      readinessBeforeMessageClaim: true,
      teamPolicyPeerDenyThenAllow: true,
      actualCodingReceipt: true,
      writerReleased: true,
      providerTransport: 'synthetic-loopback',
      productionNativeSelectionEnabled: false,
    })
    rmSync(root, { recursive: true })
  },
  30_000,
)

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'
import { runSelectedNativeTurnsFixture } from '../fixtures/native-selected-turns.ts'

test.skipIf(!enabled)(
  'explicit native selection drives the canonical configured worker, scheduled occurrence and inbox readiness before claim without fallback',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-selected-turns-')))
    expect(await runSelectedNativeTurnsFixture(root)).toMatchObject({
      explicitInstallationNativeSelection: true,
      actualConfiguredTurn: true,
      selectionDriftRefusedBeforeWorkerOrProvider: true,
      actualScheduledTick: true,
      actualInboxTick: true,
      unavailableInboxLeavesEightUnread: true,
      nativeBashAndCoding: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
      dockerRetired: false,
    })
    rmSync(root, { recursive: true })
  },
  60_000,
)

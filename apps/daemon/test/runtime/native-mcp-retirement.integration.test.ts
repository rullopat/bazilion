import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { runNativeMcpRetirementFixture } from '../fixtures/native-mcp-retirement.ts'

import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'

test.skipIf(!enabled)(
  'native-integrated daemon MCP preserves descendant, busy-call and opening retirement without replay or oracle PID authority',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-mcp-retirement-')))
    expect(
      await runNativeMcpRetirementFixture(
        root,
        fileURLToPath(new URL('../fixtures/mcp-stdio.mjs', import.meta.url)),
      ),
    ).toMatchObject({
      actualStdioAdmissionAndCall: true,
      explicitEnvironmentOnly: true,
      descendantRetirementConfirmed: true,
      busyReapingRefused: true,
      busyCancellationUncertainWithoutReplay: true,
      openingRetirementCannotPublish: true,
      failedInitializationRetired: true,
      resourcesSettled: true,
      oracleConfersNoSignallingAuthority: true,
      installedClientQualified: false,
    })
    rmSync(root, { recursive: true })
  },
  30_000,
)

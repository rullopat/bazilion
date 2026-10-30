import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { nativeIntegrationEnabled } from '../fixtures/native-platform.ts'
import { runSelectedNativeTurnsFixture } from '../fixtures/native-selected-turns.ts'

const enabled = nativeIntegrationEnabled && process.env.BAZILION_TEST_BROWSER === '1'
test.skipIf(!enabled)(
  'native ordinary workers preserve daemon-owned MCP, managed browser and guarded repository context while background workers deny those capabilities',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-platform-tools-')))
    expect(
      await runSelectedNativeTurnsFixture(root, {
        mcpFixture: fileURLToPath(new URL('../fixtures/mcp-stdio.mjs', import.meta.url)),
      }),
    ).toMatchObject({
      ordinaryNativeDaemonBrowserAndMcp: true,
      guardedRepositoryInstructions: true,
      managedBlankPageAndPrivateSsrfDenial: true,
      backgroundCannotUseBrowserOrMcp: true,
      daemonResourceRetirementConfirmed: true,
      browserSiteJourneyQualified: false,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
    })
    rmSync(root, { recursive: true })
  },
  90_000,
)

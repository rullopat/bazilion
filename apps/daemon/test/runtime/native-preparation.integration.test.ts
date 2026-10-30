import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { prepareNativeTurn } from '../../src/lib/native-execution/turn.ts'
import { makeTestEnv } from '../core/helpers.ts'
import { runNativePreparationFixture } from '../fixtures/native-preparation.ts'

test('pre-cancelled native preparation reports closed cleanup facts without acquiring process authority', async () => {
  const env = makeTestEnv(),
    root = join(env.home, 'cancelled-native'),
    controller = new AbortController()
  mkdirSync(root, { mode: 0o700 })
  const lifecycle = workspaceLifecycle(env.db),
    workspace = env.paths.teamDir(env.teamId),
    lease = lifecycle.coordinator.claim(env.teamId, workspace, 'agent')
  controller.abort()
  try {
    await expect(
      prepareNativeTurn({
        root,
        lifecycle,
        lease,
        cwd: '.',
        env: {},
        readOnlyDirectories: [],
        readOnlyFiles: [],
        unavailable: [],
        signal: controller.signal,
        assertActive() {},
      }),
    ).rejects.toMatchObject({ code: 'cancelled', cleanupConfirmed: true })
    expect(env.db.raw.query('SELECT id FROM workspace_resources').all()).toEqual([])
    lease.finish(true)
  } finally {
    env.cleanup()
  }
})

import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'

test.skipIf(!enabled).each(['configured', 'inbox'] as const)(
  'real native %s preparation owns canonical paths, late inputs and actor handoff without a provider',
  async (mode) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-preparation-')))
    const result = await runNativePreparationFixture(root, mode)
    expect(result).toMatchObject({
      actualNativeReadiness: true,
      resourcesSettled: true,
      providerTransport: 'none',
      productionBackendQualified: false,
    })
    rmSync(root, { recursive: true })
  },
  20_000,
)

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runWorkerSignalGuardFixture } from '../fixtures/worker-signal-guard.ts'

test
  .skipIf(
    !(process.platform === 'linux' || (process.platform === 'darwin' && process.arch === 'arm64')),
  )
  .each(['deny_term', 'deny_kill', 'cancel_before_input'] as const)(
  'live worker respects %s signal guard and executable-input cancellation',
  async (mode) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'worker-signal-guard-')))
    expect(await runWorkerSignalGuardFixture(root, mode)).toMatchObject({
      guardRefusalRespected: true,
      trustedChildNaturalExit: true,
      canonicalResourcesSettled: true,
      providerTransport: 'none',
    })
    rmSync(root, { recursive: true })
  },
  15_000,
)

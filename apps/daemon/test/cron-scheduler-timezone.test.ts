import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Fresh Node/fork workers inherit TZ before constructing Dates. Production scheduler/DB
// paths run with controlled clocks; existing scheduler fixture stubs turn execution only.
// No S-lane wall-clock/provider or external exactly-once claim.
test.each([
  'America/New_York',
  'Europe/Berlin',
])('production scheduler calendar in %s: DST materialization and same-minute deduplication', (zone) => {
  const parentZone = process.env.TZ
  const root = mkdtempSync(join(tmpdir(), 'baz065-calendar-dispatch-'))
  try {
    const reportPath = join(root, 'report.json')
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../vitest.mjs', import.meta.resolve('vitest'))),
        'run',
        'apps/daemon/test/lib/scheduler.test.ts',
        '-t',
        'controlled DST dispatcher',
        '--pool=forks',
        '--maxWorkers=1',
        '--no-file-parallelism',
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ],
      {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          TZ: zone,
          CI: '1',
          BAZILION_TEST_CRON_CALENDAR: '1',
        },
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    )
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      success: boolean
      numPassedTests: number
      numFailedTests: number
    }
    expect(report.success).toBe(true)
    expect(report.numPassedTests).toBe(2)
    expect(report.numFailedTests).toBe(0)
    expect(process.env.TZ).toBe(parentZone)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 40_000)

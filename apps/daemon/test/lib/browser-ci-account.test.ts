import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const script = fileURLToPath(
  new URL('../../../../scripts/testing/macos-browser-account.mjs', import.meta.url),
)

test.each([
  'setup',
  'cleanup',
])('browser CI account %s refuses an ordinary operator session before mutation', async (action) => {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-account-refusal-'))
  try {
    await expect(
      promisify(execFile)(process.execPath, [script, action], {
        env: {
          PATH: '/usr/bin:/bin',
          HOME: home,
          RUNNER_TEMP: home,
          GITHUB_ENV: join(home, 'env'),
          GITHUB_ACTIONS: 'false',
          RUNNER_ENVIRONMENT: 'github-hosted',
        },
      }),
    ).rejects.toThrow(/disposable GitHub-hosted Apple Silicon runner/)
    expect(readdirSync(home)).toEqual([])
    expect(existsSync(join(home, 'env'))).toBe(false)
  } finally {
    rmSync(home, { recursive: true })
  }
})

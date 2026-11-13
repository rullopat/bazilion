import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Tests must never touch the owner's real ~/.bazilion. Every test file gets a throwaway home
// unless it sets BAZILION_HOME itself; code that resolves the default home lands here instead.
// The homes live under the run's scratch root, which vitest.global-setup.ts removes.
if (!process.env.BAZILION_HOME) {
  const root = process.env.BAZILION_TEST_HOMES ?? tmpdir()
  process.env.BAZILION_HOME = mkdtempSync(join(root, 'home-'))
}

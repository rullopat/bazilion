import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// One scratch root per test run for the per-file throwaway homes created in vitest.setup.ts.
// Workers inherit the variable; the teardown runs in the main process, so cleanup is reliable.
export default function setup() {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-test-homes-'))
  process.env.BAZILION_TEST_HOMES = root
  return () => rmSync(root, { recursive: true, force: true })
}

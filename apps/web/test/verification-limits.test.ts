import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VERIFICATION_OUTCOME_LIMITS } from '@bazilion/api-types'
import { expect, test } from 'vitest'

// BAZ-045: one statement, every surface that makes it.
//
// The result message an Agent receives and the panel the operator reads must say the same two things:
// that a non-zero exit is not proof about later code and not an approval, and that declared output paths
// are reported rather than enforced. They share a definition so they cannot drift in wording — and this
// asserts they are actually *wired*, because that is the failure BAZ-044's review found: the guard and its
// tests existed, and nothing in the production path used it.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

function source(path: string): string {
  return readFileSync(`${repoRoot}${path}`, 'utf8')
}

test('the verification limits statement names both limits, and both surfaces render it', () => {
  expect(VERIFICATION_OUTCOME_LIMITS).toHaveLength(2)
  expect(VERIFICATION_OUTCOME_LIMITS[0]).toMatch(/not an approval to publish, merge or deploy/)
  expect(VERIFICATION_OUTCOME_LIMITS[1]).toMatch(/Declared output paths are not enforced/)

  // The result message handed to the requesting Agent.
  expect(source('apps/daemon/src/lib/verification/result.ts')).toContain('VERIFICATION_OUTCOME_LIMITS')
  // The panel the operator reads. Stated once for the panel, not only after a check has run: a request
  // waiting to be verified is exactly when "nothing wrote outside the declared paths" gets read as
  // confinement.
  const panel = source('apps/web/src/routes/teams/$id/verifications.tsx')
  expect(panel).toContain('VERIFICATION_OUTCOME_LIMITS')
  expect(panel).toContain('VERIFICATION_OUTCOME_LIMITS[0]} {VERIFICATION_OUTCOME_LIMITS[1]}')
})

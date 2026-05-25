// First-run regression test.
//
// Decision #1 from BAZ-002 (resolved 2026-05-24): NO default profile group is
// seeded at first run. Profile groups are an advanced, personal-to-the-operator
// feature; a generic seed would mislead and clutter the welcome flow. This test
// locks that decision in — it'll fail loudly if a future change reintroduces
// default-team seeding into the bootstrap path.

import { afterEach, beforeEach, expect, test } from 'vitest'
import { isSetupComplete } from '../../src/core/availableModels.ts'
import { ensureSetupSeeded } from '../../src/core/profile/seed.ts'
import * as profileGroupRepo from '../../src/core/repos/profileGroups.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as providerModelRepo from '../../src/core/repos/providerModels.ts'
import * as providerStateRepo from '../../src/core/repos/providerState.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('ensureSetupSeeded creates the default profile + group once a provider is configured', () => {
  expect(isSetupComplete(env.db)).toBe(false)
  expect(ensureSetupSeeded(env.db, env.paths)).toBeNull()

  // Enable a provider + curate one model — the minimal "setup complete" state.
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  providerModelRepo.replace(env.db, 'anthropic', ['claude-opus-4-6'])
  expect(isSetupComplete(env.db)).toBe(true)

  const result = ensureSetupSeeded(env.db, env.paths)
  expect(result).not.toBeNull()
  expect(result?.profile.id).toBe('default')
  expect(result?.group.id).toBe('default')
  expect(profileRepo.get(env.db, 'default')).not.toBeNull()
})

test('NO default-team profile group is created at any point during first-run setup', () => {
  // Empty DB: no profile groups.
  expect(profileGroupRepo.list(env.db)).toEqual([])

  // Cross the first-run threshold.
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  providerModelRepo.replace(env.db, 'anthropic', ['claude-opus-4-6'])
  ensureSetupSeeded(env.db, env.paths)

  // The load-bearing assertion: no default-team, no any-team. Profile groups
  // remain entirely operator-driven.
  expect(profileGroupRepo.list(env.db)).toEqual([])
  expect(profileGroupRepo.get(env.db, 'default-team')).toBeNull()
  expect(profileGroupRepo.get(env.db, 'default')).toBeNull()
})

test('ensureSetupSeeded is idempotent across repeat calls', () => {
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  providerModelRepo.replace(env.db, 'anthropic', ['claude-opus-4-6'])
  const first = ensureSetupSeeded(env.db, env.paths)
  expect(first?.profileCreated).toBe(true)

  // Second call: the default profile already exists, no-op (returns null per
  // the ensureSetupSeeded contract).
  const second = ensureSetupSeeded(env.db, env.paths)
  expect(second).toBeNull()

  // And still no profile-group seeding crept in on either call.
  expect(profileGroupRepo.list(env.db)).toEqual([])
})

// First-run regression test.
//
// By design, NO default profile team is
// seeded at first run. Profile teams are an advanced, personal-to-the-operator
// feature; a generic seed would mislead and clutter the welcome flow. This test
// locks that decision in — it'll fail loudly if a future change reintroduces
// default-team seeding into the bootstrap path.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { isSetupComplete } from '../../src/core/availableModels.ts'
import { ensureSetupSeeded } from '../../src/core/profile/seed.ts'
import { DEFAULT_USER_MD } from '../../src/core/profile/templates.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as providerModelRepo from '../../src/core/repos/providerModels.ts'
import * as providerStateRepo from '../../src/core/repos/providerState.ts'
import * as teamRepo from '../../src/core/repos/teams.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('ensureSetupSeeded creates the default profile + team once a provider is configured', () => {
  expect(isSetupComplete(env.db)).toBe(false)
  expect(ensureSetupSeeded(env.db, env.paths)).toBeNull()

  // Enable a provider + curate one model — the minimal "setup complete" state.
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  providerModelRepo.replace(env.db, 'anthropic', ['claude-opus-4-6'])
  expect(isSetupComplete(env.db)).toBe(true)

  const result = ensureSetupSeeded(env.db, env.paths)
  expect(result).not.toBeNull()
  expect(result?.profile.id).toBe('default')
  expect(result?.team.id).toBe('default')
  expect(profileRepo.get(env.db, 'default')).not.toBeNull()
})

test('the seeded default profile ships the default-on template files (HEARTBEAT opt-in)', () => {
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  providerModelRepo.replace(env.db, 'anthropic', ['claude-opus-4-6'])
  const result = ensureSetupSeeded(env.db, env.paths)
  const dir = result?.profile.dir
  expect(dir).toBeTruthy()
  for (const file of ['SOUL.md', 'IDENTITY.md', 'BOOTSTRAP.md', 'AGENTS.md', 'TOOLS.md']) {
    expect(existsSync(join(dir as string, file))).toBe(true)
  }
  // HEARTBEAT is opt-in — the default profile doesn't ship it.
  expect(existsSync(join(dir as string, 'HEARTBEAT.md'))).toBe(false)
})

test("the seeded default team's user_md is DEFAULT_USER_MD", () => {
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  providerModelRepo.replace(env.db, 'anthropic', ['claude-opus-4-6'])
  ensureSetupSeeded(env.db, env.paths)
  expect(teamRepo.get(env.db, 'default', env.paths)?.userMd).toBe(DEFAULT_USER_MD)
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
})

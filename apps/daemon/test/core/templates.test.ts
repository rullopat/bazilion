import { expect, test } from 'vitest'
import {
  DEFAULT_AGENTS,
  DEFAULT_BOOTSTRAP,
  DEFAULT_IDENTITY,
  DEFAULT_SOUL,
  DEFAULT_TOOLS,
  DEFAULT_USER_MD,
} from '../../src/core/profile/templates.ts'

// Cheap regression guard: assert the key markers each template promises are
// present, so an accidental content deletion fails loudly. Not a prose review.

test('DEFAULT_IDENTITY asks for the new Creature + Avatar fields', () => {
  expect(DEFAULT_IDENTITY).toContain('**Creature:**')
  expect(DEFAULT_IDENTITY).toContain('**Avatar:**')
  expect(DEFAULT_IDENTITY).toContain('**Name:**')
})

test('DEFAULT_BOOTSTRAP runs a two-phase ritual (identity + user profile)', () => {
  // Phase 1 writes IDENTITY.md, phase 2 writes USER.md, then bootstrap_done.
  expect(DEFAULT_BOOTSTRAP).toContain('home_write')
  expect(DEFAULT_BOOTSTRAP).toContain('user_md_get')
  expect(DEFAULT_BOOTSTRAP).toContain('user_md_write')
  expect(DEFAULT_BOOTSTRAP).toContain('bootstrap_done')
  // The etag read-before-write contract must be spelled out.
  expect(DEFAULT_BOOTSTRAP).toMatch(/etag/i)
})

test('DEFAULT_USER_MD has the human-profile fields', () => {
  expect(DEFAULT_USER_MD).toContain('About Your Human')
  expect(DEFAULT_USER_MD).toContain('Pronouns:')
  expect(DEFAULT_USER_MD).toContain('Timezone:')
})

test('DEFAULT_AGENTS is the workspace operating manual', () => {
  expect(DEFAULT_AGENTS).toContain('Red lines')
  expect(DEFAULT_AGENTS).toContain('External channels')
  expect(DEFAULT_AGENTS).toContain('Triple-Tap')
  expect(DEFAULT_AGENTS).toContain('Memory discipline')
})

test('DEFAULT_SOUL and DEFAULT_TOOLS carry their richer content', () => {
  expect(DEFAULT_SOUL).toContain('Core truths')
  expect(DEFAULT_TOOLS).toContain('Environment notes')
})

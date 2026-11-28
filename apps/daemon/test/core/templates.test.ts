import { expect, test } from 'vitest'
import {
  DEFAULT_BOOTSTRAP,
  DEFAULT_IDENTITY,
  DEFAULT_SOUL,
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

test('DEFAULT_SOUL says who the Agent is and how it works, and names only files it has', () => {
  expect(DEFAULT_SOUL).toContain('Core truths')
  expect(DEFAULT_SOUL).toContain('Boundaries')
  expect(DEFAULT_SOUL).toContain('trash over rm')
  expect(DEFAULT_SOUL).not.toContain('AGENTS.md')
  expect(DEFAULT_SOUL).not.toContain('TOOLS.md')
})

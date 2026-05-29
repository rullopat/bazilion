import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  identityHasValues,
  loadIdentityFromFile,
  parseIdentityMarkdown,
} from '../../src/core/profile/identity.ts'
import { DEFAULT_IDENTITY } from '../../src/core/profile/templates.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bazilion-identity-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('parseIdentityMarkdown extracts name/emoji/vibe from bullet list', () => {
  const md = `# IDENTITY

- **Name:** Felix
- **Vibe:** cat with a clipboard
- **Emoji:** 🐾
- **Creature:** familiar
`
  const parsed = parseIdentityMarkdown(md)
  expect(parsed).toEqual({
    name: 'Felix',
    vibe: 'cat with a clipboard',
    emoji: '🐾',
    creature: 'familiar',
  })
  expect(identityHasValues(parsed)).toBe(true)
})

test('parseIdentityMarkdown strips placeholder prompts', () => {
  const md = `- Name: pick something you like
- Emoji: 🦉
- Theme: your signature - pick one that feels right`
  const parsed = parseIdentityMarkdown(md)
  expect(parsed).toEqual({ emoji: '🦉' })
})

test('parseIdentityMarkdown ignores unrelated labels and bare text', () => {
  const md = `# Felix

Random prose without a colon.

- Name: Bazyl
- Mission: this is not a known label
- not-even-a-label
`
  const parsed = parseIdentityMarkdown(md)
  expect(parsed).toEqual({ name: 'Bazyl' })
})

test('parseIdentityMarkdown strips markdown emphasis on labels', () => {
  // Label regex drops every *_; value regex only touches edges, after the
  // colon-adjacent space has been preserved.
  const md = `- **Name:** Quill
- _Vibe_: cheeky`
  const parsed = parseIdentityMarkdown(md)
  expect(parsed.name).toBe('Quill')
  expect(parsed.vibe).toBe('cheeky')
})

test('identityHasValues is false for empty / placeholder-only identities', () => {
  expect(identityHasValues(parseIdentityMarkdown('# heading\n'))).toBe(false)
  expect(identityHasValues({})).toBe(false)
})

test('loadIdentityFromFile returns null for missing file', () => {
  expect(loadIdentityFromFile(join(dir, 'ghost.md'))).toBeNull()
})

test('loadIdentityFromFile returns null when nothing parses', () => {
  const path = join(dir, 'IDENTITY.md')
  writeFileSync(path, '# Just prose, no key:value pairs\n')
  expect(loadIdentityFromFile(path)).toBeNull()
})

test('loadIdentityFromFile returns parsed identity when the file has values', () => {
  const path = join(dir, 'IDENTITY.md')
  writeFileSync(path, '- Name: Ada\n- Emoji: ✨\n')
  expect(loadIdentityFromFile(path)).toEqual({ name: 'Ada', emoji: '✨' })
})

test('the unmodified DEFAULT_IDENTITY template parses to no values', () => {
  // Every placeholder hint in the template must normalize to an entry in
  // IDENTITY_PLACEHOLDER_VALUES, so a never-edited IDENTITY.md is "empty".
  const parsed = parseIdentityMarkdown(DEFAULT_IDENTITY)
  expect(identityHasValues(parsed)).toBe(false)
  const path = join(dir, 'IDENTITY.md')
  writeFileSync(path, DEFAULT_IDENTITY)
  expect(loadIdentityFromFile(path)).toBeNull()
})

test('a filled-in DEFAULT_IDENTITY (incl. avatar + creature) parses all fields', () => {
  const filled = DEFAULT_IDENTITY.replace('_(pick something you like)_', 'Sable')
    .replace('_(AI? robot? familiar? ghost in the machine? something weirder?)_', 'house spirit')
    .replace('_(how do you come across? sharp? warm? chaotic? calm?)_', 'dry and precise')
    .replace('_(your signature — pick one that feels right)_', '🦊')
    .replace('_(an http(s) URL or data URI — optional)_', 'https://example.com/sable.png')
  const path = join(dir, 'IDENTITY.md')
  writeFileSync(path, filled)
  expect(loadIdentityFromFile(path)).toEqual({
    name: 'Sable',
    creature: 'house spirit',
    vibe: 'dry and precise',
    emoji: '🦊',
    avatar: 'https://example.com/sable.png',
  })
})

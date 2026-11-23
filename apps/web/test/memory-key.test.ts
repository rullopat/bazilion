import { expect, test } from 'vitest'
import { noteKey } from '../src/lib/memory-key'

test('a typed name becomes a path ending in .md', () => {
  expect(noteKey(' people/sam ')).toEqual({ key: 'people/sam.md' })
  expect(noteKey('./decisions/launch.md')).toEqual({ key: 'decisions/launch.md' })
  expect(noteKey('Notes.MD')).toEqual({ key: 'Notes.md' })
})

test('a name that leaves the memory folder or has empty parts is refused', () => {
  for (const typed of ['', '/etc/passwd', '../escape.md', 'a/../b.md', 'a//b', 'a\\b.md'])
    expect(noteKey(typed)).toHaveProperty('error')
})

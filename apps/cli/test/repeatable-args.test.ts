import { expect, test } from 'vitest'
import { collectFlagValues } from '../src/repeatable-args.ts'

// citty has no array argument type, so a repeated `--flag value` pair is parsed last-wins. These
// cases pin the behaviour that makes a "repeatable" flag actually repeatable, including the shapes
// that made the original bug silent.

test('every occurrence of a repeated flag is collected', () => {
  expect(
    collectFlagValues(['chat', '--image', 'a.png', '--image', 'b.png', '--message', 'hi'], 'image'),
  ).toEqual(['a.png', 'b.png'])
  expect(collectFlagValues(['--file', 'one.txt', '--file', 'two.txt'], 'file')).toEqual([
    'one.txt',
    'two.txt',
  ])
})

test('a single occurrence still works, so the flag is not made awkward for the common case', () => {
  expect(collectFlagValues(['--image', 'only.png'], 'image')).toEqual(['only.png'])
})

test('the = form is accepted', () => {
  expect(collectFlagValues(['--image=a.png', '--image=b.png'], 'image')).toEqual(['a.png', 'b.png'])
})

test('a path containing a comma is not split — the reason this is not comma-separated', () => {
  expect(collectFlagValues(['--image', 'shot 2026, final.png'], 'image')).toEqual([
    'shot 2026, final.png',
  ])
})

test('a trailing flag with no value, and everything after --, are ignored', () => {
  expect(collectFlagValues(['--image'], 'image')).toEqual([])
  expect(collectFlagValues(['--image', '--'], 'image')).toEqual([])
  // After `--` nothing is a flag, even if it looks like one.
  expect(collectFlagValues(['--', '--image', 'a.png'], 'image')).toEqual([])
})

test('an unrelated flag is not collected, and prefixes do not collide', () => {
  expect(collectFlagValues(['--image-file', 'x', '--images', 'y'], 'image')).toEqual([])
  expect(collectFlagValues(['--file', 'a.txt'], 'image')).toEqual([])
})

test('repetition is not deduplicated: the caller decides what is meaningful', () => {
  expect(collectFlagValues(['--image', 'a.png', '--image', 'a.png'], 'image')).toEqual([
    'a.png',
    'a.png',
  ])
})

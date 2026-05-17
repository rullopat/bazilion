import { expect, test } from 'vitest'
import { columnize } from '../src/columnize.ts'

test('pads each column to its widest cell', () => {
  const out = columnize([
    ['a', 'short', 'x'],
    ['ab', 'longer-word', 'y'],
    ['abc', 'x', 'z'],
  ])
  expect(out).toEqual(['a    short        x', 'ab   longer-word  y', 'abc  x            z'])
})

test("doesn't pad the trailing column (keeps `| wc` friendly)", () => {
  const out = columnize([
    ['a', 'b'],
    ['aa', 'bb'],
  ])
  for (const line of out) {
    expect(line.endsWith(' ')).toBe(false)
  }
})

test('empty input returns empty output', () => {
  expect(columnize([])).toEqual([])
})

test('single-row tables still align the first columns', () => {
  expect(columnize([['a', 'b', 'c']])).toEqual(['a  b  c'])
})

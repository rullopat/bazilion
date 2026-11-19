import { expect, test } from 'vitest'
import {
  baseName,
  describeStep,
  lineChange,
  parseArgs,
  summarizeSteps,
} from '../src/lib/tool-steps.ts'

test('a tool call reads as what was done and to what', () => {
  expect(describeStep('bash', { command: 'pnpm test\nsecond line' })).toMatchObject({
    verb: 'Ran',
    target: 'pnpm test',
    doing: 'running a command',
    kind: 'command',
  })
  expect(describeStep('write', { path: 'site/theme.js', content: 'x' })).toMatchObject({
    verb: 'Wrote',
    target: 'site/theme.js',
    doing: 'writing theme.js',
    kind: 'write',
  })
  expect(describeStep('edit', { path: 'a/b.css' })).toMatchObject({
    verb: 'Edited',
    doing: 'editing b.css',
  })
  expect(describeStep('web_fetch', { url: 'https://example.com/docs/page' })).toMatchObject({
    doing: 'reading example.com',
    kind: 'web',
  })
  expect(describeStep('deliver_file', { path: 'out/cover.png' })).toMatchObject({
    verb: 'Delivered',
    kind: 'deliver',
  })
  expect(describeStep('browser_click', {})).toMatchObject({
    verb: 'In the browser:',
    target: 'click',
  })
  // A tool it has no words for still says which tool ran.
  expect(describeStep('mcp__files__search', null)).toMatchObject({
    verb: 'Used',
    target: 'mcp__files__search',
    kind: 'other',
  })
})

test('a long command is cut to one line', () => {
  const described = describeStep('bash', { command: `echo ${'x'.repeat(200)}` })
  expect(described.target?.length).toBeLessThanOrEqual(96)
  expect(described.target?.endsWith('…')).toBe(true)
})

test('a group of steps is summed up by kind', () => {
  expect(summarizeSteps(['command', 'read', 'write', 'write', 'write'])).toBe(
    '1 command, 1 lookup, 3 files written',
  )
  expect(summarizeSteps(['deliver', 'deliver', 'command'])).toBe('1 command, 2 files delivered')
  expect(summarizeSteps(['other'])).toBe('1 more')
  expect(summarizeSteps([])).toBe('')
})

test('a write or an edit says how many lines it added and removed', () => {
  expect(lineChange('write', { content: 'a\nb\nc\n' })).toEqual({ added: 3, removed: 0 })
  expect(
    lineChange('edit', {
      edits: [
        { oldText: 'one', newText: 'one\ntwo' },
        { oldText: 'x\ny', newText: '' },
      ],
    }),
  ).toEqual({ added: 2, removed: 3 })
  expect(lineChange('bash', { command: 'ls' })).toBeNull()
  expect(lineChange('edit', { path: 'a' })).toBeNull()
})

test('arguments that are not an object are no arguments', () => {
  expect(parseArgs('{"path":"a"}')).toEqual({ path: 'a' })
  expect(parseArgs('[1,2]')).toBeNull()
  expect(parseArgs('not json')).toBeNull()
  expect(baseName('a/b/c.txt')).toBe('c.txt')
  expect(baseName('dir/')).toBe('dir')
})

import { expect, test } from 'vitest'
import { questionAnswer } from '../src/commands/question.ts'

test('CLI question answers use one explicit choice and never default a recommendation', () => {
  expect(() => questionAnswer({})).toThrow('exactly one')
  expect(() => questionAnswer({ choice: '1', text: 'another' })).toThrow('exactly one')
  expect(() => questionAnswer({ choice: '1', skip: true })).toThrow('exactly one')
  expect(questionAnswer({ choice: '2' })).toEqual({ kind: 'choice', index: 1 })
  expect(questionAnswer({ text: 'Other format' })).toEqual({ kind: 'text', text: 'Other format' })
  expect(questionAnswer({ skip: true })).toEqual({ kind: 'skip' })
})
test('CLI rejects invalid choice syntax and enforces UTF-8 answer bounds', () => {
  for (const choice of ['0', '5', '1.0', '1e0', '-1'])
    expect(() => questionAnswer({ choice })).toThrow()
  expect(() => questionAnswer({ text: '  ' })).toThrow()
  expect(questionAnswer({ text: 'é'.repeat(2048) }).kind).toBe('text')
  expect(() => questionAnswer({ text: 'é'.repeat(2049) })).toThrow()
})

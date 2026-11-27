import { expect, test } from 'vitest'
import { questionAnswer } from '../src/commands/question.ts'

const one = (answer: unknown) => ({ kind: 'answers', answers: [answer] })

test('CLI question answers use one explicit choice and never default a recommendation', () => {
  expect(() => questionAnswer({})).toThrow('exactly one')
  expect(() => questionAnswer({ choice: '1', text: 'another' })).toThrow('exactly one')
  expect(() => questionAnswer({ choice: '1', skip: true })).toThrow('exactly one')
  expect(() => questionAnswer({ choice: '1', answers: ['2'] })).toThrow('exactly one')
  expect(questionAnswer({ choice: '2' })).toEqual(one({ kind: 'choice', index: 1 }))
  expect(questionAnswer({ text: 'Other format' })).toEqual(
    one({ kind: 'text', text: 'Other format' }),
  )
  expect(questionAnswer({ skip: true })).toEqual({ kind: 'skip' })
})

test('CLI rejects invalid choice syntax and enforces the answer length bound', () => {
  // Whether a choice exists is the daemon's to say, against the question asked.
  for (const choice of ['0', '1.0', '1e0', '-1']) expect(() => questionAnswer({ choice })).toThrow()
  expect(() => questionAnswer({ text: '  ' })).toThrow()
  expect(questionAnswer({ text: 'é'.repeat(4096) }).kind).toBe('answers')
  expect(() => questionAnswer({ text: 'é'.repeat(4097) })).toThrow()
})

test('a card of several questions takes one --answer each; an action takes --done or --cannot', () => {
  expect(questionAnswer({ answers: ['2', '1,3', 'skip', 'Calm, please'] })).toEqual({
    kind: 'answers',
    answers: [
      { kind: 'choice', index: 1 },
      { kind: 'choices', indexes: [0, 2] },
      { kind: 'skip' },
      { kind: 'text', text: 'Calm, please' },
    ],
  })
  expect(questionAnswer({ done: true, note: 'Signed in' })).toEqual({
    kind: 'done',
    note: 'Signed in',
  })
  expect(questionAnswer({ cannot: true })).toEqual({ kind: 'cannot' })
  expect(() => questionAnswer({ done: true, cannot: true })).toThrow('exactly one')
})

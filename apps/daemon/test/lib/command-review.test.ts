import { expect, test } from 'vitest'
import { parseVerdict, reviewCommand } from '../../src/lib/command-review.ts'
import { makeTestEnv } from '../core/helpers.ts'

test('the review model answers in one line of JSON; anything else is passed on', () => {
  expect(parseVerdict('{"decision":"allow","reason":"A normal build step."}', 'm')).toEqual({
    decision: 'allow',
    reason: 'A normal build step.',
    model: 'm',
  })
  expect(
    parseVerdict('Sure! {"decision": "deny", "reason": "Deletes your home."} Hope that helps', 'm'),
  ).toMatchObject({ decision: 'deny', reason: 'Deletes your home.' })
  expect(parseVerdict('{"decision":"yes"}', 'm')).toMatchObject({ decision: 'ask' })
  expect(parseVerdict('I think it is fine', 'm')).toMatchObject({
    decision: 'ask',
    reason: 'The review model’s answer could not be read.',
  })
})

test('a review model that cannot be reached passes the command on', async () => {
  const env = makeTestEnv()
  try {
    const verdict = await reviewCommand(
      { command: 'rm -rf build', risks: [], agentName: 'Dev', workspace: '/w', sandbox: 'host' },
      {
        model: 'lmstudio:reviewer',
        db: env.db,
        authToken: 'token',
        env: { LMSTUDIO_URL: 'http://127.0.0.1:9/v1' },
      },
    )
    expect(verdict).toMatchObject({ decision: 'ask', model: 'lmstudio:reviewer' })
    expect(verdict.reason).toMatch(/could not answer/)
  } finally {
    env.cleanup()
  }
})

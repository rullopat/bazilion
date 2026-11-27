import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vitest'
import { redactToolResults } from '../../src/runtime/pi/session.ts'

type After = NonNullable<AgentSession['agent']['afterToolCall']>

test("a tool result reaches the model with secrets taken out, after Pi's own handling", async () => {
  const calls: string[] = []
  const piAfter: After = async (context) => {
    calls.push('pi')
    return { content: context.result.content, details: { kept: true } }
  }
  const session = { agent: { afterToolCall: piAfter } } as unknown as AgentSession
  const values = ['ghp_secret_value']
  redactToolResults(session, values)
  const hook = session.agent.afterToolCall as After
  const context = (text: string) =>
    ({
      result: { content: [{ type: 'text', text }], details: {} },
      isError: false,
    }) as unknown as Parameters<After>[0]

  const out = await hook(context('token=ghp_secret_value done'))
  expect(calls).toEqual(['pi'])
  expect(out).toEqual({
    content: [{ type: 'text', text: 'token=[REDACTED] done' }],
    details: { kept: true },
  })
  // Nothing to take out: Pi's answer as it was.
  expect(await hook(context('nothing here'))).toEqual({
    content: [{ type: 'text', text: 'nothing here' }],
    details: { kept: true },
  })
  // A token refreshed during the turn joins the list and counts from then on.
  values.push('fresh_token_1234')
  expect((await hook(context('fresh_token_1234')))?.content).toEqual([
    { type: 'text', text: '[REDACTED]' },
  ])
})

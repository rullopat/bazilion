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
      toolCall: { name: 'bash' },
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

test("a result's details are cleaned too, and a secret goes in the forms output shows it", async () => {
  const { secretForms } = await import('../../src/runtime/worker/runtime.ts')
  const key = '-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END KEY-----'
  expect(secretForms(' tok_value_1234 \n')).toEqual(
    expect.arrayContaining([' tok_value_1234 \n', 'tok_value_1234']),
  )
  expect(secretForms(key)).toEqual(
    expect.arrayContaining(['MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', JSON.stringify(key).slice(1, -1)]),
  )

  const session = { agent: { afterToolCall: undefined } } as unknown as AgentSession
  redactToolResults(session, secretForms('tok_value_1234'))
  const hook = session.agent.afterToolCall as After
  const out = await hook({
    toolCall: { name: 'read' },
    result: {
      content: [{ type: 'text', text: 'clean' }],
      details: { truncation: { content: 'Bearer tok_value_1234' }, lines: 3 },
    },
    isError: false,
  } as unknown as Parameters<After>[0])
  expect(out).toEqual({ details: { truncation: { content: 'Bearer [REDACTED]' }, lines: 3 } })
})

// The recall tool: the Agent searches and rereads the messages a compaction summarized, as they
// stand in the conversation it continues.

import type { AssistantMessage } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vitest'
import { recallTool } from '../../src/runtime/tools/recall.ts'

const AT = Date.parse('2026-11-20T10:00:00Z')
const SECRET = 'sk-recall-fixture-credential'
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function conversation() {
  const session = SessionManager.inMemory('/workspace')
  let n = 0
  const user = (text: string) =>
    session.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: AT + n++ })
  const assistant = (content: AssistantMessage['content']) =>
    session.appendMessage({
      role: 'assistant',
      content,
      api: 'openai-completions',
      provider: 'lmstudio',
      model: 'test',
      usage,
      stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
      timestamp: AT + n++,
    })
  const result = (toolCallId: string, toolName: string, text: string, isError = false) =>
    session.appendMessage({
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [{ type: 'text', text }],
      isError,
      timestamp: AT + n++,
    })
  return { session, user, assistant, result }
}

/** Seven messages, the first five summarized, then two kept as they are. */
function compacted() {
  const c = conversation()
  c.user('The staging link is https://staging.paperboat.test/launch-0412, keep it handy.')
  c.assistant([
    {
      type: 'toolCall',
      id: 'call-1',
      name: 'web_fetch',
      arguments: { url: 'https://staging.paperboat.test/launch-0412' },
    },
  ])
  c.result('call-1', 'web_fetch', `Launch checklist: invoice PB-7731, token ${SECRET}`)
  c.assistant([{ type: 'text', text: 'The checklist names invoice PB-7731.' }])
  c.user('Thanks. Now draft the post.')
  const kept = c.assistant([{ type: 'text', text: 'Here is the draft post about the launch.' }])
  c.session.appendCompaction('The user shared a staging link; a draft post exists.', kept, 24_000)
  c.user('What was that staging link again?')
  return c
}

const invoke = (session: SessionManager, args: Record<string, unknown>, secrets = [SECRET]) =>
  recallTool({ branch: () => session.getBranch(), secrets }).invoke(args) as Promise<string>

test('before any summary there is nothing to recall', async () => {
  const c = conversation()
  c.user('Hello there.')
  expect(await invoke(c.session, { query: 'hello' })).toContain('Nothing in this conversation')
})

test('a search finds the summarized messages that hold every word, tool output included', async () => {
  const { session } = compacted()
  const found = await invoke(session, { query: 'staging LINK' })
  // The first message only: the call holds "staging" but not "link", and the kept question is
  // in the model's context already.
  expect(found).toContain('1 of the 5 summarized messages holds every word of "staging LINK"')
  expect(found).toContain('#1 · user · 2026-11-20 10:00 UTC: The staging link is')
  expect(found).not.toContain('again')

  const invoice = await invoke(session, { query: 'pb-7731' })
  expect(invoice).toContain('2 of the 5 summarized messages hold every word of "pb-7731":')
  expect(invoice).toContain('#3 · result of web_fetch')
  expect(invoice).toContain('#4 · assistant')
  // A credential is never shown, nor found.
  expect(invoice).not.toContain(SECRET)
  expect(await invoke(session, { query: SECRET })).toContain('None of the 5 summarized messages')
})

test('a read gives the messages in full, with the calls a reply made', async () => {
  const { session } = compacted()
  const read = await invoke(session, { from: 2, count: 2 })
  expect(read).toBe(
    [
      'Messages 2 to 3 of the 5 summarized; read on from 4:',
      '#2 · assistant · 2026-11-20 10:00 UTC\n[called web_fetch {"url":"https://staging.paperboat.test/launch-0412"}]',
      '#3 · result of web_fetch · 2026-11-20 10:00 UTC\nLaunch checklist: invoice PB-7731, token [REDACTED]',
    ].join('\n\n'),
  )
  expect(await invoke(session, { from: 4 })).toMatch(/^Messages 4 to 5 of the 5 summarized:/)
  expect(await invoke(session, { from: 6 })).toBe(
    'Only messages 1 to 5 were summarized; the later ones are in your context.',
  )
})

test('a long message is cut, and read alone shows more of it', async () => {
  const c = conversation()
  c.user(`Here is the brief: ${'tide '.repeat(2_000)}END`)
  c.user('And another one.')
  const kept = c.assistant([{ type: 'text', text: 'Got both.' }])
  c.session.appendCompaction('Two briefs.', kept, 10_000)
  const several = await invoke(c.session, { from: 1, count: 5 })
  expect(several).toContain('more characters cut; read this message alone to see more]')
  expect(several).toContain('#2 · user')
  const alone = await invoke(c.session, { from: 1, count: 1 })
  expect(alone).toContain('END')
  expect(alone).not.toContain('cut')
})

test('a summary made during the turn is recalled at once, and the latest one counts', async () => {
  const c = compacted()
  const tool = recallTool({ branch: () => c.session.getBranch(), secrets: [] })
  const asked = c.user('Draft the follow-up.')
  c.assistant([{ type: 'text', text: 'Follow-up drafted.' }])
  // A second compaction, made after the tool was given: the question about the link is now
  // summarized too.
  c.session.appendCompaction('Later on, a follow-up was drafted.', asked, 30_000)
  const found = (await tool.invoke({ query: 'link again' })) as string
  expect(found).toContain('#7 · user')
  expect(found).toContain('of the 7 summarized messages')
})

test('a call without a query or a number, or with a wrong count, is refused', async () => {
  const { session } = compacted()
  await expect(invoke(session, {})).rejects.toThrow('give `query` to search or `from` to read')
  await expect(invoke(session, { query: 'a' })).rejects.toThrow('at least two characters')
  await expect(invoke(session, { from: 1, count: 30 })).rejects.toThrow('`count` is from 1 to 20')
})

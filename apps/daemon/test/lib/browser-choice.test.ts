// Which browser, chosen in the conversation (BAZ-102): the setting is the default, `browser_use`
// switches for the conversation, and moving to the operator's Chrome waits for their approval.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandApproval } from '@bazilion/api-types'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { resolveBrowserConfig } from '../../src/lib/browser/config.ts'
import { conversationBrowserChoice, createBrowserHost } from '../../src/lib/browser/host.ts'
import { browserGuideSection } from '../../src/runtime/session/browser-guide.ts'
import { browserChoiceIn, browserTools } from '../../src/runtime/tools/browser.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'

const calls: Array<{ action: string; attach: boolean }> = []
vi.mock('../../src/lib/browser/pool.ts', () => ({
  invokeBrowserAction: async (
    _agentId: string,
    action: string,
    _args: unknown,
    config: { attach: boolean },
  ) => {
    calls.push({ action, attach: config.attach })
    return [{ type: 'text', text: 'ok' }]
  },
}))

const roots: string[] = []
beforeEach(() => {
  calls.length = 0
})
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-browser-choice-'))
  roots.push(root)
  return resolvePaths(root)
}

/** An approval that settles as the operator answers. */
function gate(answer: CommandApproval['status']) {
  const asked: string[] = []
  return {
    asked,
    askYours: (request: { toolCallId: string }) => {
      asked.push(request.toolCallId)
      const approval = { id: 'a1', status: 'pending' } as CommandApproval
      return { approval, settled: Promise.resolve({ ...approval, status: answer }) }
    },
  }
}

test('moving to your Chrome waits for you; allowed, the conversation works there', async () => {
  const { asked, askYours } = gate('allowed')
  const host = createBrowserHost(resolveBrowserConfig({}), {
    agentId: 'agent-1',
    paths: paths(),
    askYours,
  })
  await host.invoke('agent-1', 'snapshot', {})
  const shown: CommandApproval[] = []
  const said = await host.use?.('yours', {
    toolCallId: 'call-1',
    onApproval: (approval) => shown.push(approval),
  })
  expect(asked).toEqual(['call-1'])
  expect(shown.map((approval) => approval.status)).toEqual(['pending', 'allowed'])
  expect(said?.text).toContain("the user's running Chrome")
  // The switch is recorded with the operator's approval.
  expect(said).toMatchObject({ switched: true, approved: true })
  await host.invoke('agent-1', 'snapshot', {})
  // Its own browser first; then your Chrome is reached at once, and used from then on.
  expect(calls).toEqual([
    { action: 'snapshot', attach: false },
    { action: 'tabs', attach: true },
    { action: 'snapshot', attach: true },
  ])
  // Back to its own browser needs nothing.
  await host.use?.('own')
  await host.invoke('agent-1', 'snapshot', {})
  expect(calls.at(-1)).toEqual({ action: 'snapshot', attach: false })
  expect(asked).toEqual(['call-1'])
})

test('denied, or nobody to ask, it keeps its own browser', async () => {
  const { askYours } = gate('denied')
  const host = createBrowserHost(resolveBrowserConfig({}), {
    agentId: 'agent-1',
    paths: paths(),
    askYours,
  })
  await expect(host.use?.('yours')).rejects.toThrow(/did not allow/)
  await host.invoke('agent-1', 'snapshot', {})
  expect(calls).toEqual([{ action: 'snapshot', attach: false }])

  const unattended = createBrowserHost(resolveBrowserConfig({}), { agentId: 'a', paths: paths() })
  await expect(unattended.use?.('yours')).rejects.toThrow(/approval/)
})

test('with your Chrome as the default, nothing is asked; a conversation keeps its own choice', async () => {
  const { asked, askYours } = gate('denied')
  const host = createBrowserHost(resolveBrowserConfig({ BROWSER_ATTACH: 'true' }), {
    agentId: 'agent-1',
    paths: paths(),
    askYours,
  })
  await host.invoke('agent-1', 'snapshot', {})
  await host.use?.('own')
  // Back to the default: nothing asked, so nothing approved is recorded.
  expect(await host.use?.('yours')).toMatchObject({ switched: true, approved: false })
  expect(asked).toEqual([])

  // A conversation that switched earlier starts its next turn where it left off.
  const chosen = createBrowserHost(resolveBrowserConfig({ BROWSER_ATTACH: 'true' }), {
    agentId: 'agent-1',
    paths: paths(),
    chosen: 'own',
  })
  calls.length = 0
  await chosen.invoke('agent-1', 'snapshot', {})
  expect(calls).toEqual([{ action: 'snapshot', attach: false }])
})

test('the choice is read back from the conversation: its latest switch that went through', () => {
  expect(browserChoiceIn([], 'own')).toBe('own')
  expect(browserChoiceIn([], 'yours')).toBe('yours')
  const result = (browser: string, isError = false, approved = true) => ({
    role: 'toolResult',
    toolName: 'browser_use',
    isError,
    details: { browser, ...(approved ? { approved: true } : {}) },
  })
  expect(browserChoiceIn([result('yours'), result('own')], 'own')).toBe('own')
  expect(browserChoiceIn([result('yours'), result('own', true)], 'own')).toBe('yours')
  // A move to the operator's Chrome made without asking, while it was the default, does not
  // outlive that default.
  expect(browserChoiceIn([result('yours', false, false)], 'yours')).toBe('yours')
  expect(browserChoiceIn([result('yours', false, false)], 'own')).toBe('own')
  // Asking for the browser it was already in records nothing.
  expect(browserChoiceIn([result('yours'), { ...result('own'), details: {} }], 'own')).toBe('yours')

  const home = paths()
  const dir = join(home.agentDir('agent-1'), 'sessions')
  mkdirSync(dir, { recursive: true })
  const target = seedConversationTarget(dir, home.home)
  const session = SessionManager.open(join(dir, `${target.id}.jsonl`), dir, home.home)
  session.appendMessage({ role: 'user', content: 'use my Chrome', timestamp: 1 })
  session.appendMessage({
    role: 'toolResult',
    toolCallId: 'c1',
    toolName: 'browser_use',
    content: [{ type: 'text', text: 'now yours' }],
    details: { browser: 'yours', approved: true },
    isError: false,
    timestamp: 2,
  })
  expect(conversationBrowserChoice(home, 'agent-1', target.id, 'own')).toBe('yours')
  expect(conversationBrowserChoice(home, 'agent-1', 'missing', 'own')).toBe('own')
})

test('browser_use is the model’s own tool, and the guide says when to switch', async () => {
  const used: string[] = []
  const tools = browserTools(
    {
      invoke: async () => [],
      use: async (browser) => {
        used.push(browser)
        return { text: 'switched', switched: used.length === 1, approved: true }
      },
    },
    'agent-1',
  )
  const use = tools.find((tool) => tool.def.name === 'browser_use')
  expect(use?.reach).toBe('model-only')
  expect(await use?.invoke({ browser: 'yours' }, { toolCallId: 'c1' })).toEqual({
    content: [{ type: 'text', text: 'switched' }],
    details: { browser: 'yours', approved: true },
  })
  // Already there: nothing to record.
  expect(await use?.invoke({ browser: 'yours' }, { toolCallId: 'c2' })).toMatchObject({
    details: {},
  })
  expect(used).toEqual(['yours', 'yours'])
  // Without a way to switch (a review), there is no tool.
  expect(
    browserTools({ invoke: async () => [] }, 'a').some((t) => t.def.name === 'browser_use'),
  ).toBe(false)
  expect(browserGuideSection(false, { byDefault: 'own' })).toContain('switch with `browser_use`')
  expect(browserGuideSection(false)).not.toContain('browser_use')
})

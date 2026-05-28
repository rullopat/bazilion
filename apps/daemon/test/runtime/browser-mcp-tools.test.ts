import { expect, test } from 'vitest'
import {
  extractToolResultImages,
  extractToolResultText,
  piMessagesToProviderView,
} from '../../src/runtime/pi/events.ts'
import { browserTools } from '../../src/runtime/tools/browser.ts'
import { mcpProxyTools } from '../../src/runtime/tools/mcp.ts'
import { createToolRegistry } from '../../src/runtime/tools/registry.ts'
import type { ToolResultPart } from '../../src/runtime/tools/types.ts'
import type { BrowserHost, McpHost } from '../../src/runtime/worker/ipc-protocol.ts'

test('browserTools proxy every action to the host with the agentId', async () => {
  const calls: Array<{ agentId: string; action: string; args: Record<string, unknown> }> = []
  const host: BrowserHost = {
    async invoke(agentId, action, args) {
      calls.push({ agentId, action, args })
      return [{ type: 'text', text: 'ok' }]
    },
  }
  const reg = createToolRegistry(browserTools(host, 'agent-1'))
  const names = reg.list().map((d) => d.name)
  expect(names).toContain('browser_navigate')
  expect(names).toContain('browser_snapshot')
  expect(names).toContain('browser_take_screenshot')

  const out = await reg.invoke('browser_navigate', JSON.stringify({ url: 'https://example.com' }))
  expect(out).toEqual([{ type: 'text', text: 'ok' }])
  expect(calls).toEqual([
    { agentId: 'agent-1', action: 'navigate', args: { url: 'https://example.com' } },
  ])
})

test('browser_click maps to the click action', async () => {
  const calls: string[] = []
  const host: BrowserHost = {
    async invoke(_agentId, action) {
      calls.push(action)
      return [{ type: 'text', text: '' }]
    },
  }
  const reg = createToolRegistry(browserTools(host, 'a'))
  await reg.invoke('browser_click', JSON.stringify({ ref: 'e5' }))
  expect(calls).toEqual(['click'])
})

test('mcpProxyTools route to (serverId, rawName) and expose the namespaced name', async () => {
  const calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = []
  const host: McpHost = {
    async invoke(serverId, toolName, args) {
      calls.push({ serverId, toolName, args })
      return [{ type: 'text', text: 'done' }]
    },
  }
  const reg = createToolRegistry(
    mcpProxyTools(host, [
      {
        toolName: 'mcp__gh__search',
        serverId: 'srv-1',
        rawName: 'search',
        description: 'Search GitHub',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ]),
  )
  expect(reg.has('mcp__gh__search')).toBe(true)
  const out = await reg.invoke('mcp__gh__search', JSON.stringify({ q: 'bug' }))
  expect(out).toEqual([{ type: 'text', text: 'done' }])
  expect(calls).toEqual([{ serverId: 'srv-1', toolName: 'search', args: { q: 'bug' } }])
})

test('extractToolResultImages pulls image blocks, text helper keeps text', () => {
  const content: ToolResultPart[] = [
    { type: 'text', text: 'before' },
    { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    { type: 'text', text: 'after' },
  ]
  const result = { content, details: {} }
  expect(extractToolResultText(result)).toBe('beforeafter')
  expect(extractToolResultImages(result)).toEqual([{ data: 'AAAA', mimeType: 'image/png' }])
})

test('extractToolResultImages returns [] when there are no images', () => {
  expect(extractToolResultImages({ content: [{ type: 'text', text: 'x' }], details: {} })).toEqual(
    [],
  )
})

test('piMessagesToProviderView carries tool-result images into the persisted view', () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal pi AgentMessage shape for the test
  const messages: any[] = [
    {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'browser_take_screenshot',
      content: [
        { type: 'text', text: 'Screenshot of https://example.com' },
        { type: 'image', data: 'PNGDATA', mimeType: 'image/png' },
      ],
    },
  ]
  const out = piMessagesToProviderView(messages)
  expect(out).toHaveLength(1)
  expect(out[0]?.role).toBe('tool')
  expect(out[0]?.content).toBe('Screenshot of https://example.com')
  expect(out[0]?.images).toEqual([{ data: 'PNGDATA', mimeType: 'image/png' }])
})

test('piMessagesToProviderView omits images when a tool returns none', () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal pi AgentMessage shape for the test
  const messages: any[] = [
    {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'web_fetch',
      content: [{ type: 'text', text: 'hi' }],
    },
  ]
  const out = piMessagesToProviderView(messages)
  expect(out[0]?.images).toBeUndefined()
})

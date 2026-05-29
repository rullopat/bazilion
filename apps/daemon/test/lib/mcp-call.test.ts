// Unit test for callMcpTool's result mapping. We seed the connection pool with
// a fake client so no real MCP subprocess is spawned — the focus is the
// content-block → ToolResultPart translation (text / image / resource / error).

import { afterEach, expect, test } from 'vitest'
import { callMcpTool, type McpServerConfig } from '../../src/lib/mcp/pool.ts'
import { resources, shutdownResources } from '../../src/lib/resources.ts'

const SERVER: McpServerConfig = {
  id: 'srv-1',
  name: 'fake',
  transport: 'stdio',
  command: 'noop',
  args: [],
  url: null,
}

function seed(callToolResult: unknown) {
  resources().mcp.set(SERVER.id, {
    serverId: SERVER.id,
    name: SERVER.name,
    lastUsedAt: Date.now(),
    idleMs: 60_000,
    // biome-ignore lint/suspicious/noExplicitAny: test double for the MCP client
    client: { callTool: async () => callToolResult } as any,
    // biome-ignore lint/suspicious/noExplicitAny: test double for the transport
    transport: {} as any,
    tools: [],
    async close() {},
  })
}

afterEach(async () => {
  await shutdownResources()
})

const opts = { env: {}, idleMs: 60_000 }

test('maps text + image content blocks', async () => {
  seed({
    content: [
      { type: 'text', text: 'hello' },
      { type: 'image', data: 'BBBB', mimeType: 'image/png' },
    ],
  })
  const parts = await callMcpTool(SERVER, 'foo', {}, opts)
  expect(parts).toEqual([
    { type: 'text', text: 'hello' },
    { type: 'image', data: 'BBBB', mimeType: 'image/png' },
  ])
})

test('maps embedded resource text', async () => {
  seed({ content: [{ type: 'resource', resource: { uri: 'file://x', text: 'body' } }] })
  const parts = await callMcpTool(SERVER, 'foo', {}, opts)
  expect(parts).toEqual([{ type: 'text', text: 'body' }])
})

test('throws on isError, surfacing the text content', async () => {
  seed({ isError: true, content: [{ type: 'text', text: 'boom' }] })
  await expect(callMcpTool(SERVER, 'foo', {}, opts)).rejects.toThrow(/boom/)
})

test('empty content yields a placeholder part', async () => {
  seed({ content: [] })
  const parts = await callMcpTool(SERVER, 'foo', {}, opts)
  expect(parts).toEqual([{ type: 'text', text: '(no content)' }])
})

// Pi client / loopback Streamable HTTP composition; no fake pooled SDK objects.
import { afterEach, expect, test } from 'vitest'
import { callMcpTool, type McpServerConfig } from '../../src/lib/mcp/pool.ts'
import { shutdownResources } from '../../src/lib/resources.ts'
import { mcpHttpFixture } from '../fixtures/mcp-http.ts'

const fixtures: Awaited<ReturnType<typeof mcpHttpFixture>>[] = []
afterEach(async () => {
  await shutdownResources()
  for (const f of fixtures.splice(0)) await f.close()
})
async function invoke(result: unknown) {
  const f = await mcpHttpFixture()
  fixtures.push(f)
  f.setResponse(result)
  const server: McpServerConfig = {
    id: f.url,
    name: 'fake',
    transport: 'http',
    command: null,
    args: [],
    url: f.url,
  }
  return callMcpTool(server, 'foo', {}, { env: {}, idleMs: 60_000 })
}
test('maps text + image content blocks', async () => {
  expect(
    await invoke({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'BBBB', mimeType: 'image/png' },
      ],
    }),
  ).toEqual([
    { type: 'text', text: 'hello' },
    { type: 'image', data: 'BBBB', mimeType: 'image/png' },
  ])
})
test('maps embedded resource text', async () => {
  expect(
    await invoke({ content: [{ type: 'resource', resource: { uri: 'file://x', text: 'body' } }] }),
  ).toEqual([{ type: 'text', text: 'body' }])
})
test('server error is an error, not success or a replay; remote secrets are not exposed', async () => {
  await expect(
    invoke({ isError: true, content: [{ type: 'text', text: 'PRIVATE_FIXTURE_TOKEN' }] }),
  ).rejects.toThrow(/may have taken effect.*Not replayed/)
  expect(fixtures[0]?.requests.filter((r) => r.method === 'tools/call')).toHaveLength(1)
})
test('empty content yields a placeholder part', async () => {
  expect(await invoke({ content: [] })).toEqual([{ type: 'text', text: '(no content)' }])
})
test('structured content and embedded images use Pi multimodal projection', async () => {
  expect(await invoke({ structuredContent: { answer: 42 } })).toEqual([
    { type: 'text', text: JSON.stringify({ answer: 42 }, null, 2) },
  ])
  expect(
    await invoke({
      content: [
        { type: 'resource', resource: { uri: 'file://x', blob: 'AAAA', mimeType: 'image/png' } },
      ],
    }),
  ).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }])
})

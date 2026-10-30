import { McpClient } from '@earendil-works/pi-mcp'
import { createInMemoryTransportPair } from '@earendil-works/pi-mcp/testing'
import { expect, test, vi } from 'vitest'
import { retainTransport, retireMcpClient } from '../../src/lib/mcp/retirement.ts'
import { OwnedStdioTransport } from '../../src/lib/mcp/stdio-owner.ts'

test('retirement diagnostics disclose only owned stdio phase, never raw SDK close errors', async () => {
  const client = new McpClient({ name: 'fixture', version: '1' })
  const transport = new OwnedStdioTransport({ command: '/must-not-start' })
  const close = vi
    .spyOn(transport, 'close')
    .mockRejectedValue(new Error('SYNTHETIC_BEARER /private/fixture/url'))
  try {
    const failure = await retireMcpClient(client, transport).then(
      () => undefined,
      (error) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toBe(
      'MCP retirement incomplete; ownership retained (stdio phase: idle)',
    )
    expect(failure.message).not.toContain('SYNTHETIC_BEARER')
    expect(failure).not.toHaveProperty('cause')
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    close.mockRestore()
  }
})

test.each([
  false,
  true,
])('initialization failure cannot release pending/rejected transport cleanup (reject=%s)', async (rejectCleanup) => {
  const pair = createInMemoryTransportPair()
  await pair.server.start()
  pair.server.onMessage((message) => {
    if ('id' in message && 'method' in message)
      void pair.server.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 'unsupported',
          capabilities: {},
          serverInfo: { name: 'fixture', version: '1' },
        },
      })
  })
  let finish!: () => void
  let fail!: (e: Error) => void
  const cleanup = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  const realClose = pair.client.close.bind(pair.client)
  let closeCalls = 0
  pair.client.close = () => {
    closeCalls++
    return cleanup
  }
  const transport = retainTransport(pair.client)
  const client = new McpClient({ name: 'fixture', version: '1' })
  let retirement: Promise<void> | undefined
  let released = false
  client.onClose(() => {
    retirement = retireMcpClient(client, transport)
    void retirement
      .then(() => {
        released = true
      })
      .catch(() => {})
  })
  const connecting = client.connect(transport)
  void connecting.catch(() => {})
  await vi.waitFor(() => expect(retirement).toBeDefined())
  expect(client.connectionState).toBe('closed')
  expect(released).toBe(false)
  expect(closeCalls).toBe(1)
  if (rejectCleanup) fail(new Error('cleanup refused'))
  else finish()
  if (rejectCleanup) {
    await expect(retirement).rejects.toThrow(/ownership retained/)
    expect(released).toBe(false)
  } else {
    await retirement
    expect(released).toBe(true)
  }
  await expect(connecting).rejects.toThrow()
  expect(closeCalls).toBe(1)
  pair.client.close = realClose
  await realClose()
  await pair.server.close()
})

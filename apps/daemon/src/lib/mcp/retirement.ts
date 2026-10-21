// Pi clears client.transport before awaiting close. Retain an independent shared
// transport retirement, including initialization failures and reentrant close listeners.
import type { McpClient, McpTransport } from '@earendil-works/pi-mcp'

export function retainTransport<T extends McpTransport>(transport: T): T {
  const close = transport.close.bind(transport)
  let closing: Promise<void> | undefined
  transport.close = () => {
    closing ??= Promise.resolve().then(close)
    return closing
  }
  return transport
}
export async function retireMcpClient(client: McpClient, transport?: McpTransport): Promise<void> {
  const outcomes = await Promise.allSettled([client.close(), transport?.close()])
  if (outcomes.some((o) => o.status === 'rejected'))
    throw new Error('MCP retirement incomplete; ownership retained')
}

// A small stdio MCP server for the browser tests (BAZ-100): Paperboat's releases. It speaks
// newline-delimited JSON-RPC as MCP's stdio transport does, and answers from fixed data.

import { createInterface } from 'node:readline'

const RELEASES = {
  2.4: 'Paperboat 2.4 (2026-11-20): dark mode, and notes that sync while offline.',
  2.3: 'Paperboat 2.3 (2026-10-02): shared notebooks.',
}

const TOOLS = [
  {
    name: 'release_list',
    description: 'List the Paperboat releases, newest first.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'release_lookup',
    description: 'Look up one Paperboat release: its date and its release notes.',
    inputSchema: {
      type: 'object',
      properties: { version: { type: 'string', description: 'Such as "2.4".' } },
      required: ['version'],
    },
    annotations: { readOnlyHint: true },
  },
]

function call(name, args) {
  if (name === 'release_list') return Object.keys(RELEASES).join(', ')
  if (name === 'release_lookup') return RELEASES[String(args?.version)] ?? 'No such release.'
  throw new Error(`unknown tool ${name}`)
}

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = request
  if (id === undefined) return // a notification
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'releases', version: '1.0.0' },
        },
      })
    case 'ping':
      return send({ id, result: {} })
    case 'tools/list':
      return send({ id, result: { tools: TOOLS } })
    case 'tools/call':
      try {
        return send({
          id,
          result: { content: [{ type: 'text', text: call(params?.name, params?.arguments) }] },
        })
      } catch (error) {
        return send({
          id,
          result: { isError: true, content: [{ type: 'text', text: String(error) }] },
        })
      }
    default:
      return send({ id, error: { code: -32601, message: `no method ${method}` } })
  }
})

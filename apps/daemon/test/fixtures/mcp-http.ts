// Local MCP fixture, not a production server or a hosted/account trial.

import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export interface FixtureTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}
export const fixtureTool: FixtureTool = {
  name: 'foo',
  description: 'fixture',
  inputSchema: { type: 'object', properties: {} },
}
export async function mcpHttpFixture() {
  let tools = [fixtureTool]
  let response: unknown = { content: [{ type: 'text', text: 'hello' }] }
  let status = 200
  let redirect: string | undefined
  let delayMethod: string | undefined
  let release: (() => void) | undefined
  let session = 'fixture-session'
  let restarts = 0
  const streams = new Set<ServerResponse>()
  const requests: Array<{
    method: string
    params?: Record<string, unknown>
    authorization?: string
    session?: string
  }> = []
  // A restarted server no longer knows the session it handed out before.
  const unknownSession = (req: IncomingMessage) =>
    req.headers['mcp-session-id'] !== undefined && req.headers['mcp-session-id'] !== session
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') {
      if (unknownSession(req)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': fixture stream\n\n')
      streams.add(res)
      res.on('close', () => streams.delete(res))
      return
    }
    if (req.method === 'DELETE') {
      requests.push({ method: 'DELETE' })
      res.writeHead(204).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c)
    const msg = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({
      method: msg.method,
      params: msg.params,
      authorization: req.headers.authorization,
      session: req.headers['mcp-session-id'] as string | undefined,
    })
    if (unknownSession(req)) {
      res.writeHead(404).end()
      return
    }
    if (msg.method === delayMethod)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    if (res.destroyed) return
    if (msg.id === undefined) {
      res.writeHead(202).end()
      return
    }
    let result: unknown
    if (msg.method === 'initialize') {
      result = {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'fixture', version: '1' },
      }
    } else if (msg.method === 'tools/list') {
      // Every catalog is two pages, exercising continuation through the Pi request API.
      result =
        msg.params?.cursor === 'second'
          ? { tools: tools.slice(1) }
          : { tools: tools.slice(0, 1), nextCursor: 'second' }
    } else if (msg.method === 'tools/call') {
      if (redirect) {
        res.writeHead(307, { location: redirect }).end()
        return
      }
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'text/plain' }).end('fixture refused')
        return
      }
      result = response
    } else {
      result = {}
    }
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': session })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing fixture listener')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    setResponse(value: unknown) {
      response = value
    },
    setStatus(value: number) {
      status = value
    },
    setRedirect(value: string) {
      redirect = value
    },
    delay(method: string) {
      delayMethod = method
    },
    release() {
      delayMethod = undefined
      release?.()
      release = undefined
    },
    async changeTools(value: FixtureTool[]) {
      tools = value
      for (const stream of streams)
        stream.write(
          `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\n`,
        )
    },
    get streamCount() {
      return streams.size
    },
    /** Forget the session and drop the open streams, as a restarted server would. */
    restart() {
      session = `fixture-session-${++restarts}`
      for (const stream of streams) stream.destroy()
    },
    async close() {
      release?.()
      for (const stream of streams) stream.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

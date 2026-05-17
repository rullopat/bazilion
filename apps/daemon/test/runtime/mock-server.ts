import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export interface MockServer {
  url: string
  stop(): Promise<void>
}

/**
 * Starts a node:http server on an ephemeral port that adapts Node's
 * (req, res) to the Fetch-API Request/Response shape, then dispatches to the
 * provided handler. Lets tests keep Request/Response handler code.
 */
export function startMockServer(
  handler: (req: Request) => Response | Promise<Response>,
): Promise<MockServer> {
  const server = createServer((nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const chunks: Buffer[] = []
    nodeReq.on('data', (c: Buffer) => chunks.push(c))
    nodeReq.on('end', async () => {
      try {
        const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : undefined
        const addr = server.address()
        const hostHeader =
          nodeReq.headers.host ??
          (addr && typeof addr !== 'string' ? `localhost:${addr.port}` : 'localhost')
        const url = `http://${hostHeader}${nodeReq.url ?? '/'}`
        const headerEntries: [string, string][] = []
        for (const [k, v] of Object.entries(nodeReq.headers)) {
          if (typeof v === 'string') headerEntries.push([k, v])
          else if (Array.isArray(v)) headerEntries.push([k, v.join(', ')])
        }
        const method = nodeReq.method ?? 'GET'
        const req = new Request(url, {
          method,
          headers: headerEntries,
          body: method === 'GET' || method === 'HEAD' ? undefined : bodyBuf,
        })
        const res = await handler(req)
        const outHeaders: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          outHeaders[k] = v
        })
        nodeRes.writeHead(res.status, outHeaders)
        if (res.body) {
          nodeRes.end(Buffer.from(await res.arrayBuffer()))
        } else {
          nodeRes.end()
        }
      } catch (err) {
        nodeRes.writeHead(500, { 'content-type': 'text/plain' })
        nodeRes.end(`mock handler error: ${(err as Error).message}`)
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('unexpected server address')
      resolve({
        url: `http://localhost:${addr.port}`,
        stop: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

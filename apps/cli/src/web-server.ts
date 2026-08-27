import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

const host = process.env.WEB_HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.WEB_PORT ?? '4322', 10)
const webDist = process.env.BAZILION_WEB_DIST ?? join(import.meta.dirname, 'web')
const clientDir = join(webDist, 'client')
const serverEntry = join(webDist, 'server', 'server.js')

if (process.env.BAZILION_PUBLIC_ORIGIN && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('BAZILION_PUBLIC_ORIGIN requires the web server to bind loopback only')
  process.exit(1)
}

if (!existsSync(clientDir) || !existsSync(serverEntry)) {
  console.error('error: bundled bazilion web UI not found')
  console.error(`  expected client assets at ${clientDir}`)
  console.error(`  expected server entry at ${serverEntry}`)
  process.exit(1)
}

const serverModule = (await import(pathToFileURL(serverEntry).href)) as {
  default: { fetch: (request: Request) => Promise<Response> }
}

const app = new Hono()

// TanStack Start emits browser assets under dist/client. Serve those directly,
// then hand every app/API route to the bundled Start fetch handler.
app.use('/assets/*', serveStatic({ root: clientDir }))
app.use('/baziu.svg', serveStatic({ root: clientDir }))
app.all('*', (c) => serverModule.default.fetch(c.req.raw))

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`bazilion web UI listening at http://${info.address}:${info.port}`)
})

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`\nbazilion web UI caught ${signal}, shutting down...`)
  server.close((err) => {
    if (err) {
      console.error('web UI shutdown error:', err)
      process.exit(1)
    }
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

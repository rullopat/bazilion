// Daemon entry point. Reads HOST/PORT env, boots the Hono app, and waits on
// SIGINT/SIGTERM for shutdown.
//
// This process is the single owner of `~/.bazilion`. The web app, CLI, and
// mobile clients all talk to it over HTTP via @bazilion/client.

import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { getCtx } from './lib/ctx.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '4321', 10)

// Eagerly bootstrap ~/.bazilion (mkdir, openDb, runMigrations, mint token,
// write auth.json) before binding the port. Otherwise the first request
// would race with bootstrap and the operator wouldn't see the bootstrap
// message until something actually hits the daemon.
getCtx()

const app = createApp()

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`bazilion daemon listening at http://${info.address}:${info.port}`)
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.error('')
    console.error(`⚠ binding to ${host} — the daemon is now reachable beyond loopback.`)
    console.error('  anyone on this network who has a valid token can reach every API.')
    console.error('  put a TLS proxy in front for untrusted networks.')
    console.error('')
  }
})

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`\nbazilion daemon caught ${signal}, shutting down…`)
  server.close((err) => {
    if (err) {
      console.error('shutdown error:', err)
      process.exit(1)
    }
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

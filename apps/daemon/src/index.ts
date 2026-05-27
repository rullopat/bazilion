// Daemon entry point. Reads HOST/PORT env, boots the Hono app, and waits on
// SIGINT/SIGTERM for shutdown.
//
// This process is the single owner of `~/.bazilion`. The web app, CLI, and
// mobile clients all talk to it over HTTP via @bazilion/client.

import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { getCtx } from './lib/ctx.ts'
import {
  isTelegramBotRunning,
  maybeStartTelegramBot,
  setTelegramAuthToken,
  stopTelegramBot,
} from './lib/telegram/bot.ts'

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
  // Background bot boot. Errors are logged but never crash the daemon — the
  // user can fix credentials via the web UI even if the bot can't start.
  const { db, authToken } = getCtx()
  setTelegramAuthToken(authToken)
  maybeStartTelegramBot(db, authToken).catch((err) => {
    console.error('telegram: background start failed:', err instanceof Error ? err.message : err)
  })
})

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`\nbazilion daemon caught ${signal}, shutting down…`)
  // Stop the telegram bot before HTTP server close — the in-flight getUpdates
  // long-poll can hold us for up to ~25s, so we run it in parallel with the
  // server's connection drain. The DB stays open until process.exit so any
  // late watermark writes from the poll loop don't crash on a closed handle.
  const botStop = isTelegramBotRunning()
    ? stopTelegramBot().catch((e) =>
        console.error('telegram: stop on shutdown failed:', e instanceof Error ? e.message : e),
      )
    : Promise.resolve()
  Promise.race([
    botStop,
    new Promise((r) => setTimeout(r, 30_000)), // hard cap: don't wait forever
  ]).finally(() => {
    server.close((err) => {
      if (err) {
        console.error('shutdown error:', err)
        process.exit(1)
      }
      process.exit(0)
    })
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

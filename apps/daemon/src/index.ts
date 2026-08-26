// Daemon entry point. Reads HOST/PORT env, boots the Hono app, and waits on
// SIGINT/SIGTERM for shutdown.
//
// This process is the single owner of `~/.bazilion`. The web app, CLI, and
// mobile clients all talk to it over HTTP via @bazilion/client.

import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { resolvePaths } from './core/index.ts'
import { closeCtxForShutdown, getCtx } from './lib/ctx.ts'
import { acquireDaemonLiveness } from './lib/daemon-liveness.ts'
import { isLoopbackHost, resolvePublicOrigin } from './lib/public-origin.ts'
import { shutdownResources } from './lib/resources.ts'
import {
  isTelegramBotRunning,
  maybeStartTelegramBot,
  setTelegramAuthToken,
  stopTelegramBot,
} from './lib/telegram/bot.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '4321', 10)
const publicOrigin = resolvePublicOrigin()
if (publicOrigin.production && !isLoopbackHost(host)) {
  console.error('BAZILION_PUBLIC_ORIGIN requires the daemon to bind loopback only')
  process.exit(1)
}

// Claim the home before bootstrap opens SQLite. This closes the startup race
// where an offline restore or second daemon could otherwise begin while the
// first process already held a DB handle but had not bound its HTTP port yet.
let daemonLiveness: ReturnType<typeof acquireDaemonLiveness>
try {
  daemonLiveness = acquireDaemonLiveness(resolvePaths())
} catch (error) {
  console.error(
    'failed to acquire daemon ownership:',
    error instanceof Error ? error.message : error,
  )
  process.exit(1)
}
// Eagerly bootstrap ~/.bazilion (mkdir, openDb, runMigrations, mint token,
// write auth.json) before binding the port. Otherwise the first request
// would race with bootstrap and the operator wouldn't see the bootstrap
// message until something actually hits the daemon.
getCtx()

const app = createApp()
let shuttingDown = false

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`bazilion daemon listening at http://${info.address}:${info.port}`)
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.error('')
    console.error(`⚠ binding to ${host} — the daemon is now reachable beyond loopback.`)
    console.error('  anyone on this network who has a valid token can reach every API.')
    console.error('  put a TLS proxy in front for untrusted networks.')
    console.error('')
  }
  try {
    daemonLiveness.publishEndpoint({ host, port: info.port })
  } catch (error) {
    console.error(
      'failed to publish daemon liveness record:',
      error instanceof Error ? error.message : error,
    )
    server.close(() => process.exit(1))
    return
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
  if (shuttingDown) return
  shuttingDown = true
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
  // Close long-lived resources (browser sessions, MCP connections) in parallel
  // with the bot stop. Best-effort — never block shutdown on them.
  const resourcesStop = shutdownResources().catch((e) =>
    console.error('resources: shutdown failed:', e instanceof Error ? e.message : e),
  )
  Promise.race([
    Promise.all([botStop, resourcesStop]),
    new Promise((r) => setTimeout(r, 30_000)), // hard cap: don't wait forever
  ]).finally(() => {
    server.close((err) => {
      if (err) {
        console.error('shutdown error:', err)
        process.exit(1)
      }
      try {
        // Release ownership only after the sole SQLite handle is closed, then
        // exit without yielding so no background callback can touch the DB in
        // the unlock-before-death interval.
        closeCtxForShutdown()
        daemonLiveness.stop()
      } catch (closeError) {
        console.error(
          'database shutdown error:',
          closeError instanceof Error ? closeError.message : closeError,
        )
        // Keep the ownership file when close fails. The dead PID makes it
        // reclaimable after exit without ever advertising an open DB as free.
        process.exit(1)
      }
      process.exit(0)
    })
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

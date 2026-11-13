// Daemon entry point. Reads HOST/PORT env, boots the Hono app, and waits on
// SIGINT/SIGTERM for shutdown.
//
// This process is the single owner of `~/.bazilion`. The web app, CLI, and
// remote clients all talk to it over HTTP.

import { writeSync } from 'node:fs'
import { isLoopbackHost, publicOriginConfig } from '@bazilion/api-types'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { IncompatibleDatabaseError, resolvePaths } from './core/index.ts'
import { stopAgentTurns } from './lib/agent-cancel.ts'
import { closeCtxForShutdown, getCtx, IncompatibleBootstrapIdentityError } from './lib/ctx.ts'
import { claimDaemonPidFile } from './lib/daemon-liveness.ts'
import { startNotifications } from './lib/notifications.ts'
import { shutdownResources } from './lib/resources.ts'
import { startScheduler, stopScheduler } from './lib/scheduler.ts'
import { isTelegramBotRunning, maybeStartTelegramBot, stopTelegramBot } from './lib/telegram/bot.ts'
import { startUserQueuePump } from './lib/user-queue.ts'
import { homeContainerPrefix, removeDockerContainers } from './runtime/shell/docker.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '4321', 10)
const publicOrigin = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
if (publicOrigin.production && !isLoopbackHost(host)) {
  console.error('BAZILION_PUBLIC_ORIGIN requires the daemon to bind loopback only')
  process.exit(1)
}

// Write the pidfile before bootstrap opens SQLite, so a second daemon, a restore or an uninstall
// refuses this home even before the port is bound.
let releasePidFile: () => void
try {
  releasePidFile = claimDaemonPidFile(resolvePaths().home)
} catch (error) {
  console.error('bazilion daemon failed to start:', error instanceof Error ? error.message : error)
  process.exit(1)
}
// Sandbox containers a previous daemon of this home left running. No turn can start before this.
await removeDockerContainers(homeContainerPrefix(resolvePaths().home))
// Eagerly bootstrap ~/.bazilion (mkdir, openDb, initSchema, mint token,
// write auth.json) before binding the port. Otherwise the first request
// would race with bootstrap and the operator wouldn't see the bootstrap
// message until something actually hits the daemon.
try {
  getCtx()
} catch (error) {
  const detail =
    error instanceof IncompatibleDatabaseError ||
    error instanceof IncompatibleBootstrapIdentityError
      ? error.message
      : error instanceof Error
        ? (error.stack ?? error.message)
        : String(error)
  writeSync(process.stderr.fd, `bazilion daemon failed to start: ${detail}\n`)
  try {
    closeCtxForShutdown()
  } catch {
    // Bootstrap owns and closes a not-yet-published DB handle. This is only a
    // defensive cleanup in case a later startup step publishes one first.
  }
  releasePidFile()
  process.exit(1)
}

const app = createApp()
let shuttingDown = false
let queuePump: ReturnType<typeof startUserQueuePump> | undefined
let notificationPump: ReturnType<typeof startNotifications> | undefined

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`bazilion daemon listening at http://${info.address}:${info.port}`)
  if (!isLoopbackHost(host)) {
    console.error('')
    console.error(`⚠ binding to ${host} — the daemon is now reachable beyond loopback.`)
    console.error('  anyone on this network who has a valid token can reach every API.')
    console.error('  put a TLS proxy in front for untrusted networks.')
    console.error('')
  }
  // Background bot boot. Errors are logged but never crash the daemon — the
  // user can fix credentials via the web UI even if the bot can't start.
  const { db, authToken } = getCtx()
  if (process.env.BAZILION_SCHEDULER !== 'off') startScheduler()
  queuePump = startUserQueuePump()
  notificationPump = startNotifications(db)
  maybeStartTelegramBot(db, authToken).catch((err) => {
    console.error('telegram: background start failed:', err instanceof Error ? err.message : err)
  })
})

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return
  shuttingDown = true
  notificationPump?.stop()
  const schedulerStop = stopScheduler()
  const turnsStop = stopAgentTurns()
  const queueStop = queuePump?.stop() ?? Promise.resolve()
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
  // Settle the scheduler, the follow-up queue and registered workers while IPC hosts and the DB
  // remain available.
  const resourcesStop = Promise.all([schedulerStop, turnsStop, queueStop])
    .then(() => shutdownResources())
    .catch((e) => console.error('resources: shutdown failed:', e instanceof Error ? e.message : e))
  Promise.race([
    Promise.all([botStop, resourcesStop]),
    new Promise((r) => setTimeout(r, 30_000)), // hard cap: don't wait forever
  ]).finally(() => {
    // A request still open after the cap (a long compaction, say) must not keep the daemon up.
    if ('closeAllConnections' in server) server.closeAllConnections()
    server.close((err) => {
      if (err) {
        console.error('shutdown error:', err)
        process.exit(1)
      }
      try {
        closeCtxForShutdown()
      } catch (closeError) {
        console.error(
          'database shutdown error:',
          closeError instanceof Error ? closeError.message : closeError,
        )
        // The pidfile stays; its dead PID makes it stale once this process exits.
        process.exit(1)
      }
      // Release the home only after the SQLite handle is closed.
      releasePidFile()
      process.exit(0)
    })
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

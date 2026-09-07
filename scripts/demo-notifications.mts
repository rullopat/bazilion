// Disposable notification demo: node --import tsx scripts/demo-notifications.mts [--port N]
// All Telegram traffic is simulated. Stop with Ctrl-C; the printed fixture home is retained.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const index = process.argv.indexOf('--port')
const port = index < 0 ? 0 : Number(process.argv[index + 1])
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid demo port')
process.env.LMSTUDIO_URL = 'http://127.0.0.1:9'
process.env.BAZILION_HOME = mkdtempSync(join(tmpdir(), 'bazilion-notification-demo-'))
process.env.BAZILION_SCHEDULER = 'off'
process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
const { getCtx } = await import(`${root}/apps/daemon/src/lib/ctx.ts`)
const { seedDefaults } = await import(`${root}/apps/daemon/src/core/profile/seed.ts`)
const { createProfile } = await import(`${root}/apps/daemon/src/core/profile/create.ts`)
const { spawnAgent } = await import(`${root}/apps/daemon/src/core/agent/spawn.ts`)
const providers = await import(`${root}/apps/daemon/src/core/repos/providerState.ts`)
const models = await import(`${root}/apps/daemon/src/core/repos/providerModels.ts`)
const { createApp } = await import(`${root}/apps/daemon/src/app.ts`)
const { serve } = await import(`${root}/apps/daemon/node_modules/@hono/node-server/dist/index.mjs`)
const { openConfig, openSecrets } = await import(`${root}/apps/daemon/src/core/index.ts`)
const acl = await import(`${root}/apps/daemon/src/core/repos/telegram-acl.ts`)
const { installNotificationTransport } = await import(
  `${root}/apps/daemon/src/lib/telegram/notification-transport.ts`
)
const { startNotifications } = await import(`${root}/apps/daemon/src/lib/notifications.ts`)
const { db, paths, authToken } = getCtx()
providers.setEnabled(db, 'lmstudio', true)
models.replace(db, 'lmstudio', ['demo'])
seedDefaults(db, paths, { model: 'lmstudio:demo' })
createProfile(db, paths, {
  id: 'notices',
  defaultModel: 'lmstudio:demo',
  communicationDefaults: {
    userInput: true,
    userOutput: true,
    outsideTeamInput: false,
    outsideTeamOutput: false,
    peerDefault: 'allow_all',
  },
})
const agent = spawnAgent(db, paths, { profileId: 'notices', name: 'Notification demo Agent' })
const old = Date.now() - 10000
for (const id of ['review-notification-demo', 'review-uncertain-demo'])
  db.raw.run(
    `INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,next_attempt_at,last_error,created_at,updated_at)
    VALUES (?,?,'failed','manual',?,'PRIVATE_DEMO_ERROR',?,?)`,
    [id, agent.id, old, old, old],
  )
const botToken = '999999:notification-demo-fixture-only'
openSecrets(db, authToken).set('TELEGRAM_BOT_TOKEN', botToken)
openConfig(db).set('TELEGRAM_CHAT_ID', '-100123456789')
openConfig(db).set('TELEGRAM_SERVICE_TOPIC_ID', '7')
acl.add(db, { userId: 123, role: 'owner' })
let uncertainInjected = false
let message = 100
installNotificationTransport(() => ({
  db,
  authToken,
  botToken,
  verify: async () => true,
  send: async (_chat: number, _topic: number, text: string) => {
    if (text.includes('review-uncertain-demo') && !uncertainInjected) {
      uncertainInjected = true
      throw new Error('simulated ambiguous timeout')
    }
    return { message_id: ++message }
  },
}))
const app = createApp()
// The integration page's preflight is also simulated. No test route calls Telegram.
const fetch = (request: Request) =>
  request.method !== 'GET' && new URL(request.url).pathname.startsWith('/api/config/telegram')
    ? Response.json(
        { error: 'Telegram configuration is fixed in this simulated demo' },
        { status: 405 },
      )
    : new URL(request.url).pathname === '/api/config/telegram/health'
      ? Response.json({
          configured: true,
          preflight: {
            botUsername: 'demo_bot',
            chatTitle: 'Private demo',
            isForum: true,
            hasManageTopics: true,
            privacyModeOff: true,
            chatIsPrivate: true,
            memberCount: 2,
            ownerPresent: true,
          },
          error: null,
          polling: null,
        })
      : app.fetch(request)
const server = serve({ fetch, hostname: '127.0.0.1', port })
await new Promise<void>((resolve) =>
  server.listening ? resolve() : server.once('listening', resolve),
)
const address = server.address()
if (!address || typeof address === 'string') throw new Error('No listener')
const tokens = await import(`${root}/apps/daemon/src/core/repos/webTokens.ts`)
const token = tokens.create(db, 'notification-demo', { expiresAt: Date.now() + 3600000 }).token
const accessFile = join(paths.home, 'notification-demo-access.json')
writeFileSync(
  accessFile,
  JSON.stringify({
    base: `http://127.0.0.1:${address.port}`,
    token,
    home: paths.home,
    agentId: agent.id,
  }),
  { mode: 0o600 },
)
const pump = startNotifications(db, authToken)
console.log(`Demo daemon: http://127.0.0.1:${address.port}`)
console.log(`Owner-only browser device credential: ${accessFile}`)
console.log(
  'Start the web UI with BAZILION_DAEMON set to this URL. Open Configuration → Integrations → Telegram.',
)
const stop = () => {
  pump.stop()
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

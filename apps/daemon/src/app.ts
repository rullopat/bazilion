// Hono app factory.
//
// Returns a fully-wired Hono app: middleware (auth + first-run gate) +
// routes. Kept as a factory so tests can build one with a dedicated DB
// without touching the global ctx singleton.

import { Hono } from 'hono'
import { authMiddleware } from './lib/middleware-auth.ts'
import { agentsRouter } from './routes/agents.ts'
import { authRouter } from './routes/auth-login.ts'
import { configRouter } from './routes/config.ts'
import { groupsRouter } from './routes/groups.ts'
import { mcpRouter } from './routes/mcp.ts'
import { messagesRouter } from './routes/messages.ts'
import { miscRouter } from './routes/misc.ts'
import { profileGroupsRouter } from './routes/profile-groups.ts'
import { profilesRouter } from './routes/profiles.ts'
import { skillsRouter } from './routes/skills.ts'
import { telegramRouter } from './routes/telegram.ts'
import { triggersRouter } from './routes/triggers.ts'

export function createApp(): Hono {
  const app = new Hono()

  // Auth + first-run gate runs before every route. Public paths (/api/login,
  // /api/health) and the setup-open prefixes (/api/config, /api/auth) are
  // whitelisted inside the middleware itself.
  app.use('*', authMiddleware)

  app.route('/api/agents', agentsRouter)
  app.route('/api/groups', groupsRouter)
  app.route('/api/profile-groups', profileGroupsRouter)
  app.route('/api/profiles', profilesRouter)
  app.route('/api/skills', skillsRouter)
  app.route('/api/triggers', triggersRouter)
  app.route('/api/messages', messagesRouter)
  app.route('/api/mcp-servers', mcpRouter)
  // Mount the Telegram sub-router BEFORE /api/config so it claims the
  // /api/config/telegram* prefix — otherwise the generic configRouter's
  // /fields/:envVar handler would shadow our routes on the same prefix.
  app.route('/api/config/telegram', telegramRouter)
  app.route('/api/config', configRouter)
  // miscRouter exposes /backup, /tokens, /tokens/:id directly under /api —
  // mounted at the API root so each handler can use its full path.
  // authRouter likewise: /auth/openai*, /providers/test, /login.
  app.route('/api', miscRouter)
  app.route('/api', authRouter)

  return app
}

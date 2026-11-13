// The daemon's HTTP app: the auth and first-run gate, then one router per feature. Several
// routers share a prefix (/api/agents, /api/teams); each claims only its own sub-paths.

import { Hono } from 'hono'
import { authMiddleware } from './lib/middleware-auth.ts'
import { agentBrowserRouter } from './routes/agent-browser.ts'
import { agentChatRouter } from './routes/agent-chat.ts'
import { agentLearningRouter } from './routes/agent-learning.ts'
import { agentsRouter } from './routes/agents.ts'
import { attentionRouter } from './routes/attention.ts'
import { authRouter } from './routes/auth-login.ts'
import { configRouter } from './routes/config.ts'
import { conversationsRouter } from './routes/conversations.ts'
import { mcpRouter } from './routes/mcp.ts'
import { agentMessagesRouter, messagesRouter } from './routes/messages.ts'
import { miscRouter } from './routes/misc.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { profilesRouter } from './routes/profiles.ts'
import { questionsRouter } from './routes/questions.ts'
import { resultsRouter } from './routes/results.ts'
import { shellApprovalsRouter } from './routes/shell-approvals.ts'
import { agentSkillsRouter, skillsRouter } from './routes/skills.ts'
import { teamCodingEnvironmentRouter } from './routes/team-coding-environment.ts'
import { teamMemoryRouter } from './routes/team-memory.ts'
import { teamPolicyRouter } from './routes/team-policy.ts'
import { teamReviewRouter } from './routes/team-review.ts'
import { teamTemplatesRouter } from './routes/team-templates.ts'
import { teamsRouter } from './routes/teams.ts'
import { agentTelegramRouter, teamTelegramRouter, telegramRouter } from './routes/telegram.ts'
import { agentTriggersRouter, triggersRouter } from './routes/triggers.ts'
import { userQueueRouter } from './routes/user-queue.ts'

export function createApp(): Hono {
  const app = new Hono()

  // Auth + first-run gate runs before every route. Public paths (/api/login,
  // /api/health) and the setup-open configuration, auth, credential, and
  // provider-test paths are whitelisted inside the middleware itself.
  app.use('*', authMiddleware)
  // API responses are never cached unless a route says otherwise.
  app.use('/api/*', async (c, next) => {
    await next()
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store')
  })

  app.route('/api/agents', agentsRouter)
  app.route('/api/agents', agentChatRouter)
  app.route('/api/agents', agentBrowserRouter)
  app.route('/api/agents', agentLearningRouter)
  app.route('/api/agents', agentMessagesRouter)
  app.route('/api/agents', agentSkillsRouter)
  app.route('/api/agents', agentTelegramRouter)
  app.route('/api/agents', agentTriggersRouter)
  app.route('/api/agents', conversationsRouter)
  app.route('/api/agents', userQueueRouter)
  app.route('/api/agents', questionsRouter)
  app.route('/api/teams', teamsRouter)
  app.route('/api/teams', teamMemoryRouter)
  app.route('/api/teams', teamPolicyRouter)
  app.route('/api/teams', teamReviewRouter)
  app.route('/api/teams', teamCodingEnvironmentRouter)
  app.route('/api/teams', teamTelegramRouter)
  app.route('/api/team-templates', teamTemplatesRouter)
  app.route('/api/results', resultsRouter)
  app.route('/api/attention', attentionRouter)
  app.route('/api/notifications', notificationsRouter)
  app.route('/api/shell-approvals', shellApprovalsRouter)
  app.route('/api/profiles', profilesRouter)
  app.route('/api/skills', skillsRouter)
  app.route('/api/triggers', triggersRouter)
  app.route('/api/messages', messagesRouter)
  app.route('/api/mcp-servers', mcpRouter)
  // Mounted before /api/config so it claims /api/config/telegram*, which the generic
  // /fields/:envVar handler would otherwise shadow.
  app.route('/api/config/telegram', telegramRouter)
  app.route('/api/config', configRouter)
  // These two hold handlers under several top-level paths (/health, /backup, /tokens; /auth/*,
  // /providers/test, /login, /sessions), so they mount at the API root.
  app.route('/api', miscRouter)
  app.route('/api', authRouter)

  return app
}

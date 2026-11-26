// Agent mailbox: /api/agents/:id/messages lists an inbox and sends to it, /api/agents/:id/loop-breaks
// shows the stopped exchanges it was in, /api/messages/:id reads one message and marks it read,
// /api/teams/:id/messages is the whole Team's thread and /api/teams/:id/exchanges the exchanges
// between its Agents going on now, which /api/exchanges/:id/stop stops.

import type {
  ListAgentLoopBreaksResponse,
  ListExchangesResponse,
  ListInboxResponse,
  ListTeamMessagesResponse,
  SendMessageRequest,
  StopExchangeResponse,
  UpdateMessageRequest,
} from '@bazilion/api-types'
import { agentRepo, messageRepo } from '../core/index.ts'
import { listAgentLoopBreaks } from '../lib/agent-loop-guard.ts'
import { sendAgentMessage } from '../lib/communication.ts'
import { getCtx } from '../lib/ctx.ts'
import { activeExchanges, stopExchange } from '../lib/exchanges.ts'
import { jsonBody, newRouter, routeAgent, routeTeam } from './http.ts'

export const messagesRouter = newRouter()

export const teamMessagesRouter = newRouter()

/** What the Team's Agents sent and received, newest first. Reading here marks nothing read. */
teamMessagesRouter.get('/:id/messages', (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500)
  return c.json({
    messages: messageRepo.listForTeam(getCtx().db, routeTeam(c).id, limit),
  } satisfies ListTeamMessagesResponse)
})

/** The exchanges between the Team's Agents going on now, with what each has used. */
teamMessagesRouter.get('/:id/exchanges', (c) => {
  const { db, paths } = getCtx()
  return c.json({
    exchanges: activeExchanges(db, paths, routeTeam(c).id),
  } satisfies ListExchangesResponse)
})

export const exchangesRouter = newRouter()

/** Stop an exchange: nothing in it wakes anyone again, and the turns it woke stop. */
exchangesRouter.post('/:id/stop', (c) => {
  const id = c.req.param('id')
  if (messageRepo.listExchange(getCtx().db, id).length === 0) {
    return c.json({ error: `exchange not found: ${id}` }, 404)
  }
  return c.json(stopExchange(getCtx().db, id) satisfies StopExchangeResponse)
})

messagesRouter.get('/:id', (c) => {
  const msg = messageRepo.get(getCtx().db, c.req.param('id'))
  if (!msg) return c.json({ error: `message not found: ${c.req.param('id')}` }, 404)
  return c.json(msg)
})

messagesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await jsonBody<UpdateMessageRequest>(c)
  if (body?.read !== true) return c.json({ error: 'body must be {read: true}' }, 400)
  const { db } = getCtx()
  if (!messageRepo.get(db, id)) return c.json({ error: `message not found: ${id}` }, 404)
  messageRepo.markRead(db, id)
  return c.json(messageRepo.get(db, id))
})

export const agentMessagesRouter = newRouter()

agentMessagesRouter.get('/:id/messages', (c) => {
  const unreadOnly = c.req.query('unread') === '1'
  return c.json({
    messages: messageRepo.listInbox(getCtx().db, routeAgent(c).id, { unreadOnly }),
  } satisfies ListInboxResponse)
})

agentMessagesRouter.get('/:id/loop-breaks', (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 25, 1), 100)
  return c.json({
    events: listAgentLoopBreaks(getCtx().db, routeAgent(c).id, limit),
  } satisfies ListAgentLoopBreaksResponse)
})

/** An operator-sent message between two agents; Team Policy and the loop limit still apply. */
agentMessagesRouter.post('/:id/messages', async (c) => {
  const body = await jsonBody<SendMessageRequest>(c)
  const from = body?.from
  const text = body?.payload?.text
  if (typeof from !== 'string' || !from || typeof text !== 'string') {
    return c.json({ error: 'from and payload.text are required' }, 400)
  }
  const { db } = getCtx()
  const fromAgent = agentRepo.get(db, from)
  if (!fromAgent) return c.json({ error: `agent not found: ${from}` }, 404)
  const toAgent = routeAgent(c)
  const replyTo = body?.replyTo
  if (replyTo && !messageRepo.get(db, replyTo)) {
    return c.json({ error: `reply target not found: ${replyTo}` }, 404)
  }
  const msg = sendAgentMessage(db, {
    from: fromAgent.id,
    to: toAgent.id,
    payload: JSON.stringify({ text }),
    replyTo: replyTo ?? null,
    origin: 'http_agent_message',
  })
  return c.json(msg, 201)
})

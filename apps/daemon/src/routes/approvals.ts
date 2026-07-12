import type { CommunicationApprovalDetail, CommunicationApprovalStatus } from '@bazilion/api-types'
import { Bot, InputFile } from 'grammy'
import { Hono } from 'hono'
import {
  authorizeInSnapshot,
  communicationApprovalRepo,
  messageRepo,
  openSecrets,
} from '../core/index.ts'
import { runAgentTurn } from '../lib/agent-turn.ts'
import { getCtx } from '../lib/ctx.ts'
import { downloadMediaBytes, type MediaRef } from '../lib/telegram/media.ts'

export const approvalsRouter = new Hono()

approvalsRouter.get('/', (c) => {
  const status = c.req.query('status') as CommunicationApprovalStatus | undefined
  if (
    status &&
    ![
      'pending',
      'approved',
      'denied',
      'expired',
      'cancelled',
      'delivering',
      'delivered',
      'delivery_failed',
    ].includes(status)
  )
    return c.json({ error: 'invalid approval status' }, 400)
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100)
  return c.json({
    approvals: communicationApprovalRepo.list(getCtx().db, {
      status,
      teamId: c.req.query('teamId'),
      limit,
    }),
  })
})

approvalsRouter.get('/:id', (c) => {
  const detail = communicationApprovalRepo.get(getCtx().db, c.req.param('id'), true)
  if (!detail) return c.json({ error: 'approval not found' }, 404)
  return c.json(detail)
})

approvalsRouter.post('/:id/deny', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown }
  try {
    const decided = communicationApprovalRepo.decide(
      getCtx().db,
      c.req.param('id'),
      'deny',
      'authenticated_operator',
      typeof body.reason === 'string' ? body.reason : undefined,
    )
    await notifyTelegram(c.req.param('id'), 'Communication denied by the operator.')
    return c.json(decided)
  } catch (error) {
    return approvalError(error)
  }
})

approvalsRouter.post('/:id/cancel', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown }
  try {
    const decided = communicationApprovalRepo.decide(
      getCtx().db,
      c.req.param('id'),
      'cancel',
      'authenticated_operator',
      typeof body.reason === 'string' ? body.reason : undefined,
    )
    await notifyTelegram(c.req.param('id'), 'Communication approval was cancelled.')
    return c.json(decided)
  } catch (error) {
    return approvalError(error)
  }
})

approvalsRouter.post('/:id/approve', async (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  try {
    const claimed = communicationApprovalRepo.claimDelivery(
      db,
      id,
      'authenticated_operator',
      (approval) =>
        authorizeInSnapshot(db, {
          source: approval.source,
          target: approval.target,
          origin: approval.origin,
          attemptKind: approval.attemptKind,
          attemptId: approval.attemptId,
        }),
    )
    try {
      await deliver(claimed)
      return c.json(
        communicationApprovalRepo.finishDelivery(db, id, true, 'authenticated_operator'),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      communicationApprovalRepo.finishDelivery(db, id, false, 'authenticated_operator', message)
      return c.json({ error: 'approval delivery failed', detail: message }, 500)
    }
  } catch (error) {
    return approvalError(error)
  }
})

async function deliver(approval: CommunicationApprovalDetail): Promise<void> {
  if (approval.payloadKind === 'agent_message') {
    const payload = approval.payload as {
      from: string
      to: string
      payload: string
      replyTo?: string | null
    }
    messageRepo.send(getCtx().db, payload)
    return
  }
  if (approval.payloadKind === 'agent_turn') {
    const payload = approval.payload as {
      agentId: string
      message: string
      attachments?: Array<{ name?: string; mimeType: string; data: string }>
    }
    for await (const _frame of runAgentTurn(payload.agentId, payload.message, {
      attachments: payload.attachments ?? [],
      skipUserIngress: true,
    })) {
      // The approved turn persists its transcript. The original non-interactive caller
      // observes final state by polling this approval; no disconnected response is replayed.
    }
    return
  }
  if (approval.payloadKind === 'http_chat_frame') {
    // The polling caller retrieves the captured frame from approval detail after the
    // terminal delivered status; the original NDJSON response cannot be re-opened.
    return
  }
  if (approval.payloadKind === 'inbox_message') {
    const payload = approval.payload as { messageId: string }
    getCtx().db.raw.run(
      `INSERT INTO communication_approval_message_grants
         (approval_id, message_id, created_at) VALUES (?, ?, ?)`,
      [approval.id, payload.messageId, Date.now()],
    )
    return
  }
  if (approval.payloadKind === 'telegram_ingress') {
    const payload = approval.payload as { agentId: string; text: string; media?: MediaRef | null }
    const attachments = []
    const text = payload.text
    if (payload.media) {
      const { db, authToken } = getCtx()
      const botToken = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
      if (!botToken) throw new Error('Telegram bot token is unavailable')
      const downloaded = await downloadMediaBytes(new Bot(botToken).api, botToken, payload.media)
      if (!downloaded.ok)
        throw new Error(`Telegram attachment download failed: ${downloaded.reason}`)
      attachments.push({
        mimeType: downloaded.mimeType,
        data: downloaded.data,
        ...(downloaded.name ? { name: downloaded.name } : {}),
      })
    }
    const { db, authToken } = getCtx()
    const botToken = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
    if (botToken) {
      const transport = approval.payload as { chatId: number; threadId?: number }
      await new Bot(botToken).api.sendMessage(
        transport.chatId,
        'Communication approved. Processing now.',
        transport.threadId ? { message_thread_id: transport.threadId } : {},
      )
    }
    for await (const _frame of runAgentTurn(payload.agentId, text, {
      attachments,
      skipUserIngress: true,
    })) {
      // Telegram mirror observes the persisted turn and independently applies egress policy.
    }
    return
  }
  if (approval.payloadKind.startsWith('telegram_')) {
    const { db, authToken } = getCtx()
    const botToken = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
    if (!botToken) throw new Error('Telegram bot token is unavailable')
    const api = new Bot(botToken).api
    const payload = approval.payload as {
      chatId: number
      topicId?: number
      text?: string
      parseMode?: 'HTML' | null
      data?: string
      mimeType?: string
      caption?: string
      name?: string
      asDocument?: boolean
    }
    const options = {
      ...(payload.topicId ? { message_thread_id: payload.topicId } : {}),
      ...(payload.caption ? { caption: payload.caption } : {}),
    }
    if (approval.payloadKind === 'telegram_text') {
      await api.sendMessage(payload.chatId, payload.text ?? '', {
        ...options,
        ...(payload.parseMode ? { parse_mode: payload.parseMode } : {}),
      })
      return
    }
    if (approval.payloadKind === 'telegram_typing') {
      await api.sendChatAction(payload.chatId, 'typing', options)
      return
    }
    const bytes = Buffer.from(payload.data ?? '', 'base64')
    if (approval.payloadKind === 'telegram_image' && !payload.asDocument) {
      await api.sendPhoto(payload.chatId, new InputFile(bytes, 'approved-image.png'), options)
      return
    }
    await api.sendDocument(
      payload.chatId,
      new InputFile(bytes, payload.name ?? 'approved-file'),
      options,
    )
    return
  }
  throw new Error(`unsupported approval payload kind: ${approval.payloadKind}`)
}

async function notifyTelegram(id: string, text: string): Promise<void> {
  const detail = communicationApprovalRepo.get(
    getCtx().db,
    id,
    true,
  ) as CommunicationApprovalDetail | null
  if (detail?.payloadKind !== 'telegram_ingress') return
  const payload = detail.payload as { chatId?: number; threadId?: number }
  if (!payload.chatId) return
  const { db, authToken } = getCtx()
  const token = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
  if (!token) return
  try {
    await new Bot(token).api.sendMessage(
      payload.chatId,
      text,
      payload.threadId ? { message_thread_id: payload.threadId } : {},
    )
  } catch {
    // The durable decision remains authoritative if a best-effort status notice fails.
  }
}

function approvalError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('approval_not_found')) {
    return Response.json({ error: message }, { status: 404 })
  }
  if (
    message.startsWith('approval_state_conflict') ||
    message.startsWith('approval_revalidation_failed')
  ) {
    return Response.json({ error: message }, { status: 409 })
  }
  return Response.json({ error: message }, { status: 400 })
}

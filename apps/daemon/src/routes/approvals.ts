import type {
  Attachment,
  CommunicationApprovalDetail,
  CommunicationApprovalStatus,
} from '@bazilion/api-types'
import { Bot, InputFile } from 'grammy'
import { Hono } from 'hono'
import {
  authorizeInSnapshot,
  communicationApprovalRepo,
  messageRepo,
  openSecrets,
  triggerDispatchRepo,
  triggerRepo,
} from '../core/index.ts'
import {
  AgentLoopLimitError,
  enforceMessageCausality,
  resolveMessageCausality,
} from '../lib/agent-loop-guard.ts'
import { prepareAgentTurn, runAgentTurn } from '../lib/agent-turn.ts'
import {
  type ApprovalDeliveryPlan,
  ApprovalDeliveryValidationError,
  planApprovalDelivery,
  type SchedulerTriggerApprovalPayload,
} from '../lib/approval-delivery-plan.ts'
import { getCtx } from '../lib/ctx.ts'
import { approvalDeliveryFailureMessage, protectedFrameFailure } from '../lib/protected-failure.ts'
import { downloadMediaBytes } from '../lib/telegram/media.ts'
import { createTrustedTurnInvocation } from '../lib/turn-invocation.ts'

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
    const pending = communicationApprovalRepo.get(
      db,
      id,
      true,
    ) as CommunicationApprovalDetail | null
    if (!pending) return c.json({ error: `approval_not_found: ${id}` }, 404)
    let pendingPlan: ApprovalDeliveryPlan
    try {
      pendingPlan = approvalPlan(pending)
    } catch (error) {
      if (!(error instanceof ApprovalDeliveryValidationError)) throw error
      // Invalid durable tuples are terminal delivery failures. Claiming here
      // still performs the canonical policy/membership revalidation, but no
      // guarded external effect is attempted.
      communicationApprovalRepo.claimDelivery(db, id, 'authenticated_operator', (approval) =>
        authorizeInSnapshot(db, {
          source: approval.source,
          target: approval.target,
          origin: approval.origin,
          attemptKind: approval.attemptKind,
          attemptId: approval.attemptId,
        }),
      )
      communicationApprovalRepo.finishDelivery(
        db,
        id,
        false,
        'authenticated_operator',
        error.message,
      )
      return c.json({ error: 'approval delivery failed', detail: error.message }, 500)
    }
    if (pendingPlan.kind === 'scheduler_trigger') {
      const granted = communicationApprovalRepo.grantSchedulerTrigger(
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
        (approval) => {
          const plan = approvalPlan(approval)
          if (plan.kind !== 'scheduler_trigger')
            return 'approval_delivery_invalid: scheduler_trigger_plan'
          return validateSchedulerGrant(db, plan.payload)
        },
      )
      if (!granted.granted) {
        return c.json(
          {
            error:
              granted.failureKind === 'revalidation'
                ? 'approval revalidation failed'
                : 'approval delivery failed',
            detail: granted.error,
          },
          409,
        )
      }
      return c.json(granted.approval)
    }
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
      await deliver(approvalPlan(claimed))
      return c.json(
        communicationApprovalRepo.finishDelivery(db, id, true, 'authenticated_operator'),
      )
    } catch (error) {
      const message = approvalDeliveryFailureMessage(error)
      communicationApprovalRepo.finishDelivery(db, id, false, 'authenticated_operator', message)
      return c.json({ error: 'approval delivery failed', detail: message }, 500)
    }
  } catch (error) {
    return approvalError(error)
  }
})

function approvalPlan(approval: CommunicationApprovalDetail): ApprovalDeliveryPlan {
  return planApprovalDelivery(approval, {
    messageById: (messageId) => messageRepo.get(getCtx().db, messageId),
  })
}

function validateSchedulerGrant(
  db: ReturnType<typeof getCtx>['db'],
  payload: SchedulerTriggerApprovalPayload,
): string | null {
  const trigger = triggerRepo.get(db, payload.triggerId)
  if (!trigger?.enabled) return 'scheduled trigger is disabled or deleted'
  if (trigger.agentId !== payload.agentId) return 'scheduled trigger target changed'
  if (trigger.message !== payload.message) return 'scheduled trigger message changed'
  const dispatch = triggerDispatchRepo.get(db, payload.dispatchId)
  if (!dispatch) return 'scheduled dispatch no longer exists'
  if (
    dispatch.triggerId !== payload.triggerId ||
    dispatch.agentId !== payload.agentId ||
    dispatch.scheduledAt !== payload.occurrence
  ) {
    return 'scheduled dispatch no longer matches the approved occurrence'
  }
  if (['succeeded', 'failed', 'cancelled'].includes(dispatch.status)) {
    return `scheduled dispatch is already ${dispatch.status}`
  }
  return null
}

async function deliver(plan: ApprovalDeliveryPlan): Promise<void> {
  if (plan.kind === 'agent_message') {
    const causality = resolveMessageCausality(getCtx().db, plan.payload)
    const loopBreak = enforceMessageCausality(getCtx().db, {
      from: plan.payload.from,
      to: plan.payload.to,
      origin: 'communication_approval_delivery',
      causality,
    })
    if (loopBreak) throw new AgentLoopLimitError(loopBreak)
    messageRepo.send(getCtx().db, {
      ...plan.payload,
      causalChainId: causality.causalChainId,
      causalHop: causality.causalHop,
    })
    return
  }
  if (plan.kind === 'scheduler_trigger') {
    // Scheduler approvals are durable grants only. The pending dispatch is
    // executed by the scheduler so leases, retries, and restart recovery stay
    // in one state machine.
    return
  }
  if (plan.kind === 'agent_turn') {
    const preparedTurn = await prepareAgentTurn({
      invocation: createTrustedTurnInvocation({
        kind: 'approval_delivery',
        authorization: {
          origin: 'http_chat',
          attemptKind: 'http_chat_ingress',
          attemptId: plan.approval.attemptId,
          approvalId: plan.approval.id,
          agentId: plan.payload.agentId,
        },
        turn: {
          agentId: plan.payload.agentId,
          message: plan.payload.message,
          attachments: plan.payload.attachments,
        },
        bashApprovalMode: 'auto_deny',
      }),
    })
    let failure: string | null = null
    for await (const frame of runAgentTurn(preparedTurn)) {
      failure ??= protectedFrameFailure(frame)
    }
    if (failure) throw new Error(failure)
    return
  }
  if (plan.kind === 'http_chat_frame') {
    // The polling caller retrieves the captured frame from approval detail after the
    // terminal delivered status; the original NDJSON response cannot be re-opened.
    return
  }
  if (plan.kind === 'inbox_message') {
    getCtx().db.raw.run(
      `INSERT INTO communication_approval_message_grants
         (approval_id, message_id, created_at) VALUES (?, ?, ?)`,
      [plan.approval.id, plan.payload.messageId, Date.now()],
    )
    return
  }
  if (plan.kind === 'telegram_ingress') {
    const attachments: Attachment[] = []
    if (plan.payload.media) {
      const { db, authToken } = getCtx()
      const botToken = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
      if (!botToken) throw new Error('Telegram bot token is unavailable')
      const downloaded = await downloadMediaBytes(
        new Bot(botToken).api,
        botToken,
        plan.payload.media,
      )
      if (!downloaded.ok) throw new Error('Telegram attachment download failed')
      attachments.push({
        mimeType: downloaded.mimeType,
        data: downloaded.data,
        ...(downloaded.name ? { name: downloaded.name } : {}),
      })
    }
    const { db, authToken } = getCtx()
    const botToken = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
    if (botToken) {
      await new Bot(botToken).api.sendMessage(
        plan.payload.chatId,
        'Communication approved. Processing now.',
        { message_thread_id: plan.payload.threadId },
      )
    }
    const preparedTurn = await prepareAgentTurn({
      invocation: createTrustedTurnInvocation({
        kind: 'approval_delivery',
        authorization: {
          origin: 'telegram_agent_topic',
          attemptKind: 'telegram_ingress',
          attemptId: plan.approval.attemptId,
          approvalId: plan.approval.id,
          agentId: plan.payload.agentId,
        },
        turn: {
          agentId: plan.payload.agentId,
          message: plan.payload.text,
          attachments,
        },
        bashApprovalMode: 'auto_deny',
      }),
    })
    let failure: string | null = null
    for await (const frame of runAgentTurn(preparedTurn)) {
      failure ??= protectedFrameFailure(frame)
    }
    if (failure) throw new Error(failure)
    return
  }

  const { db, authToken } = getCtx()
  const botToken = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
  if (!botToken) throw new Error('Telegram bot token is unavailable')
  const api = new Bot(botToken).api
  const options = {
    ...(plan.payload.topicId ? { message_thread_id: plan.payload.topicId } : {}),
    ...('caption' in plan.payload && plan.payload.caption ? { caption: plan.payload.caption } : {}),
  }
  if (plan.kind === 'telegram_text') {
    await api.sendMessage(plan.payload.chatId, plan.payload.text, {
      ...options,
      ...(plan.payload.parseMode ? { parse_mode: plan.payload.parseMode } : {}),
    })
    return
  }
  if (plan.kind === 'telegram_typing') {
    await api.sendChatAction(plan.payload.chatId, 'typing', options)
    return
  }
  const bytes = Buffer.from(plan.payload.data, 'base64')
  if (plan.kind === 'telegram_image' && !plan.payload.asDocument) {
    await api.sendPhoto(plan.payload.chatId, new InputFile(bytes, 'approved-image.png'), options)
    return
  }
  await api.sendDocument(
    plan.payload.chatId,
    new InputFile(bytes, plan.kind === 'telegram_file' ? plan.payload.name : 'approved-image.png'),
    options,
  )
}

async function notifyTelegram(id: string, text: string): Promise<void> {
  const detail = communicationApprovalRepo.get(
    getCtx().db,
    id,
    true,
  ) as CommunicationApprovalDetail | null
  if (!detail) return
  let plan: ApprovalDeliveryPlan
  try {
    plan = approvalPlan(detail)
  } catch {
    return
  }
  if (plan.kind !== 'telegram_ingress') return
  const { db, authToken } = getCtx()
  const token = openSecrets(db, authToken).get('TELEGRAM_BOT_TOKEN') ?? ''
  if (!token) return
  try {
    await new Bot(token).api.sendMessage(
      plan.payload.chatId,
      text,
      plan.payload.threadId ? { message_thread_id: plan.payload.threadId } : {},
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

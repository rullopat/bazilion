import { randomUUID } from 'node:crypto'
import type {
  AgentQuestion,
  AgentQuestionInput,
  AgentQuestionResponseInput,
  AgentQuestionToolResult,
  CommunicationApprovalDetail,
} from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import { authorizeInSnapshot } from '../core/index.ts'
import type { Paths } from '../core/paths.ts'
import * as approvals from '../core/repos/communicationApprovals.ts'
import * as questions from '../core/repos/questions.ts'
import { ownsActiveAgent } from './agent-cancel.ts'
import { CommunicationDeniedError, teamPolicyEnforcementEnabled } from './communication.ts'
import { resolveConversationTarget } from './conversation-target.ts'
import { authorizeQuestionBoundary, validateQuestionApproval } from './question-approval.ts'
import { verifyQuestionConsumption } from './question-consumption.ts'
import { signQuestionReceipt } from './question-receipt.ts'
import { questionVisible } from './question-visibility.ts'
import { QuestionWaiters } from './question-waiters.ts'
import { readResultSession } from './result-source.ts'
import { telegramQuestionTransport } from './telegram/question-transport.ts'
import { requireTelegramQueueBinding, type TelegramQueueBinding } from './telegram/queue-binding.ts'
import { assertPreparedAgentTurn, type PreparedAgentTurn } from './turn-preparation.ts'

export interface QuestionTelegramTransport {
  settled?(question: AgentQuestion, authorize: () => void): Promise<void>
  available(binding: TelegramQueueBinding): boolean
  /** The transport must invoke authorize again after outbound pacing and before sending. */
  send(
    question: AgentQuestion,
    binding: TelegramQueueBinding,
    authorize: () => void,
    signal?: AbortSignal,
  ): Promise<void>
}
export interface LiveQuestionHost {
  consumed(questionId: string, toolCallId: string): void
  subscribe(listener: (question: AgentQuestion) => void): () => void
  ask(toolCallId: string, input: AgentQuestionInput): Promise<AgentQuestionToolResult>
  close(): void
}
interface LiveTurn {
  turn: PreparedAgentTurn
  onQuestion?: (question: AgentQuestion) => void
}

const services = new WeakMap<BazilionDb, QuestionService>()
export function questionServiceFor(
  db: BazilionDb,
  paths: Paths,
  authToken: string,
): QuestionService {
  let service = services.get(db)
  if (!service) {
    service = new QuestionService(db, paths, authToken)
    services.set(db, service)
  }
  return service
}

/** Daemon-owned live turns. Durable receipts never recreate a worker continuation. */
export class QuestionService {
  readonly #attached = new WeakSet<PreparedAgentTurn>()
  readonly #turns = new Map<string, LiveTurn>()
  readonly #waiters: QuestionWaiters
  constructor(
    readonly db: BazilionDb,
    readonly paths: Paths,
    readonly authToken: string,
    readonly telegram: QuestionTelegramTransport | undefined = telegramQuestionTransport(
      db,
      authToken,
    ),
  ) {
    this.#waiters = new QuestionWaiters(db)
  }

  attach(
    turn: PreparedAgentTurn,
    onQuestion?: (question: AgentQuestion) => void,
  ): LiveQuestionHost | undefined {
    assertPreparedAgentTurn(turn)
    const route = turn.questionRoute
    if (!route) return undefined
    if (route.kind === 'telegram' && !this.telegram?.available(route.binding)) return undefined
    if (!ownsActiveAgent(turn.agent.agent.id, turn.controller) || turn.controller.signal.aborted)
      throw new Error('Question turn is no longer active')
    if (this.#attached.has(turn)) throw new Error('Question host already attached to this turn')
    // Captured before spawning the worker, under the Agent's exclusive turn registration.
    // Provider tool-call IDs may repeat in later turns of the same retained conversation.
    const turnStartEntry = readResultSession(
      this.paths,
      turn.agent.agent.id,
      turn.conversation.filename,
      turn.conversation.id,
    ).length
    this.#attached.add(turn)
    const turnId = randomUUID()
    const listeners = new Set<(question: AgentQuestion) => void>()
    if (onQuestion) listeners.add(onQuestion)
    this.#turns.set(turnId, {
      turn,
      onQuestion: (question) => {
        for (const listener of listeners) {
          try {
            listener(question)
          } catch {}
        }
      },
    })
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      this.#waiters.closeTurn(turnId, turn.controller.signal.aborted ? 'cancelled' : 'worker_lost')
      this.#turns.delete(turnId)
      listeners.clear()
      turn.controller.signal.removeEventListener('abort', close)
    }
    turn.controller.signal.addEventListener('abort', close, { once: true })
    if (turn.controller.signal.aborted) close()
    return {
      consumed: (questionId, toolCallId) => {
        if (
          closed ||
          turn.controller.signal.aborted ||
          !ownsActiveAgent(turn.agent.agent.id, turn.controller)
        )
          throw new Error('Question continuation is closed')
        const item = questions.get(this.db, turn.agent.agent.id, questionId)
        if (!item || item.turnId !== turnId || item.toolCallId !== toolCallId)
          throw new Error('Question consumption binding changed')
        verifyQuestionConsumption(this.paths, item, turn.conversation, turnStartEntry)
        questions.markConsumed(this.db, item.agentId, item.id, turnId, toolCallId)
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      close,
      ask: async (toolCallId, input) => {
        if (closed) throw new Error('Question turn is closed')
        this.#validateTurn(turn)
        const item = questions.create(this.db, {
          agentId: turn.agent.agent.id,
          teamId: turn.agent.team.id,
          conversationId: turn.conversation.id,
          turnId,
          toolCallId,
          question: input,
          binding: {
            route:
              route.kind === 'telegram'
                ? {
                    kind: route.kind,
                    ownerGrantId: route.binding.ownerGrantId,
                    topicBindingId: route.binding.topicBindingId,
                    botDigest: route.binding.botDigest,
                    teamId: route.binding.teamId,
                    requester: route.binding.authorization.requester,
                    chatId: route.binding.authorization.approvalPayload.chatId,
                    threadId: route.binding.authorization.approvalPayload.threadId,
                    messageId: route.binding.authorization.approvalPayload.messageId,
                  }
                : route,
            origin: turn.invocation.kind,
            attemptId: turn.invocation.authorization.attemptId,
          },
        })
        const answer = this.#waiters.wait(item, turn.controller.signal)
        const recheck = setInterval(() => {
          try {
            this.#reconcile(item.agentId, item.id)
          } catch {
            // ready() closes invalid live bindings. A storage failure must not escape
            // the timer callback; the worker lifetime/deadline remains authoritative.
          }
        }, 1000)
        recheck.unref()
        try {
          try {
            await this.#deliver(item)
          } catch (error) {
            questions.close(
              this.db,
              item.agentId,
              item.id,
              error instanceof CommunicationDeniedError ? 'policy_denied' : 'route_unavailable',
            )
            this.#waiters.settled(item.agentId, item.id)
          }
          const result = await answer
          if (route.kind === 'telegram') {
            const settled = questions.get(this.db, item.agentId, item.id)
            if (settled)
              void this.telegram
                ?.settled?.(settled, () => {
                  const current = questions.get(this.db, item.agentId, item.id)
                  if (!current || !questionVisible(this.db, current))
                    throw new Error('Question status is no longer visible')
                })
                .catch(() => undefined)
          }
          const receipt = signQuestionReceipt(this.db, item.agentId, result)
          return receipt ? { ...result, receipt } : result
        } finally {
          clearInterval(recheck)
        }
      },
    }
  }

  /** Revalidate while nobody is responding; reads never create new approval attempts. */
  #reconcile(agentId: string, id: string): void {
    const item = this.ready(agentId, id)
    for (const delivery of [true, false]) {
      const approvalId = delivery ? item.deliveryApprovalId : item.answerApprovalId
      const approval = approvalId ? approvals.get(this.db, approvalId) : null
      let invalid =
        !!approvalId &&
        (!approval || !['pending', 'approved', 'delivering', 'delivered'].includes(approval.status))
      if (teamPolicyEnforcementEnabled()) {
        const agent = { kind: 'agent' as const, id: agentId }
        const user = { kind: 'user' as const, teamId: item.teamId }
        const decision = authorizeInSnapshot(this.db, {
          source: delivery ? agent : user,
          target: delivery ? user : agent,
          origin: 'agent_question',
          attemptKind: delivery ? 'question_delivery' : 'question_answer',
          attemptId: `${id}:lifecycle`,
        })
        invalid ||= decision.decision === 'deny'
        if (approval)
          invalid ||=
            decision.decision !== 'approval_required' ||
            JSON.stringify(decision.policyRefs) !== JSON.stringify(approval.policyRefs) ||
            JSON.stringify(decision.requiredEdgeIds) !== JSON.stringify(approval.requiredEdgeIds)
        else if (delivery && item.deliveredAt !== null) invalid ||= decision.decision !== 'allow'
      }
      if (invalid) {
        questions.close(this.db, agentId, id, 'policy_denied')
        this.#waiters.settled(agentId, id)
        return
      }
    }
  }

  #validateTurn(turn: PreparedAgentTurn): void {
    if (turn.controller.signal.aborted || !ownsActiveAgent(turn.agent.agent.id, turn.controller))
      throw new Error('Question turn is closed')
    const current = this.db.raw
      .query<{ team_id: string; status: string }, [string]>(
        'SELECT team_id, status FROM agents WHERE id = ?',
      )
      .get(turn.agent.agent.id)
    if (!current || current.team_id !== turn.agent.team.id || current.status === 'archived')
      throw new Error('Question Agent binding changed')
    resolveConversationTarget(this.db, this.paths, turn.agent.agent.id, turn.conversation.id)
    if (turn.questionRoute?.kind === 'telegram') {
      requireTelegramQueueBinding(this.db, this.authToken, turn.questionRoute.binding)
      if (!this.telegram?.available(turn.questionRoute.binding))
        throw new Error('Question transport unavailable')
    }
  }

  ready(agentId: string, id: string): AgentQuestion {
    const item = questions.get(this.db, agentId, id)
    if (item?.status !== 'pending' || !this.#waiters.has(agentId, id))
      throw new Error('Question is not waiting')
    if (item.expiresAt <= Date.now()) {
      questions.close(this.db, agentId, id, 'expired')
      this.#waiters.settled(agentId, id)
      throw new Error('Question expired')
    }
    const live = this.#turns.get(item.turnId)
    if (!live) throw new Error('Question turn is closed')
    try {
      this.#validateTurn(live.turn)
    } catch (error) {
      const reason = live.turn.controller.signal.aborted
        ? 'cancelled'
        : !ownsActiveAgent(agentId, live.turn.controller)
          ? 'worker_lost'
          : 'route_unavailable'
      questions.close(this.db, agentId, id, reason)
      this.#waiters.settled(agentId, id)
      throw error
    }
    return item
  }

  respond(
    agentId: string,
    id: string,
    response: AgentQuestionResponseInput,
  ): questions.QuestionSettlement | { kind: 'held'; question: AgentQuestion } {
    const existing = questions.get(this.db, agentId, id)
    if (!existing) throw new Error('Question unavailable')
    if (existing.status !== 'pending') return questions.answer(this.db, agentId, id, response)
    this.ready(agentId, id)
    let decision: ReturnType<typeof authorizeQuestionBoundary>
    try {
      decision = authorizeQuestionBoundary(this.db, agentId, id, 'question_answer', response)
    } catch (error) {
      if (error instanceof CommunicationDeniedError) {
        questions.close(this.db, agentId, id, 'policy_denied')
        this.#waiters.settled(agentId, id)
      }
      throw error
    }
    const question = questions.get(this.db, agentId, id)
    if (!question) throw new Error('Question unavailable')
    if (decision.kind === 'held') return { kind: 'held', question }
    if (decision.kind !== 'allowed') return { kind: 'conflict', question }
    // Synchronous authorization and settlement share the daemon's event-loop turn.
    this.ready(agentId, id)
    const result = questions.answer(this.db, agentId, id, response)
    this.#waiters.settled(agentId, id)
    return result
  }

  assertApprovalReady(approval: CommunicationApprovalDetail): void {
    const payload = approval.payload as { agentId?: unknown; questionId?: unknown }
    if (!payload || typeof payload.agentId !== 'string' || typeof payload.questionId !== 'string')
      throw new Error('Invalid question approval reference')
    validateQuestionApproval(
      approval,
      questions.approvalSnapshot(this.db, payload.agentId, payload.questionId),
    )
    this.ready(payload.agentId, payload.questionId)
  }

  #grant(approval: CommunicationApprovalDetail): void {
    this.assertApprovalReady(approval)
    if (approvals.get(this.db, approval.id)?.status !== 'delivering')
      throw new Error('Question approval is not delivering')
    const current = authorizeInSnapshot(this.db, {
      source: approval.source,
      target: approval.target,
      origin: approval.origin,
      attemptKind: approval.attemptKind,
      attemptId: approval.attemptId,
    })
    if (
      current.decision !== 'approval_required' ||
      JSON.stringify(current.policyRefs) !== JSON.stringify(approval.policyRefs) ||
      JSON.stringify(current.requiredEdgeIds) !== JSON.stringify(approval.requiredEdgeIds)
    )
      throw new Error('Question approval policy changed')
  }

  async releaseApproval(approval: CommunicationApprovalDetail): Promise<void> {
    this.#grant(approval)
    const payload = approval.payload as { agentId: string; questionId: string }
    const snapshot = questions.approvalSnapshot(this.db, payload.agentId, payload.questionId)
    const plan = validateQuestionApproval(approval, snapshot)
    if (!snapshot) throw new Error('Question unavailable')
    if (plan.kind === 'question_delivery') await this.#deliver(snapshot.question, approval)
    else {
      if (!snapshot.proposal) throw new Error('Question proposal unavailable')
      const result = questions.answer(
        this.db,
        payload.agentId,
        payload.questionId,
        snapshot.proposal,
        Date.now(),
        approval.id,
      )
      if (result.kind !== 'accepted') throw new Error('Question answer already settled')
      this.#waiters.settled(payload.agentId, payload.questionId)
    }
  }

  async #deliver(item: AgentQuestion, approval?: CommunicationApprovalDetail): Promise<void> {
    this.ready(item.agentId, item.id)
    if (
      !approval &&
      authorizeQuestionBoundary(this.db, item.agentId, item.id, 'question_delivery').kind !==
        'allowed'
    )
      return
    const authorize = () => {
      this.ready(item.agentId, item.id)
      if (approval) this.#grant(approval)
      else if (
        authorizeQuestionBoundary(this.db, item.agentId, item.id, 'question_delivery').kind !==
        'allowed'
      )
        throw new Error('Question delivery is now held')
    }
    authorize()
    const live = this.#turns.get(item.turnId)
    if (!live) throw new Error('Question turn is closed')
    if (live.turn.questionRoute?.kind === 'telegram') {
      if (!this.telegram) throw new Error('Question transport unavailable')
      await this.telegram.send(
        item,
        live.turn.questionRoute.binding,
        authorize,
        live.turn.controller.signal,
      )
      authorize()
    }
    const delivered = questions.markDelivered(
      this.db,
      item.agentId,
      item.id,
      Date.now(),
      approval?.id,
    )
    if (delivered.deliveredAt === null) throw new Error('Question delivery expired')
    // A failed foreground socket does not revoke the authorized, reloadable card.
    try {
      live.onQuestion?.(delivered)
    } catch {}
  }
}

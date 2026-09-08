import type { AgentQuestion, AgentQuestionToolResult } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import * as questions from '../core/repos/questions.ts'

interface WaitingQuestion {
  question: AgentQuestion
  resolve: (result: AgentQuestionToolResult) => void
  signal: AbortSignal
  abort: () => void
  timer: ReturnType<typeof setTimeout>
}

/** Live continuations only. Authorization and durable answer settlement belong to the host. */
export class QuestionWaiters {
  readonly #waiting = new Map<string, WaitingQuestion>()
  constructor(
    readonly db: BazilionDb,
    readonly now: () => number = Date.now,
  ) {}

  wait(question: AgentQuestion, signal: AbortSignal): Promise<AgentQuestionToolResult> {
    const current = questions.get(this.db, question.agentId, question.id)
    if (
      current?.status !== 'pending' ||
      current.turnId !== question.turnId ||
      current.toolCallId !== question.toolCallId ||
      this.#waiting.has(question.id)
    ) {
      throw new Error('Question has no new live continuation')
    }
    if ([...this.#waiting.values()].some((entry) => entry.question.turnId === current.turnId)) {
      throw new Error('This turn already has a waiting question')
    }
    return new Promise((resolve) => {
      const abort = () => this.closeTurn(current.turnId, 'cancelled')
      const timer = setTimeout(
        () => {
          questions.close(this.db, current.agentId, current.id, 'expired', this.now())
          this.settled(current.agentId, current.id)
        },
        Math.max(0, current.expiresAt - this.now()),
      )
      timer.unref()
      this.#waiting.set(current.id, { question: current, resolve, signal, abort, timer })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  has(agentId: string, questionId: string): boolean {
    return this.#waiting.get(questionId)?.question.agentId === agentId
  }

  /** Wake only after the canonical state has settled; an approval hold stays pending. */
  settled(agentId: string, questionId: string): void {
    const entry = this.#waiting.get(questionId)
    if (!entry || entry.question.agentId !== agentId) return
    const item = questions.get(this.db, agentId, questionId)
    if (item?.status === 'pending') return
    this.#waiting.delete(questionId)
    clearTimeout(entry.timer)
    entry.signal.removeEventListener('abort', entry.abort)
    const base = { questionId, question: entry.question.question }
    if (item?.status === 'answered' && item.answer && item.answer.kind !== 'skip') {
      entry.resolve({ ...base, kind: 'answer', answer: item.answer })
    } else {
      entry.resolve({ ...base, kind: 'no_answer', reason: item?.noAnswerReason ?? 'cancelled' })
    }
  }

  closeTurn(turnId: string, reason: 'cancelled' | 'worker_lost' = 'worker_lost'): void {
    questions.closeTurn(this.db, turnId, reason, this.now())
    for (const entry of this.#waiting.values()) {
      if (entry.question.turnId === turnId) this.settled(entry.question.agentId, entry.question.id)
    }
  }
}

// In-process scheduler for interval/cron agent triggers and inbox
// auto-delivery.
//
// Each tick does two jobs:
//
//   1. Scheduled-trigger delivery. Loads enabled `agent_triggers` rows and
//      records whichever occurrences are due in `trigger_dispatches`. A
//      trigger is "due" when:
//        - interval: last_fired_at + intervalSec*1000 ≤ now (never-fired
//          uses created_at as the baseline)
//        - cron:     current minute's wall-clock matches expression AND
//          last_fired_at's minute < current minute (a minute that passed
//          while the daemon was down is not caught up)
//      While a trigger has an open occurrence, later ones coalesce. Each
//      occurrence runs at most once: it stays pending while its Agent is busy,
//      then runs and ends succeeded, failed or cancelled. Nothing is retried;
//      a run cut short by a daemon stop is marked failed at the next boot.
//
//   2. Inbox auto-delivery (always on). Scans `messages` for recipients
//      with unread mail. For each idle recipient (not already running /
//      firing), drains all their unread messages in one transaction and
//      fires a turn whose prompt embeds the messages. Marking read happens
//      *inside* the drain transaction so two concurrent ticks can't
//      double-dispatch. A wake whose turn cannot start puts the messages
//      back to unread and that Agent's wakes back off (10 s, doubling to
//      5 min) until a turn starts. To disable both triggers AND auto-delivery, set
//      `BAZILION_SCHEDULER=off` — there is no separate inbox-only knob
//      because free inter-agent messaging is a baseline Bazilion promise.
//
// Concurrency: each dispatch gets an in-memory "firing" guard so one process
// cannot start it twice. Auto-delivery uses the same mechanism keyed on
// `msg-wake:<agentId>`. last_fired_at is the occurrence watermark and
// read_at owns inbox-delivery state.

import type { AgentTrigger, Message, TriggerDispatch } from '@bazilion/api-types'
import { agentRepo, messageRepo, triggerDispatchRepo, triggerRepo } from '../core/index.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from './agent-cancel.ts'
import { selectCausalParent } from './agent-loop-guard.ts'
import { prepareAgentTurn, runAgentTurn } from './agent-turn.ts'
import { resolveConversationTarget } from './conversation-target.ts'
import { matchesCron, type ParsedCron, parseCron } from './cron.ts'
import { getCtx } from './ctx.ts'
import { dispatchPendingReviews } from './review-dispatcher.ts'
import { turnFailureReason, turnFrameFailure } from './turn-outcome.ts'

const SCHEDULER_KEY = Symbol.for('bazilion.scheduler')
const TICK_MS = Number(process.env.BAZILION_SCHEDULER_TICK_MS ?? 5_000)
/** Delay before retrying an inbox wake whose turn could not start; doubles up to the max. */
const INBOX_RETRY_BASE_MS = 10_000
const INBOX_RETRY_MAX_MS = 5 * 60_000

interface SchedulerState {
  timer: NodeJS.Timeout | null
  firing: Set<string>
  cronCache: Map<string, ParsedCron>
  /** Running ticks, including their lifecycle-lease waits before Agent-turn registration. */
  inFlight: Set<Promise<void>>
  /** Agents whose last inbox wake could not start a turn; cleared once one starts. */
  inboxBackoff: Map<string, { delayMs: number; nextAttemptAt: number }>
  stopped: boolean
  stopPromise?: Promise<void>
}

function state(): SchedulerState {
  const g = globalThis as unknown as Record<symbol, SchedulerState | undefined>
  let s = g[SCHEDULER_KEY]
  if (!s) {
    s = {
      timer: null,
      firing: new Set(),
      cronCache: new Map(),
      inFlight: new Set(),
      inboxBackoff: new Map(),
      stopped: false,
    }
    g[SCHEDULER_KEY] = s
  }
  return s
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

function isDue(t: AgentTrigger, now: number, cronCache: Map<string, ParsedCron>): boolean {
  if (!t.enabled) return false
  if (t.kind === 'interval') {
    const every = (t.intervalSec ?? 0) * 1000
    if (every <= 0) return false
    const baseline = t.lastFiredAt ?? t.createdAt
    return now - baseline >= every
  }
  if (t.kind === 'cron') {
    if (!t.cronExpr) return false
    let parsed = cronCache.get(t.cronExpr)
    if (!parsed) {
      try {
        parsed = parseCron(t.cronExpr)
      } catch {
        return false
      }
      cronCache.set(t.cronExpr, parsed)
    }
    const nowFloor = floorToMinute(now)
    if (t.lastFiredAt && floorToMinute(t.lastFiredAt) === nowFloor) return false
    return matchesCron(parsed, new Date(nowFloor))
  }
  return false
}

function scheduledOccurrence(t: AgentTrigger, now: number): number {
  if (t.kind === 'cron') return floorToMinute(now)
  const baseline = t.lastFiredAt ?? t.createdAt
  const every = (t.intervalSec ?? 0) * 1000
  if (every <= 0) return now
  return baseline + Math.floor((now - baseline) / every) * every
}

async function fireTrigger(dispatch: TriggerDispatch): Promise<void> {
  const s = state()
  const key = `trigger-dispatch:${dispatch.id}`
  if (s.stopped || s.firing.has(key)) return
  s.firing.add(key)
  try {
    const ctx = getCtx()
    const t = triggerRepo.get(ctx.db, dispatch.triggerId)
    if (!t?.enabled) {
      triggerDispatchRepo.finish(ctx.db, dispatch.id, 'cancelled', 'trigger is disabled or deleted')
      return
    }
    if (agentRepo.get(ctx.db, t.agentId)?.status === 'archived') {
      triggerDispatchRepo.finish(ctx.db, dispatch.id, 'cancelled', 'agent is archived')
      return
    }
    // A busy Agent keeps the occurrence pending; a later tick runs it.
    if (isActiveAgent(t.agentId)) return
    if (!triggerDispatchRepo.start(ctx.db, dispatch.id)) return

    // Preparation takes over the registration (and drops it if it refuses the turn).
    const controller = new AbortController()
    registerAgent(t.agentId, controller)

    let failure: string | null = null
    try {
      const preparedTurn = await prepareAgentTurn({
        origin: 'trigger',
        attemptId: `${t.id}:${dispatch.scheduledAt}`,
        agentId: t.agentId,
        conversationId: dispatch.conversationId,
        message: t.message,
        attachments: [],
        claim: { controller },
      })
      // Drain the turn; we don't stream to anyone. The dispatch row carries the
      // outcome, while pi's session JSONL remains the transcript.
      for await (const frame of runAgentTurn(preparedTurn)) {
        const frameFailure = turnFrameFailure(frame)
        if (frameFailure) {
          console.warn(
            JSON.stringify({
              event: 'scheduled_trigger_failed',
              triggerId: t.id,
              dispatchId: dispatch.id,
            }),
          )
          failure ??= turnFailureReason(frameFailure)
        }
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: 'scheduled_trigger_unavailable',
          triggerId: t.id,
          dispatchId: dispatch.id,
          errorName: err instanceof Error ? err.name : 'unknown',
        }),
      )
      failure = turnFailureReason(err)
    } finally {
      if (!controller.signal.aborted) {
        triggerDispatchRepo.finish(ctx.db, dispatch.id, failure ? 'failed' : 'succeeded', failure)
      } else if (s.stopped) {
        triggerDispatchRepo.finish(ctx.db, dispatch.id, 'failed', triggerDispatchRepo.INTERRUPTED)
      } else {
        triggerDispatchRepo.finish(ctx.db, dispatch.id, 'cancelled', 'agent turn cancelled')
      }
    }
  } finally {
    s.firing.delete(key)
  }
}

function decodeText(payload: string): string {
  try {
    const obj = JSON.parse(payload) as { text?: unknown }
    if (typeof obj.text === 'string') return obj.text
  } catch {}
  return payload
}

// Sentinel prepended to every inbox-wake prompt. The web chat UI detects it
// to render the bubble with a distinct "inter-agent" style instead of the
// default user-message styling. Kept in sync by copy with `chat.ts`'s
// INBOX_WAKE_PREFIX constant.
const INBOX_WAKE_PREFIX = '[[bazilion:inbox-wake]]\n'

/**
 * Build a wake-up prompt for an agent that has unread mail. The prompt is
 * framed as a user-side system notice — not an agent-style message — so the
 * recipient's LLM understands this is the runtime telling it "here's what
 * arrived for you".
 *
 * Loop prevention: we differentiate by `replyTo`. A NEW message (no
 * `replyTo`) opens a thread, and the sender is waiting for an answer — the
 * agent must respond at least once. A REPLY (`replyTo` set) is already
 * closing a round-trip, so the agent may acknowledge silently. This single
 * asymmetry is enough to terminate conversations after one exchange instead
 * of ping-ponging forever ("you have to answer me" → "no you have to
 * answer me" → …).
 */
function buildInboxPrompt(
  agentId: string,
  messages: Message[],
  fromNames: Map<string, string>,
): string {
  const lines: string[] = [INBOX_WAKE_PREFIX.trimEnd()]
  lines.push(
    `You have ${messages.length} new message${messages.length === 1 ? '' : 's'} in your inbox:`,
  )
  lines.push('')
  const newThread: Message[] = []
  for (const m of messages) {
    const name = fromNames.get(m.fromAgentId)
    const fromLabel = name ? `${name} (${m.fromAgentId})` : m.fromAgentId
    const text = decodeText(m.payload)
    const header = m.replyTo
      ? `--- from ${fromLabel} (message ${m.id}, reply to ${m.replyTo}) ---`
      : `--- from ${fromLabel} (message ${m.id}) ---`
    lines.push(header)
    lines.push(text)
    lines.push('')
    if (!m.replyTo) newThread.push(m)
  }
  if (newThread.length > 0) {
    lines.push(
      `You MUST reply to the ${newThread.length} new message${newThread.length === 1 ? '' : 's'} above ` +
        '(the ones that are NOT marked as a reply). For each, call ' +
        '`send_message(to=<sender agent id>, text=<your reply>, reply_to=<the message id shown in the header>)`. ' +
        'Give a concrete answer if you can; a brief acknowledgement is fine if the message is purely informational. ' +
        'Avoid asking follow-up questions — answer with what you already know. ' +
        'IMPORTANT: do NOT demand a response from the sender in your reply — they already got what they asked for, ' +
        'and asking them back to reply just creates infinite loops.',
    )
  }
  const replies = messages.filter((m) => m.replyTo)
  if (replies.length > 0) {
    lines.push(
      `The other message${replies.length === 1 ? ' is a reply' : 's are replies'} to something you previously sent. ` +
        'Read, absorb, and move on — no response is required. Only send a follow-up if there is a ' +
        'genuinely new question or action that requires it; otherwise this thread is closed.',
    )
  }
  // reference the recipient id so the agent knows which mailbox this is for
  // in case it was spawned without persona context
  lines.push(`(recipient: ${agentId})`)
  return lines.join('\n')
}

async function fireInboxWake(agentId: string): Promise<void> {
  const s = state()
  const key = `msg-wake:${agentId}`
  if (s.stopped || s.firing.has(key)) return
  const backoff = s.inboxBackoff.get(agentId)
  if (backoff && Date.now() < backoff.nextAttemptAt) return
  const ctx = getCtx()
  // Skip agents with an active turn — they'll pick up the messages on their
  // next natural turn or via the next tick after the current one ends.
  if (isActiveAgent(agentId)) return
  s.firing.add(key)
  const controller = new AbortController()
  let registered = false
  let handoffStarted = false
  let turnStarted = false
  try {
    const conversation = resolveConversationTarget(ctx.db, ctx.paths, agentId)
    // Registering inside the drain transaction puts the messages back if it fails.
    // An Agent archived since the tick listed it keeps its mail unread until unarchived.
    const msgs = ctx.db.raw.transaction(() => {
      if (agentRepo.get(ctx.db, agentId)?.status === 'archived') return []
      const drained = messageRepo.drainUnreadForAgent(ctx.db, agentId)
      if (drained.length > 0) {
        registerAgent(agentId, controller)
        registered = true
      }
      return drained
    })()
    // Raced with another consumer, or the Agent was archived: nothing to do.
    if (msgs.length === 0) return
    const fromIds = new Set(msgs.map((m) => m.fromAgentId))
    const fromNames = new Map<string, string>()
    for (const fid of fromIds) {
      const sender = agentRepo.get(ctx.db, fid)
      if (sender) fromNames.set(fid, sender.name)
    }
    const message = buildInboxPrompt(agentId, msgs, fromNames)
    const attemptId = `inbox:${msgs[0]?.id}`
    const causalParentMessageId = selectCausalParent(msgs)
    // Preparation now owns the registration.
    handoffStarted = true
    let preparedTurn: Awaited<ReturnType<typeof prepareAgentTurn>>
    try {
      preparedTurn = await prepareAgentTurn({
        origin: 'inbox',
        attemptId,
        agentId,
        conversationId: conversation.id,
        message,
        attachments: [],
        causalParentMessageId,
        claim: { controller },
      })
    } catch (error) {
      // No turn started (e.g. an invalid shell configuration): unread again,
      // retried after the backoff recorded below.
      messageRepo.releaseClaimed(
        ctx.db,
        msgs.map((message) => message.id),
      )
      throw error
    }
    turnStarted = true
    s.inboxBackoff.delete(agentId)
    for await (const frame of runAgentTurn(preparedTurn)) {
      if (frame.kind === 'fatal') {
        console.warn(
          JSON.stringify({ event: 'inbox_wake_failed', agentId, failure: 'turn_failed' }),
        )
      }
    }
  } catch (err) {
    if (!handoffStarted && registered) unregisterAgent(agentId)
    let retryInMs: number | undefined
    if (!turnStarted) {
      retryInMs = backoff ? Math.min(backoff.delayMs * 2, INBOX_RETRY_MAX_MS) : INBOX_RETRY_BASE_MS
      s.inboxBackoff.set(agentId, { delayMs: retryInMs, nextAttemptAt: Date.now() + retryInMs })
    }
    console.warn(
      JSON.stringify({
        event: 'inbox_wake_unavailable',
        agentId,
        errorName: err instanceof Error ? err.name : 'unknown',
        retryInMs,
      }),
    )
  } finally {
    s.firing.delete(key)
  }
}

async function runTick(): Promise<void> {
  const s = state()
  if (s.stopped) return
  const now = Date.now()
  const ctx = getCtx()
  let triggers: AgentTrigger[]
  let recipients: string[] = []
  try {
    triggers = triggerRepo.listEnabled(ctx.db)
    recipients = messageRepo.listRecipientsWithUnread(ctx.db)
  } catch (err) {
    console.error('[scheduler] tick read failed:', err)
    return
  }
  for (const t of triggers) {
    if (s.stopped) return
    if (isDue(t, now, s.cronCache)) {
      const occurrence = scheduledOccurrence(t, now)
      try {
        if (!triggerDispatchRepo.hasOpenForTrigger(ctx.db, t.id)) {
          const conversation = resolveConversationTarget(ctx.db, ctx.paths, t.agentId)
          ctx.db.raw.transaction(() => {
            triggerDispatchRepo.materialize(ctx.db, {
              triggerId: t.id,
              agentId: t.agentId,
              conversationId: conversation.id,
              scheduledAt: occurrence,
            })
            triggerRepo.markFired(ctx.db, t.id, occurrence)
          })()
        } else triggerRepo.markFired(ctx.db, t.id, occurrence)
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'trigger_conversation_unavailable',
            triggerId: t.id,
            errorName: error instanceof Error ? error.name : 'unknown',
          }),
        )
      }
    }
  }
  if (s.stopped) return
  const work: Promise<void>[] = []
  for (const dispatch of triggerDispatchRepo.listPending(ctx.db)) {
    work.push(fireTrigger(dispatch))
  }
  for (const agentId of recipients) {
    // Same fire-and-forget shape as triggers; `fireInboxWake` internally
    // dedup-gates and bails if the agent already has an active run.
    work.push(fireInboxWake(agentId))
  }
  work.push(dispatchPendingReviews())
  await Promise.allSettled(work)
}

function tick(): Promise<void> {
  const s = state()
  if (s.stopped) return Promise.resolve()
  const pending = runTick()
  s.inFlight.add(pending)
  const settled = () => {
    s.inFlight.delete(pending)
  }
  void pending.then(settled, settled)
  return pending
}

export function startScheduler(): void {
  const s = state()
  // Replace any existing timer unconditionally so a duplicate startScheduler
  // call (e.g. a test calling getCtx twice) doesn't leave stale loops.
  if (s.timer) clearInterval(s.timer)
  s.stopped = false
  s.stopPromise = undefined
  s.timer = setInterval(() => {
    void tick().catch(() => console.warn(JSON.stringify({ event: 'scheduler_tick_failed' })))
  }, TICK_MS)
  // Unref so the scheduler never blocks process exit in tests.
  if (typeof s.timer.unref === 'function') s.timer.unref()
}

/** Fence admissions synchronously; settle dispatch finalizers before DB close. */
export function stopScheduler(): Promise<void> {
  const s = state()
  if (s.stopPromise) return s.stopPromise
  s.stopped = true
  if (s.timer) {
    clearInterval(s.timer)
    s.timer = null
  }
  s.stopPromise = Promise.allSettled([...s.inFlight]).then(() => {})
  return s.stopPromise
}

// Exposed for tests that want to drive the loop manually rather than wait
// on wall-clock intervals.
export async function _tickOnce(): Promise<void> {
  await tick()
}

export function _resetSchedulerForTest(): void {
  const s = state()
  if (s.timer) clearInterval(s.timer)
  s.timer = null
  s.firing.clear()
  s.cronCache.clear()
  s.inFlight.clear()
  s.inboxBackoff.clear()
  s.stopPromise = undefined
  s.stopped = false
}

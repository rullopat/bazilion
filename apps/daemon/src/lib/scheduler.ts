// In-process scheduler for interval/cron agent triggers and inbox
// auto-delivery.
//
// Each tick does two jobs:
//
//   1. Scheduled-trigger delivery. Loads enabled `agent_triggers` rows and
//      materializes whichever occurrences are due. A trigger is "due" when:
//        - interval: last_fired_at + intervalSec*1000 ≤ now (never-fired
//          uses created_at as the baseline)
//        - cron:     current minute's wall-clock matches expression AND
//          last_fired_at's minute < current minute
//      Materialization is idempotent on (trigger_id, scheduled_at). While a
//      trigger has open work, later interval occurrences coalesce. Claimable
//      dispatches are leased transactionally, deferred while their Agent is
//      busy, and marked succeeded/retrying/failed after the turn.
//
//   2. Inbox auto-delivery (always on). Scans `messages` for recipients
//      with unread mail. For each idle recipient (not already running /
//      firing), drains all their unread messages in one transaction and
//      fires a turn whose prompt embeds the messages. Marking read happens
//      *inside* the drain transaction so two concurrent ticks can't
//      double-dispatch. To disable both triggers AND auto-delivery, set
//      `BAZILION_SCHEDULER=off` — there is no separate inbox-only knob
//      because free inter-agent messaging is a baseline Bazilion promise.
//
// Concurrency: each dispatch gets an in-memory "firing" guard so one process
// cannot claim it twice. Auto-delivery uses the same mechanism keyed on
// `msg-wake:<agentId>`. The DB remains authoritative: trigger_dispatches owns
// delivery state and restart recovery, last_fired_at is the occurrence-
// materialization watermark, and read_at owns inbox-delivery state.

import type { AgentTrigger, Message, TriggerDispatch } from '@bazilion/api-types'
import {
  agentRepo,
  communicationApprovalRepo,
  messageRepo,
  triggerDispatchRepo,
  triggerRepo,
} from '../core/index.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from './agent-cancel.ts'
import { acquireAgentLifecycleLease } from './agent-lifecycle-lease.ts'
import { selectCausalParent } from './agent-loop-guard.ts'
import { runAgentTurn } from './agent-turn.ts'
import {
  CommunicationDeniedError,
  claimDeliverableInbox,
  claimSchedulerTrigger,
} from './communication.ts'
import { matchesCron, type ParsedCron, parseCron } from './cron.ts'
import { getCtx } from './ctx.ts'
import { dispatchClaimableReviews } from './review-dispatcher.ts'
import { turnFrameFailure } from './turn-outcome.ts'

const SCHEDULER_KEY = Symbol.for('bazilion.scheduler')
const TICK_MS = Number(process.env.BAZILION_SCHEDULER_TICK_MS ?? 5_000)

interface SchedulerState {
  timer: NodeJS.Timeout | null
  firing: Set<string>
  cronCache: Map<string, ParsedCron>
  /** pinned onStop for graceful shutdown (tests) */
  stopped: boolean
}

function state(): SchedulerState {
  const g = globalThis as unknown as Record<symbol, SchedulerState | undefined>
  let s = g[SCHEDULER_KEY]
  if (!s) {
    s = { timer: null, firing: new Set(), cronCache: new Map(), stopped: false }
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
  if (s.firing.has(key)) return
  s.firing.add(key)
  const ctx = getCtx()
  const releaseLease = await acquireAgentLifecycleLease(dispatch.agentId)
  const claimedDispatch = triggerDispatchRepo.claim(ctx.db, dispatch.id)
  if (!claimedDispatch) {
    releaseLease()
    s.firing.delete(key)
    return
  }
  const t = triggerRepo.get(ctx.db, claimedDispatch.triggerId)
  if (!t?.enabled) {
    triggerDispatchRepo.fail(ctx.db, claimedDispatch.id, 'trigger is disabled or deleted', {
      maxAttempts: 1,
    })
    releaseLease()
    s.firing.delete(key)
    return
  }
  if (isActiveAgent(t.agentId)) {
    releaseLease()
    triggerDispatchRepo.defer(ctx.db, claimedDispatch.id)
    s.firing.delete(key)
    return
  }
  const controller = new AbortController()
  let registered = false
  // Revalidate policy for every durable attempt. The occurrence watermark was
  // advanced when this dispatch was materialized; execution outcome belongs
  // to this dispatch row, not last_fired_at.
  try {
    const claim = claimSchedulerTrigger(ctx.db, {
      dispatchId: claimedDispatch.id,
      triggerId: t.id,
      agentId: t.agentId,
      occurrence: claimedDispatch.scheduledAt,
      materialized: true,
      onAllowed: () => {
        registerAgent(t.agentId, controller)
        registered = true
      },
    })
    if (claim.kind === 'already_claimed') {
      releaseLease()
      triggerDispatchRepo.succeed(ctx.db, claimedDispatch.id)
      s.firing.delete(key)
      return
    }
    if (claim.kind === 'approval_pending') {
      releaseLease()
      triggerDispatchRepo.defer(ctx.db, claimedDispatch.id, Date.now() + TICK_MS)
      s.firing.delete(key)
      return
    }
    if (claim.kind === 'approval_terminal') {
      releaseLease()
      triggerDispatchRepo.fail(ctx.db, claimedDispatch.id, claim.reason, { maxAttempts: 1 })
      s.firing.delete(key)
      return
    }
  } catch (err) {
    if (err instanceof CommunicationDeniedError) {
      releaseLease()
      triggerDispatchRepo.fail(ctx.db, claimedDispatch.id, err.message, { maxAttempts: 1 })
      s.firing.delete(key)
      return
    }
    releaseLease()
    if (registered) unregisterAgent(t.agentId)
    console.error(`[scheduler] markFired failed for ${t.id}:`, err)
    triggerDispatchRepo.fail(ctx.db, claimedDispatch.id, (err as Error).message)
    s.firing.delete(key)
    return
  }
  let failure: string | null = null
  try {
    // Drain the turn; we don't stream to anyone. The dispatch row carries the
    // operational outcome, while pi's session JSONL remains the transcript.
    for await (const frame of runAgentTurn(t.agentId, t.message, {
      authorization: {
        origin: 'scheduler_trigger',
        attemptKind: 'scheduler_trigger',
        attemptId: `${t.id}:${claimedDispatch.scheduledAt}`,
      },
      acquiredLeaseRelease: releaseLease,
      controller,
      alreadyRegistered: true,
      bashApprovalMode: 'auto_deny',
    })) {
      const frameFailure = turnFrameFailure(frame)
      if (frameFailure) {
        console.error(`[scheduler] trigger ${t.id} failed:`, frameFailure)
        failure ??= frameFailure
      }
    }
  } catch (err) {
    console.error(`[scheduler] trigger ${t.id} unexpected throw:`, err)
    failure = (err as Error).message
  } finally {
    if (controller.signal.aborted) {
      triggerDispatchRepo.cancelRunning(ctx.db, claimedDispatch.id, 'agent turn cancelled')
    } else if (failure) triggerDispatchRepo.fail(ctx.db, claimedDispatch.id, failure)
    else triggerDispatchRepo.succeed(ctx.db, claimedDispatch.id)
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
  if (s.firing.has(key)) return
  const ctx = getCtx()
  s.firing.add(key)
  const releaseLease = await acquireAgentLifecycleLease(agentId)
  // Skip agents with an active turn — they'll pick up the messages on their
  // next natural turn or via the next tick after the current one ends.
  if (isActiveAgent(agentId)) {
    releaseLease()
    s.firing.delete(key)
    return
  }
  const controller = new AbortController()
  let registered = false
  try {
    const msgs = claimDeliverableInbox(ctx.db, agentId, () => {
      registerAgent(agentId, controller)
      registered = true
    })
    if (msgs.length === 0) {
      // Raced with another consumer; nothing to do.
      releaseLease()
      return
    }
    const fromIds = new Set(msgs.map((m) => m.fromAgentId))
    const fromNames = new Map<string, string>()
    for (const fid of fromIds) {
      const sender = agentRepo.get(ctx.db, fid)
      if (sender) fromNames.set(fid, sender.name)
    }
    const prompt = buildInboxPrompt(agentId, msgs, fromNames)

    try {
      for await (const frame of runAgentTurn(agentId, prompt, {
        skipUserIngress: true,
        authorization: {
          origin: 'scheduler_inbox',
          attemptKind: 'inbox_wake',
          attemptId: `${agentId}:${msgs.map((message) => message.id).join(',')}`,
        },
        acquiredLeaseRelease: releaseLease,
        controller,
        alreadyRegistered: true,
        bashApprovalMode: 'auto_deny',
        causalParentMessageId: selectCausalParent(msgs),
      })) {
        if (frame.kind === 'fatal') {
          console.error(`[scheduler] inbox wake ${agentId} fatal:`, frame.error)
        }
      }
    } catch (err) {
      console.error(`[scheduler] inbox wake ${agentId} unexpected throw:`, err)
    }
  } catch (err) {
    releaseLease()
    if (registered) unregisterAgent(agentId)
    console.error(`[scheduler] inbox drain failed for ${agentId}:`, err)
  } finally {
    s.firing.delete(key)
  }
}

async function tick(): Promise<void> {
  const s = state()
  if (s.stopped) return
  const now = Date.now()
  const ctx = getCtx()
  let triggers: AgentTrigger[]
  let recipients: string[] = []
  try {
    communicationApprovalRepo.expirePending(ctx.db, now)
    triggers = triggerRepo.listEnabled(ctx.db)
    recipients = messageRepo.listRecipientsWithUnread(ctx.db)
  } catch (err) {
    console.error('[scheduler] tick read failed:', err)
    return
  }
  for (const t of triggers) {
    if (isDue(t, now, s.cronCache)) {
      const occurrence = scheduledOccurrence(t, now)
      if (!triggerDispatchRepo.hasOpenForTrigger(ctx.db, t.id)) {
        triggerDispatchRepo.materialize(ctx.db, {
          triggerId: t.id,
          agentId: t.agentId,
          scheduledAt: occurrence,
          now,
        })
      }
      triggerRepo.markFired(ctx.db, t.id, occurrence)
    }
  }
  const work: Promise<void>[] = []
  for (const dispatch of triggerDispatchRepo.listClaimable(ctx.db, now)) {
    work.push(fireTrigger(dispatch))
  }
  for (const agentId of recipients) {
    // Same fire-and-forget shape as triggers; `fireInboxWake` internally
    // dedup-gates and bails if the agent already has an active run.
    work.push(fireInboxWake(agentId))
  }
  work.push(dispatchClaimableReviews(now))
  await Promise.allSettled(work)
}

export function startScheduler(): void {
  const s = state()
  // Replace any existing timer unconditionally so a duplicate startScheduler
  // call (e.g. test teamPolicy calling getCtx twice) doesn't leave stale loops.
  if (s.timer) clearInterval(s.timer)
  s.stopped = false
  s.timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  // Unref so the scheduler never blocks process exit in tests.
  if (typeof s.timer.unref === 'function') s.timer.unref()
}

export function stopScheduler(): void {
  const s = state()
  s.stopped = true
  if (s.timer) {
    clearInterval(s.timer)
    s.timer = null
  }
}

// Exposed for tests that want to drive the loop manually rather than wait
// on wall-clock intervals.
export async function _tickOnce(): Promise<void> {
  await tick()
}

export function _isDueForTest(
  t: AgentTrigger,
  now: number,
  cronCache: Map<string, ParsedCron> = new Map(),
): boolean {
  return isDue(t, now, cronCache)
}

export function _resetSchedulerForTest(): void {
  const s = state()
  if (s.timer) clearInterval(s.timer)
  s.timer = null
  s.firing.clear()
  s.cronCache.clear()
  s.stopped = false
}

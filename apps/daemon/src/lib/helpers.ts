// Helpers (BAZ-092): short runs of the same Agent for one self-contained task. `helper_start`
// starts one beside the Agent's own turn, in a conversation of its own that is kept with the
// Agent's sessions and never selected; it works with the Agent's tools except the helper ones and
// ask_user, and ends with its last message as its answer. Several run at once; each is a worker.
//
// Helpers live in daemon memory, like questions: a restart stops them. The turn that started one
// gets its answer from `helper_wait`; an answer that comes after that turn has ended wakes the
// Agent in the conversation the helper was started from. Stopping that turn stops its helpers.

import { randomUUID } from 'node:crypto'
import type { ChatFrame, Helper } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import { DomainError } from '../core/errors.ts'
import type { Paths } from '../core/paths.ts'
import { parseModelString } from '../core/providers.ts'
import type { HelperHost } from '../runtime/worker/ipc-protocol.ts'
import { prepareAgentTurn, runAgentTurn } from './agent-turn.ts'
import { startConversation, titleFromMessage } from './conversation-target.ts'
import { signalLiveChange } from './live-signal.ts'
import { turnFailureReason, turnFrameFailure } from './turn-outcome.ts'
import { queueWake } from './wakes.ts'

/** A helper with what only the daemon holds. */
interface Running {
  helper: Helper
  controller: AbortController
  /** The turn that started it, while that turn runs. */
  parentTurnId: string | null
  /** Its answer was given to a helper_wait. */
  reported: boolean
  ended: Promise<void>
}

const helpers = new Map<string, Running>()
/** Turns that started helpers and are still running. */
const openTurns = new Set<string>()
/** Called whenever a helper changes, for helper_wait. */
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

/** What the helper's first message says: what it is, and its task. */
export function helperMessage(task: string): string {
  return [
    '[You are a helper: a run of yourself, started from your own conversation for this one task. Nobody reads this conversation. Do the task with your tools, then end with your answer, complete on its own: your last message goes back to the conversation that started you. You cannot ask the user or start helpers.]',
    '',
    task,
  ].join('\n')
}

/** The last thing the helper said, from its turn's final messages. */
function answerOf(frame: Extract<ChatFrame, { kind: 'done' }>): string {
  for (let index = frame.messages.length - 1; index >= 0; index -= 1) {
    const message = frame.messages[index]
    if (message?.role === 'assistant' && message.content.trim()) return message.content.trim()
  }
  return ''
}

/** "running bash", "reading a page": what a frame says the helper is doing. */
function activityOf(frame: ChatFrame): string | null {
  if (frame.kind !== 'event') return null
  const event = frame.event
  if (event.type === 'tool_call') return `using ${event.name}`
  if (event.type === 'assistant_delta' || event.type === 'assistant_message')
    return 'writing its answer'
  return null
}

function wakeFor(entry: Running): void {
  const { helper } = entry
  if (entry.reported || helper.status === 'stopped') return
  entry.reported = true
  const firstLine = helper.task.split('\n')[0]?.slice(0, 80) ?? ''
  queueWake({
    id: `helper:${helper.id}`,
    agentId: helper.agentId,
    conversationId: helper.parentConversationId,
    summary:
      helper.status === 'done'
        ? `Your helper finished: ${firstLine}`
        : `Your helper failed: ${firstLine}`,
    text: [
      `Your helper ${helper.id} ${helper.status === 'done' ? 'finished' : 'failed at'} the task you gave it:`,
      helper.task,
      helper.status === 'done'
        ? `Its answer:\n${helper.answer || '(it gave none)'}`
        : `What went wrong: ${helper.error ?? 'unknown'}`,
    ].join('\n\n'),
    at: Date.now(),
  })
}

function finish(entry: Running, update: Partial<Helper>): void {
  Object.assign(entry.helper, update, { endedAt: Date.now() })
  if (entry.parentTurnId === null) wakeFor(entry)
  signalLiveChange()
  changed()
}

async function run(entry: Running, prepared: Awaited<ReturnType<typeof prepareAgentTurn>>) {
  let failure: string | null = null
  let answer = ''
  try {
    for await (const frame of runAgentTurn(prepared)) {
      const activity = activityOf(frame)
      if (activity && activity !== entry.helper.activity) {
        entry.helper.activity = activity
        changed()
      }
      failure ??= turnFrameFailure(frame)
      if (frame.kind === 'done') answer = answerOf(frame)
    }
  } catch (error) {
    failure = turnFailureReason(error)
  }
  if (entry.controller.signal.aborted) {
    finish(entry, {
      status: 'stopped',
      activity: 'stopped',
      stoppedBy: entry.helper.stoppedBy ?? 'turn',
    })
  } else if (failure) {
    finish(entry, { status: 'failed', activity: 'failed', error: failure })
  } else {
    finish(entry, { status: 'done', activity: 'done', answer })
  }
}

function view(entry: Running): Helper {
  return { ...entry.helper }
}

function own(agentId: string, id: string): Running {
  const entry = helpers.get(id)
  if (!entry || entry.helper.agentId !== agentId)
    throw new DomainError(404, `there is no helper ${id} of this Agent`)
  return entry
}

/** Start a helper for the turn's Agent; it runs on while this returns. */
export async function startHelper(input: {
  db: BazilionDb
  paths: Paths
  agentId: string
  parentConversationId: string
  parentTurnId: string
  parentSignal: AbortSignal
  task: string
  model?: string
}): Promise<Helper> {
  const task = input.task.trim()
  if (!task) throw new DomainError(400, 'say what the helper is to do (task)')
  const model = input.model?.trim() || undefined
  if (model) parseModelString(model)
  if (input.parentSignal.aborted) throw new Error('the turn has ended')
  const id = `helper-${randomUUID().replaceAll('-', '').slice(0, 8)}`
  const title = `Helper: ${titleFromMessage(task) ?? id}`.slice(0, 60)
  const conversation = startConversation(input.db, input.paths, input.agentId, title, {
    select: false,
  })
  const controller = new AbortController()
  const prepared = await prepareAgentTurn({
    origin: 'helper',
    attemptId: id,
    agentId: input.agentId,
    conversationId: conversation.id,
    message: helperMessage(task),
    attachments: [],
    helper: {
      controller,
      parentConversationId: input.parentConversationId,
      ...(model ? { model } : {}),
    },
  })
  const entry: Running = {
    helper: {
      id,
      agentId: input.agentId,
      parentConversationId: input.parentConversationId,
      conversationId: conversation.id,
      task,
      model: model ?? null,
      status: 'running',
      activity: 'starting',
      answer: null,
      error: null,
      stoppedBy: null,
      startedAt: Date.now(),
      endedAt: null,
    },
    controller,
    parentTurnId: openTurns.has(input.parentTurnId) ? input.parentTurnId : null,
    reported: false,
    ended: Promise.resolve(),
  }
  // Stopping the turn that started it stops the helper too.
  const onParentAbort = () => stop(entry, 'turn')
  input.parentSignal.addEventListener('abort', onParentAbort, { once: true })
  helpers.set(id, entry)
  entry.ended = run(entry, prepared).finally(() =>
    input.parentSignal.removeEventListener('abort', onParentAbort),
  )
  signalLiveChange()
  changed()
  return view(entry)
}

function stop(entry: Running, by: NonNullable<Helper['stoppedBy']>): void {
  if (entry.helper.status !== 'running') return
  entry.helper.stoppedBy = by
  entry.controller.abort()
}

/** Stop a running helper; one that has ended stays as it was. */
export async function stopHelper(
  agentId: string,
  id: string,
  by: NonNullable<Helper['stoppedBy']>,
): Promise<Helper> {
  const entry = own(agentId, id)
  stop(entry, by)
  await entry.ended
  return view(entry)
}

/**
 * The helpers' states once one of them changes, all of them have ended, or `waitMs` passes. An
 * answer returned here is the waiting turn's, so it wakes nobody later.
 */
export async function waitForHelpers(
  agentId: string,
  ids: readonly string[],
  waitMs: number,
  signal?: AbortSignal,
): Promise<Helper[]> {
  const entries = ids.map((id) => own(agentId, id))
  const pending = () => entries.some((entry) => entry.helper.status === 'running')
  if (pending()) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        listeners.delete(done)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      listeners.add(done)
      signal?.addEventListener('abort', done, { once: true })
    })
  }
  for (const entry of entries) if (entry.helper.status !== 'running') entry.reported = true
  return entries.map(view)
}

/** The Agent's helpers, running first, then the ones that ended, newest first. */
export function listHelpers(agentId: string): Helper[] {
  return [...helpers.values()]
    .filter((entry) => entry.helper.agentId === agentId)
    .map(view)
    .sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        b.startedAt - a.startedAt,
    )
}

export function runningHelperCount(agentId: string): number {
  return listHelpers(agentId).filter((helper) => helper.status === 'running').length
}

/** A turn that may start helpers begins: until it ends, their answers are its to wait for. */
export function turnOpened(turnId: string): void {
  openTurns.add(turnId)
}

/** The turn ended: a helper of it that has an answer nobody took wakes the Agent with it. */
export function turnClosed(turnId: string): void {
  openTurns.delete(turnId)
  for (const entry of helpers.values()) {
    if (entry.parentTurnId !== turnId) continue
    entry.parentTurnId = null
    if (entry.helper.status !== 'running') wakeFor(entry)
  }
}

/** The daemon stops: every helper stops with it. */
export async function stopAllHelpers(): Promise<void> {
  const running = [...helpers.values()].filter((entry) => entry.helper.status === 'running')
  for (const entry of running) stop(entry, 'turn')
  await Promise.allSettled(running.map((entry) => entry.ended))
}

/** The worker side of the helper tools, bound to the turn's Agent, conversation and signal. */
export function createHelperHost(input: {
  db: BazilionDb
  paths: Paths
  agentId: string
  conversationId: string
  turnId: string
  signal: AbortSignal
}): HelperHost {
  return {
    start: ({ task, model }) =>
      startHelper({
        db: input.db,
        paths: input.paths,
        agentId: input.agentId,
        parentConversationId: input.conversationId,
        parentTurnId: input.turnId,
        parentSignal: input.signal,
        task: typeof task === 'string' ? task : '',
        ...(typeof model === 'string' ? { model } : {}),
      }),
    wait: ({ ids, waitMs }, signal) => waitForHelpers(input.agentId, ids, waitMs, signal),
    stop: ({ id }) => stopHelper(input.agentId, id, 'agent'),
  }
}

/** Test-only. */
export function _resetHelpersForTest(): void {
  helpers.clear()
  openTurns.clear()
  listeners.clear()
}

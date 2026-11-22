// The live feed behind GET /api/events: the activity feed and what is open in Attention, pushed to
// every connected browser when they change. A change signal (lib/live-signal.ts) has the feed look
// at once; a check every second catches the rest (saved files, follow-ups, recorded failures). It
// runs only while someone is connected.

import { createHash } from 'node:crypto'
import type { LiveActivityEvent, LiveAttentionEvent, LiveEvent } from '@bazilion/api-types'
import { attentionSummary, projectAttention } from '../core/attention.ts'
import { readActivity } from './activity.ts'
import { waitingAttention } from './attention-waiting.ts'
import { getCtx } from './ctx.ts'
import { onLiveChange } from './live-signal.ts'

const CHECK_MS = 1_000
/** Several signals in a row (a turn starting, its first step) make one look. */
const SETTLE_MS = 25

type Listener = (event: LiveEvent) => void

export function readLiveActivity(): LiveActivityEvent {
  const { db, paths } = getCtx()
  return { type: 'activity', agents: readActivity(db, paths) }
}

export function readLiveAttention(): LiveAttentionEvent {
  const { db } = getCtx()
  const waiting = waitingAttention(db)
  const all = projectAttention(db, { state: 'all', limit: 100_000 }, waiting)
  const revision = createHash('sha256')
    .update(
      all.items
        .map((item) => `${item.key}|${item.updatedAt}|${item.acknowledgedAt ?? ''}`)
        .join('\n'),
    )
    .update(JSON.stringify(all.degraded))
    .digest('hex')
    .slice(0, 16)
  return {
    type: 'attention',
    summary: attentionSummary(db, waiting),
    revision,
    waiting: all.items.filter((item) => waiting.some((entry) => entry.key === item.key)),
  }
}

class LiveFeed {
  readonly #listeners = new Set<Listener>()
  #last = new Map<LiveEvent['type'], string>()
  #timer: NodeJS.Timeout | undefined
  #settle: NodeJS.Timeout | undefined
  #unsignal: (() => void) | undefined

  /** Listen; the current state is sent first. Returns the function that stops listening. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    // Only the newcomer gets this; the next check still tells everyone else about a change.
    for (const event of this.#read()) listener(event)
    if (this.#listeners.size === 1) this.#start()
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) this.#stop()
    }
  }

  get listeners(): number {
    return this.#listeners.size
  }

  #start(): void {
    this.#timer = setInterval(() => this.#check(), CHECK_MS)
    this.#timer.unref()
    this.#unsignal = onLiveChange(() => {
      this.#settle ??= setTimeout(() => {
        this.#settle = undefined
        this.#check()
      }, SETTLE_MS)
    })
  }

  #stop(): void {
    clearInterval(this.#timer)
    clearTimeout(this.#settle)
    this.#timer = undefined
    this.#settle = undefined
    this.#unsignal?.()
    this.#unsignal = undefined
    this.#last.clear()
  }

  #read(): LiveEvent[] {
    const events: LiveEvent[] = []
    try {
      events.push(readLiveActivity())
    } catch (error) {
      console.warn(`live feed: activity: ${error instanceof Error ? error.message : error}`)
    }
    try {
      events.push(readLiveAttention())
    } catch (error) {
      console.warn(`live feed: attention: ${error instanceof Error ? error.message : error}`)
    }
    return events
  }

  #check(): void {
    if (this.#listeners.size === 0) return
    for (const event of this.#read()) {
      const json = JSON.stringify(event)
      if (this.#last.get(event.type) === json) continue
      this.#last.set(event.type, json)
      for (const listener of this.#listeners) listener(event)
    }
  }
}

const FEED_KEY = Symbol.for('bazilion.live.feed')

/** One feed per process, pinned like the turn registry so a split bundle still shares it. */
export function liveFeed(): LiveFeed {
  const holder = globalThis as unknown as Record<symbol, LiveFeed | undefined>
  holder[FEED_KEY] ??= new LiveFeed()
  return holder[FEED_KEY]
}

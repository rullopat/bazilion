// Background turns that failed where nothing else keeps a record: an Agent woken by new mail has
// no queue row and no dispatch row. Attention lists them with the failed follow-ups. They are kept
// in the daemon's memory, so a daemon restart forgets them.

export interface RememberedTurnFailure {
  id: string
  agentId: string
  origin: 'inbox'
  at: number
  reason: string
}

const KEY = Symbol.for('bazilion.turn-failures')
/** The most kept; the oldest go first. */
const MAX_KEPT = 200
/** Older ones are dropped. */
const KEPT_MS = 14 * 86_400_000

function store(): RememberedTurnFailure[] {
  const holder = globalThis as unknown as Record<symbol, RememberedTurnFailure[] | undefined>
  holder[KEY] ??= []
  return holder[KEY]
}

/**
 * Keep a failure. One with the id of a kept one (the same wake-up tried again) takes its place
 * but keeps its time: a retry is the same failure, so an acknowledgement of it holds.
 */
export function rememberTurnFailure(failure: RememberedTurnFailure): void {
  const kept = store()
  const at = kept.findIndex((entry) => entry.id === failure.id)
  const first = at >= 0 ? kept[at] : undefined
  if (at >= 0) kept.splice(at, 1)
  kept.push(first ? { ...failure, at: first.at } : failure)
  const since = failure.at - KEPT_MS
  // The one just kept stays, however long ago it first failed.
  const fresh = kept
    .filter((entry) => entry.at >= since || entry.id === failure.id)
    .slice(-MAX_KEPT)
  kept.splice(0, kept.length, ...fresh)
}

/** Forget one kept failure: the wake-up that could not start has now started. */
export function forgetTurnFailure(id: string): boolean {
  const kept = store()
  const at = kept.findIndex((entry) => entry.id === id)
  if (at < 0) return false
  kept.splice(at, 1)
  return true
}

export function rememberedTurnFailures(): readonly RememberedTurnFailure[] {
  return store()
}

/** Forget an Agent's (a deleted Agent), or every one (tests). */
export function forgetTurnFailures(agentId?: string): void {
  const kept = store()
  kept.splice(
    0,
    kept.length,
    ...kept.filter((entry) => agentId !== undefined && entry.agentId !== agentId),
  )
}

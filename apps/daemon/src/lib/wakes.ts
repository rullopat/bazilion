// Wakes: something an Agent started that ends after its turn (a background job, a picture, an
// answer to an action it asked for) starts a turn of its own, in the conversation it came from.
// The scheduler fires them when the Agent is free, several of one conversation in one turn.
// They are kept in the daemon's memory; what must survive a restart (jobs) queues its wake again
// at startup.

export interface Wake {
  id: string
  agentId: string
  conversationId: string
  /** One line saying what happened: the turn's title in the transcript. */
  summary: string
  /** What the Agent is told, after the summary. */
  text: string
  at: number
  /** Asked again when the wake is due; false drops it (the Agent already saw it in a turn). */
  stillWanted?: () => boolean
  /** Called once the wake's turn has started. */
  onFired?: () => void
}

/** Marks a wake turn's message, so the transcript shows it as an update rather than a request. */
export const WAKE_PREFIX = '[[bazilion:wake]]\n'

const KEY = Symbol.for('bazilion.wakes')

function store(): Map<string, Wake[]> {
  const holder = globalThis as unknown as Record<symbol, Map<string, Wake[]> | undefined>
  holder[KEY] ??= new Map()
  return holder[KEY]
}

export function queueWake(wake: Wake): void {
  const queued = store().get(wake.agentId) ?? []
  if (queued.some((entry) => entry.id === wake.id)) return
  queued.push(wake)
  store().set(wake.agentId, queued)
}

/** Agents with a wake waiting. */
export function agentsWithWakes(): string[] {
  return [...store().entries()].filter(([, wakes]) => wakes.length > 0).map(([id]) => id)
}

/**
 * The wakes of the Agent's oldest waiting conversation, taken off the queue; those no longer
 * wanted are dropped on the way.
 */
export function takeWakes(agentId: string): Wake[] {
  const queued = (store().get(agentId) ?? []).filter((wake) => wake.stillWanted?.() ?? true)
  const first = queued[0]
  if (!first) {
    store().delete(agentId)
    return []
  }
  const taken = queued.filter((wake) => wake.conversationId === first.conversationId)
  const rest = queued.filter((wake) => wake.conversationId !== first.conversationId)
  if (rest.length > 0) store().set(agentId, rest)
  else store().delete(agentId)
  return taken
}

/** Put wakes back at the front, when their turn could not start. */
export function returnWakes(wakes: readonly Wake[]): void {
  for (const wake of [...wakes].reverse()) {
    const queued = store().get(wake.agentId) ?? []
    if (!queued.some((entry) => entry.id === wake.id)) queued.unshift(wake)
    store().set(wake.agentId, queued)
  }
}

/** The message of a wake turn. */
export function wakeMessage(wakes: readonly Wake[]): string {
  const title = wakes.length === 1 ? (wakes[0]?.summary ?? 'An update') : `${wakes.length} updates`
  const body = wakes.map((wake) =>
    wakes.length === 1 ? wake.text : `## ${wake.summary}\n\n${wake.text}`,
  )
  return [
    `${WAKE_PREFIX}${title}`,
    '',
    'Something you started earlier has an update. Nobody is waiting on this turn: work out what it means for the work in this conversation, carry on with it if there is more to do, and tell the user what they need to know in a few lines.',
    '',
    ...body,
  ].join('\n')
}

/** Tests: forget every wake. */
export function _resetWakesForTest(): void {
  store().clear()
}

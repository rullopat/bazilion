// An Agent's progress cards (BAZ-097): each `progress` call names a card by id (the first call's
// own tool-call id), and the conversation shows one card per id, where it was first put, in the
// state of the latest call.

import { CircleCheck, CircleDashed, CircleX, ListTodo, LoaderCircle } from 'lucide-react'
import { createContext, useContext } from 'react'
import { parseArgs } from '../../lib/tool-steps'
import type { RenderEntry, Step } from './entries'

export type StepState = 'todo' | 'doing' | 'done' | 'failed'

export interface ProgressCardState {
  task: string
  steps: { step: string; state: StepState; note?: string }[]
}

const STATES: readonly StepState[] = ['todo', 'doing', 'done', 'failed']

/** The card one `progress` call describes, and the id of the card it updates. */
export function readProgress(
  callId: string,
  rawArgs: string,
): { id: string; card: ProgressCardState } | null {
  const args = parseArgs(rawArgs)
  if (!args || typeof args.task !== 'string' || !Array.isArray(args.steps)) return null
  const steps = args.steps.flatMap((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>
    if (typeof entry.step !== 'string' || !entry.step.trim()) return []
    const state = STATES.includes(entry.state as StepState) ? (entry.state as StepState) : 'todo'
    const note = typeof entry.note === 'string' && entry.note.trim() ? entry.note : undefined
    return [{ step: entry.step, state, ...(note ? { note } : {}) }]
  })
  const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : callId
  return { id, card: { task: args.task, steps } }
}

/** For the whole conversation: where each card shows (its first call) and its latest state. */
export interface ProgressBoard {
  /** The call that put a card in the conversation → that card's id. */
  shownAt: Map<string, string>
  latest: Map<string, ProgressCardState>
}

export function progressBoard(entries: readonly RenderEntry[]): ProgressBoard {
  const shownAt = new Map<string, string>()
  const latest = new Map<string, ProgressCardState>()
  const placed = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== 'tool') continue
    for (const item of entry.items) {
      if (item.kind !== 'call' || item.name !== 'progress') continue
      const read = readProgress(item.id, item.body)
      if (!read) continue
      latest.set(read.id, read.card)
      if (!placed.has(read.id)) {
        placed.add(read.id)
        shownAt.set(item.id, read.id)
      }
    }
  }
  return { shownAt, latest }
}

export const ProgressContext = createContext<ProgressBoard>({
  shownAt: new Map(),
  latest: new Map(),
})

const ICON = {
  todo: { Icon: CircleDashed, className: 'text-muted-foreground', label: 'to do' },
  doing: { Icon: LoaderCircle, className: 'animate-spin text-sapphire', label: 'in progress' },
  done: { Icon: CircleCheck, className: 'text-success', label: 'done' },
  failed: { Icon: CircleX, className: 'text-destructive', label: 'failed' },
} as const

/** The cards a block of steps puts in the conversation: none for calls that only update one. */
export function ProgressCards({ steps }: { steps: Step[] }) {
  const board = useContext(ProgressContext)
  const cards = steps.flatMap((step) => {
    const id = board.shownAt.get(step.id)
    const card = id ? board.latest.get(id) : undefined
    return id && card ? [{ id, card }] : []
  })
  return cards.map(({ id, card }) => <ProgressCard key={id} card={card} />)
}

function ProgressCard({ card }: { card: ProgressCardState }) {
  const done = card.steps.filter((step) => step.state === 'done').length
  return (
    <section
      aria-label={`Progress: ${card.task}`}
      className="my-3 rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm"
    >
      <header className="mb-1.5 flex items-center gap-2">
        <ListTodo className="size-[15px] shrink-0 text-mocha" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{card.task}</span>
        <span className="shrink-0 text-xs text-mocha">
          {done} of {card.steps.length} done
        </span>
      </header>
      <ol className="m-0 list-none space-y-1 p-0">
        {card.steps.map((step, index) => {
          const { Icon, className, label } = ICON[step.state]
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a card's steps are its list as given.
            <li key={index} className="flex items-start gap-2">
              <Icon className={`mt-0.5 size-[15px] shrink-0 ${className}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={step.state === 'done' ? 'text-mocha' : 'text-foreground'}>
                  {step.step}
                </span>
                <span className="sr-only">, {label}</span>
                {step.note && (
                  <span className="block text-xs text-mocha [overflow-wrap:anywhere]">
                    {step.note}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

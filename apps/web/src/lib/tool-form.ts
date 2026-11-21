// What a card of the Tools page holds while it is being edited, and what it sends when saved.

import type { ServiceCard, ServiceFieldState } from '@bazilion/api-types'

/**
 * A card's form: every setting as text. A switch is its on or off value, a choice its option, a
 * number what was typed in the unit shown. A secret is empty until a new one is typed.
 */
export interface Draft {
  values: Record<string, string>
  /** Stored secrets to remove with the next save. */
  removed: string[]
}

/** A stored number in the unit people read: 900000 ms is 15 minutes. */
export function shownNumber(field: ServiceFieldState, stored: string): string {
  const input = field.input
  if (input.type !== 'number') return stored
  const scale = input.scale ?? 1
  const value = Number(stored) / scale
  // A value stored before it was checked can sit between two units: show it, do not round it away.
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

/** What a typed number is stored as, or null when it is not a whole number of the unit. */
export function storedNumber(field: ServiceFieldState, typed: string): string | null {
  const input = field.input
  if (input.type !== 'number') return typed
  if (!/^\d+$/.test(typed.trim())) return null
  return String(Number(typed.trim()) * (input.scale ?? 1))
}

function initialValue(field: ServiceFieldState): string {
  if (field.kind === 'secret') return ''
  switch (field.input.type) {
    case 'number':
      return shownNumber(field, field.effective ?? String(field.input.default))
    case 'text':
      // What the environment sets is shown, though it cannot be changed here.
      return field.environment ? (field.effective ?? '') : (field.value ?? '')
    default:
      return field.effective ?? ''
  }
}

export function initialDraft(card: ServiceCard): Draft {
  return {
    values: Object.fromEntries(card.fields.map((field) => [field.envVar, initialValue(field)])),
    removed: [],
  }
}

/** Whether a setting matters with the rest of the form as it is now. */
export function applies(field: ServiceFieldState, draft: Draft): boolean {
  return (field.when ?? []).every((rule) => rule.is.includes(draft.values[rule.envVar] ?? ''))
}

/** The numbers that cannot be saved as typed, with what to say about each. */
export function numberProblems(card: ServiceCard, draft: Draft): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const field of card.fields) {
    const input = field.input
    if (input.type !== 'number' || field.environment || !applies(field, draft)) continue
    const typed = draft.values[field.envVar] ?? ''
    if (typed === initialValue(field) && !field.unusable) continue
    const scale = input.scale ?? 1
    const stored = storedNumber(field, typed)
    const range = `from ${input.min / scale} to ${input.max / scale}`
    if (stored === null) problems[field.envVar] = `A whole number ${range}.`
    else if (Number(stored) < input.min || Number(stored) > input.max) {
      problems[field.envVar] = `It has to be ${range}.`
    }
  }
  return problems
}

/**
 * What saving the card sends: only what was changed, as it is stored. A setting the environment
 * sets is left alone, and so is one that does not matter with the choices made.
 */
export function changedValues(card: ServiceCard, draft: Draft): Record<string, string> {
  const changed: Record<string, string> = {}
  for (const field of card.fields) {
    if (field.environment && field.kind !== 'secret') continue
    const typed = draft.values[field.envVar] ?? ''
    if (field.kind === 'secret') {
      if (typed.trim()) changed[field.envVar] = typed.trim()
      else if (draft.removed.includes(field.envVar) && field.set) changed[field.envVar] = ''
      continue
    }
    // A stored value the daemon cannot use is replaced by what the card shows, touched or not.
    if ((typed === initialValue(field) && !field.unusable) || !applies(field, draft)) continue
    changed[field.envVar] =
      field.input.type === 'number' ? (storedNumber(field, typed) ?? typed) : typed.trim()
  }
  return changed
}

export function isDirty(card: ServiceCard, draft: Draft): boolean {
  return Object.keys(changedValues(card, draft)).length > 0
}

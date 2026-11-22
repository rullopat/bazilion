// The keyboard shortcuts, in one list that the help dialog shows and the handlers follow. None of
// them fires while you type in a field, except the two that use ⌘ or Ctrl.

/** Asks the open conversation's menu to start a new conversation, as its own item does. */
export const NEW_CONVERSATION_EVENT = 'bazilion:new-conversation'

export interface Shortcut {
  /** The keys as they are written on this machine: ⌘ on a Mac, Ctrl elsewhere. */
  keys: (mac: boolean) => string[]
  does: string
  /** Where it works. */
  where: 'everywhere' | 'workspace'
}

const mod = (mac: boolean) => (mac ? '⌘' : 'Ctrl')
const alt = (mac: boolean) => (mac ? '⌥' : 'Alt')

export const SHORTCUTS: readonly Shortcut[] = [
  {
    keys: (mac) => [mod(mac), 'K'],
    does: 'Jump to an Agent, a Team or a page, or run an action',
    where: 'everywhere',
  },
  { keys: () => ['?'], does: 'Show these shortcuts', where: 'everywhere' },
  { keys: () => ['/'], does: 'Write to the open Agent', where: 'workspace' },
  { keys: (mac) => [alt(mac), '↓'], does: 'Open the next Agent in the list', where: 'workspace' },
  {
    keys: (mac) => [alt(mac), '↑'],
    does: 'Open the previous Agent in the list',
    where: 'workspace',
  },
  { keys: (mac) => [mod(mac), '.'], does: 'Show or hide the side panel', where: 'workspace' },
  { keys: () => ['Esc'], does: 'Close a dialog, a menu or a sheet', where: 'everywhere' },
]

/**
 * Whether keys typed now belong to a field or a control that reads the keyboard itself (a
 * dropdown, a menu, a list), where a plain-key shortcut must not fire.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (
    target.closest(
      '[role="combobox"],[role="listbox"],[role="menu"],[role="option"],[role="menuitem"],[role="slider"]',
    )
  )
    return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
    type,
  )
}

/** The Agent next to `current` in the list's order, wrapping round; undefined when there is none. */
export function neighbour<T extends { id: string }>(
  ordered: readonly T[],
  current: string | undefined,
  step: 1 | -1,
): T | undefined {
  if (ordered.length === 0) return undefined
  const at = ordered.findIndex((item) => item.id === current)
  if (at === -1) return step === 1 ? ordered[0] : ordered[ordered.length - 1]
  return ordered[(at + step + ordered.length) % ordered.length]
}

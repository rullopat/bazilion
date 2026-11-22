// "Something the live feed shows may have changed." The question and approval registries, turn
// start and end, and Attention acknowledgements raise it so the feed answers at once; it imports
// nothing, so any module can raise it without an import cycle.

const listeners = new Set<() => void>()

export function signalLiveChange(): void {
  for (const listener of listeners) listener()
}

export function onLiveChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

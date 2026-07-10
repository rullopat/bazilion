import { useCallback, useEffect, useState } from 'react'
import {
  HARNESS_STORAGE_KEY,
  createHarnessFixtureState,
  loadHarnessPrototypeState,
  persistHarnessPrototypeState,
  type HarnessPrototypeState,
} from '../lib/harness-prototype'

const CHANGE_EVENT = 'bazilion:harness-prototype-change'

type StateUpdater =
  | HarnessPrototypeState
  | ((current: HarnessPrototypeState) => HarnessPrototypeState)

interface HarnessPrototypeHook {
  state: HarnessPrototypeState
  hydrated: boolean
  update: (updater: StateUpdater) => void
  reset: () => void
}

function eventState(event: Event): HarnessPrototypeState | null {
  if (!(event instanceof CustomEvent)) return null
  const detail: unknown = event.detail
  if (!detail || typeof detail !== 'object') return null
  const candidate = detail as Partial<HarnessPrototypeState>
  return candidate.version === 1 ? (detail as HarnessPrototypeState) : null
}

export function useHarnessPrototype(): HarnessPrototypeHook {
  const [state, setState] = useState<HarnessPrototypeState>(() => createHarnessFixtureState())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setState(loadHarnessPrototypeState())
    setHydrated(true)

    const onChange = (event: Event) => {
      setState(eventState(event) ?? loadHarnessPrototypeState())
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === HARNESS_STORAGE_KEY) setState(loadHarnessPrototypeState())
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const update = useCallback((updater: StateUpdater) => {
    const current = loadHarnessPrototypeState()
    const next = typeof updater === 'function' ? updater(current) : updater
    persistHarnessPrototypeState(next)
    setState(next)
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }))
  }, [])

  const reset = useCallback(() => {
    const next = createHarnessFixtureState()
    persistHarnessPrototypeState(next)
    setState(next)
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }))
  }, [])

  return { state, hydrated, update, reset }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'

export interface Resource<T> {
  /** Undefined until the first load answers. */
  data: T | undefined
  error: string | null
  loading: boolean
  /** Load again, keeping the data on screen meanwhile. */
  reload: () => Promise<void>
}

/**
 * Load something from the daemon when a panel opens, and again whenever a dependency changes.
 * `load` gets a signal that aborts when the dependencies change or the component goes away.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback(async (reset: boolean) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (reset) setData(undefined)
    setLoading(true)
    try {
      const next = await loadRef.current(controller.signal)
      if (controller.signal.aborted) return
      setData(next)
      setError(null)
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(errorMessage(cause))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(
    () => {
      void run(true)
      return () => controllerRef.current?.abort()
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's dependencies decide.
    deps,
  )

  return { data, error, loading, reload: useCallback(() => run(false), [run]) }
}

/** False on the server and during hydration, true afterwards: for what only the browser knows. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}

/** Whether a media query matches; `initial` until the browser says. */
export function useMediaQuery(query: string, initial = true): boolean {
  const [matches, setMatches] = useState(initial)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

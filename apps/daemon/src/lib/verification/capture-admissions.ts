const unavailable = () =>
  new Error('Native verification capture admission is stopping or unavailable')

/** Only outstanding operator-native readiness; no runs, retries, transcripts or persistent layer. */
export function createNativeCaptureAdmissions() {
  const active = new Map<AbortController, Promise<unknown>>()
  let stopped = false,
    stopping: Promise<void> | undefined
  return Object.freeze({
    run<T>(caller: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (stopped || active.size >= 256) return Promise.reject(unavailable())
      const controller = new AbortController(),
        signal = caller ? AbortSignal.any([controller.signal, caller]) : controller.signal
      try {
        signal.throwIfAborted()
        // Invoke now so the operation snapshots its intent before the first asynchronous boundary.
        const operation = Promise.resolve(task(signal))
        active.set(controller, operation)
        void operation
          .finally(() => {
            if (active.get(controller) === operation) active.delete(controller)
          })
          .catch(() => {})
        return operation
      } catch (error) {
        return Promise.reject(error)
      }
    },
    stop(): Promise<void> {
      if (stopping) return stopping
      stopped = true
      for (const controller of active.keys()) controller.abort()
      stopping = Promise.allSettled([...active.values()]).then(() => {})
      return stopping
    },
  })
}
const KEY = Symbol.for('bazilion.native-verification-capture-admissions')
export function nativeCaptureAdmissions() {
  const global = globalThis as typeof globalThis &
    Record<symbol, ReturnType<typeof createNativeCaptureAdmissions> | undefined>
  global[KEY] ??= createNativeCaptureAdmissions()
  return global[KEY]
}
export function stopNativeVerificationCaptures(): Promise<void> {
  return nativeCaptureAdmissions().stop()
}

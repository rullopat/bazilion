import { Button } from './Button'

export function RecoveryState({
  title,
  error,
  reset,
  fallbackHref,
}: {
  title: string
  error: Error
  reset: () => void
  fallbackHref: string
}) {
  return (
    <section role="alert" className="mx-auto my-10 max-w-2xl rounded-md border border-rose-baziu bg-snow p-6">
      <h1 className="text-2xl">{title}</h1>
      <p className="mt-2 text-sm text-mocha">
        The authoritative daemon projection could not be loaded. No local or stale policy has
        been substituted.
      </p>
      <pre className="mt-4 overflow-auto rounded-md bg-ivory p-3 text-xs">{error.message}</pre>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>retry</Button>
        <a className="ghost-btn" href={fallbackHref}>go to a safe page</a>
      </div>
    </section>
  )
}

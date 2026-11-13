import { type ErrorComponentProps, useRouter } from '@tanstack/react-router'
import { Button } from './Button'
import { PageShell } from './Page'

/** The router's error view for every route: a loader failed. The top nav stays usable. */
export function RouteErrorState({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <PageShell>
      <section
        role="alert"
        className="mx-auto my-10 w-full max-w-2xl rounded-md border border-rose-baziu bg-snow p-6"
      >
        <h1 className="text-2xl">Could not load this page</h1>
        <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-md bg-ivory p-3 text-xs">
          {error.message}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void router.invalidate()}>
            Retry
          </Button>
          <a className="ghost-btn" href="/">
            Home
          </a>
        </div>
      </section>
    </PageShell>
  )
}

/** The router's pending view while a loader runs. */
export function RoutePendingState() {
  return (
    <PageShell>
      <div aria-busy="true" className="my-10 flex items-center justify-center gap-3">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-fawn border-t-transparent"
        />
        <span className="text-sm text-mocha">Loading…</span>
      </div>
    </PageShell>
  )
}

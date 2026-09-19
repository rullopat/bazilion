import { Button } from './Button'
import { PageShell } from './Page'

/**
 * Router-level fallbacks (BAZ-050). Every route without its own `errorComponent`
 * or `pendingComponent` degrades to these, so a loader failure or a slow
 * navigation never renders TanStack's developer-grade default or a blank content
 * area. Route-specific `errorComponent`s (RecoveryState) remain the better
 * fallback where a surface's title and safe exit are worth naming.
 */

/**
 * Loader/segment error: the server function threw and nothing more specific
 * caught it. Names what happened, offers retry, and keeps navigation possible —
 * the layout (sidebar, top nav) is outside the route component, so it survives.
 */
export function RouteErrorState({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell>
      <section
        role="alert"
        className="mx-auto my-10 w-full max-w-2xl rounded-md border border-rose-baziu bg-snow p-6"
      >
        <h1 className="text-2xl">This page could not be loaded</h1>
        <p className="mt-2 text-sm text-mocha">
          The authoritative daemon projection could not be loaded. Nothing has been changed;
          no local or stale data has been substituted.
        </p>
        <pre className="mt-4 overflow-auto rounded-md bg-ivory p-3 text-xs">{error.message}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={reset}>
            retry
          </Button>
          <a className="ghost-btn" href="/">
            go to the overview
          </a>
        </div>
      </section>
    </PageShell>
  )
}

/**
 * Loader in flight. Deliberately small: the sidebar and previous content stay
 * put, this only marks the content area as working. aria-busy is the
 * accessibility contract; the label is for everyone else.
 */
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

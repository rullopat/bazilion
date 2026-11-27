import type { ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'
import { isStaleBuildError, reloadForNewBuild } from '../lib/stale-build'
import { Button } from './Button'
import { PageShell } from './Page'

/** The router's error view for every route: a loader failed. The top nav stays usable. */
export function RouteErrorState({ error }: ErrorComponentProps) {
  const stale = isStaleBuildError(error)
  // Opened before an upgrade: the new build is one reload away.
  useEffect(() => {
    if (stale) reloadForNewBuild()
  }, [stale])
  if (stale) {
    return (
      <PageShell>
        <section
          role="alert"
          className="mx-auto my-10 w-full max-w-2xl rounded-md border border-border bg-snow p-6"
        >
          <h1 className="text-2xl">Bazilion was updated</h1>
          <p className="mt-3 text-sm text-mocha">
            This page was opened before the update, and the part it asked for belongs to the version
            before. Reload the page to use the new one.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </section>
      </PageShell>
    )
  }
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
          {/* A whole reload: the server may have come back as a newer build (an upgrade), which
              data asked for by this page's old code would not show. */}
          <Button variant="primary" onClick={() => window.location.reload()}>
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

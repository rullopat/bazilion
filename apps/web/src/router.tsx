import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { RouteErrorState, RoutePendingState } from './components/RouteStates'
import { routeTree } from './routeTree.gen'

// TanStack Start v1 calls `getRouter` from the resolved router entry. Older
// docs/examples use `createRouter`; newer runtime requires the `getRouter`
// alias too. Export both so we're forward-compat with any plugin version
// shift, and keep typed `Register` for full router intellisense.
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // BAZ-050: every route without its own error/pending component degrades to
    // these. Route-specific errorComponents (RecoveryState with a named surface
    // and a safe exit) remain the better fallback where they exist.
    defaultErrorComponent: RouteErrorState,
    defaultPendingComponent: RoutePendingState,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

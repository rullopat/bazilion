import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { RouteErrorState, RoutePendingState } from './components/RouteStates'
import { routeTree } from './routeTree.gen'

// TanStack Start calls `getRouter` from the router entry.
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultErrorComponent: RouteErrorState,
    defaultPendingComponent: RoutePendingState,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

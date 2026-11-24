import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { RouteErrorState, RoutePendingState } from './components/RouteStates'
import { routeTree } from './routeTree.gen'

// TanStack Start calls `getRouter` from the router entry.
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    // The pages scroll the window, and Back puts it where it was. The workspace scrolls inside:
    // the router knows a scrolling area by where it stands in the page, so it would put one
    // conversation's offset on the next Agent's (every conversation stands in the same place).
    // There each conversation keeps its own place (`lib/transcript-scroll.ts`), and the router
    // leaves it alone.
    scrollRestoration: ({ location }) => location.pathname !== '/',
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

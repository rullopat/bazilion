import { createRouter as createTanStackRouter } from '@tanstack/react-router'
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
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

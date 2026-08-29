import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/dm-serif-display/latin-400.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import { Footer } from '../components/Footer'
import { TopNav } from '../components/TopNav'
import { PUBLIC_PATHS, fetchAuthState, isSetupOpen } from '../lib/auth'
import { installCsrfFetch } from '../lib/csrf-fetch'
import appCss from '../styles.css?url'

// Sync, runs in <head> before paint. Reads 'baziu-theme' from localStorage
// ('system' | 'light' | 'dark'; default 'system'), resolves against the OS
// preference, and toggles `.dark` on <html> so the dark CSS variables in
// styles.css apply during the first paint. ThemeToggle reads/writes the
// same key. Wrapped in try/catch so a denied localStorage (private mode,
// disabled storage) just falls through to light.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('baziu-theme');var sd=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||((t===null||t==='system')&&sd);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`

installCsrfFetch()

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const path = location.pathname
    // Login form lives here, no auth required.
    if (PUBLIC_PATHS.has(path)) return
    // /api/* short-circuits via the catch-all proxy + daemon's own auth.
    if (path.startsWith('/api/')) return

    const auth = await fetchAuthState()
    if (!auth.authed) {
      throw redirect({ to: '/login', search: {} })
    }
    if (!isSetupOpen(path) && !auth.setupComplete) {
      throw redirect({ to: '/welcome' })
    }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'bazilion' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/baziu.svg' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
})

function NotFound() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card">
        <h1>Not found</h1>
        <p className="muted my-3">
          Nothing lives at <code>{pathname}</code>.
        </p>
        <Link to="/">Back to home</Link>
      </div>
    </div>
  )
}

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isLogin = pathname === '/login'
  // Interactive workspaces fill the viewport and hide the footer.
  // Everything else gets the centered application shell and footer.
  const isHome = pathname === '/'
  const isWorkspace = isHome

  return (
    // In workspaces, lock html + body to the viewport so only the inner panels
    // scroll. Otherwise the global `html { overflow-y: scroll }` rule
    // (which keeps a stable scrollbar gutter on content pages) lets the whole
    // page scroll when chat content overflows. Per-route layout flag rides on
    // `data-layout` (not className) so React's reconciliation never overwrites
    // the `dark` class that THEME_INIT_SCRIPT sets on <html> pre-paint — see
    // `html[data-layout='workspace']` in styles.css.
    // suppressHydrationWarning: THEME_INIT_SCRIPT adds/removes the `dark` class
    // on <html> before React hydrates, which would otherwise trip a hydration
    // mismatch.
    <html lang="en" data-layout={isWorkspace ? 'workspace' : 'page'} suppressHydrationWarning>
      <head>
        {/* Runs before paint to apply the user's theme choice without FOUC. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body data-layout={isWorkspace ? 'workspace' : 'page'}>
        {!isLogin && (
          <a
            href="#main-content"
            className="sr-only z-[100] rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
          >
            Skip to main content
          </a>
        )}
        {isLogin ? (
          <Outlet />
        ) : isWorkspace ? (
          <div className="flex h-dvh flex-col">
            <div className="px-3 sm:px-5">
              <TopNav />
            </div>
            <main id="main-content" tabIndex={-1} className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 overflow-hidden px-3 pb-3 sm:px-5 sm:pb-5">
              <Outlet />
            </main>
          </div>
        ) : (
          <div className="flex min-h-dvh flex-col">
            <div className="px-3 sm:px-5">
              <TopNav />
            </div>
            <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-9 sm:px-6 sm:py-12">
              <Outlet />
            </main>
            <div className="px-4 sm:px-6">
              <Footer />
            </div>
          </div>
        )}
        <Scripts />
      </body>
    </html>
  )
}

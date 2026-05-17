import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { Footer } from '../components/Footer'
import { TopNav } from '../components/TopNav'
import { PUBLIC_PATHS, fetchAuthState, isSetupOpen } from '../lib/auth'
import appCss from '../styles.css?url'

// Sync, runs in <head> before paint. Reads 'baziu-theme' from localStorage
// ('system' | 'light' | 'dark'; default 'system'), resolves against the OS
// preference, and toggles `.dark` on <html> so the dark CSS variables in
// styles.css apply during the first paint. ThemeToggle reads/writes the
// same key. Wrapped in try/catch so a denied localStorage (private mode,
// disabled storage) just falls through to light.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('baziu-theme');var sd=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||((t===null||t==='system')&&sd);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`

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
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: '' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500&display=swap',
      },
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
  // Home is full-height (chat fills the viewport) and hides the footer.
  // Everything else gets the standard 1100px-shell + footer.
  const isHome = pathname === '/'

  return (
    // On home, lock html + body to the viewport so only the chat panel + sidebar
    // scroll internally. Otherwise the global `html { overflow-y: scroll }` rule
    // (which keeps a stable scrollbar gutter on content pages) lets the whole
    // page scroll when chat content overflows.
    // suppressHydrationWarning: the THEME_INIT_SCRIPT below adds/removes the
    // `dark` class on <html> before React hydrates, which would otherwise
    // trip a hydration mismatch.
    <html
      lang="en"
      className={isHome ? 'h-dvh overflow-hidden' : ''}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before paint to apply the user's theme choice without FOUC. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className={isHome ? 'h-dvh overflow-hidden' : ''}>
        {isLogin ? (
          <Outlet />
        ) : isHome ? (
          <div className="flex h-dvh flex-col px-6">
            <TopNav />
            <main className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          </div>
        ) : (
          <div className="flex min-h-dvh flex-col px-6 pb-12">
            <TopNav />
            <main className="mt-8 flex-1">
              <Outlet />
            </main>
            <Footer />
          </div>
        )}
        <Scripts />
      </body>
    </html>
  )
}

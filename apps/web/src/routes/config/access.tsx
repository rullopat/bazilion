import type { ListSessionsResponse, ListTokensResponse } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import { MintTokenCard, SessionsCard, TokensCard } from '../../components/setup/AccessCards'
import { daemonClient } from '../../lib/daemon-client'

const fetchTokens = createServerFn({ method: 'GET' })
  .validator((data: { all: boolean }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [tokens, sessions] = await Promise.all([
      client.get<ListTokensResponse>(`/api/tokens${data.all ? '?includeRevoked=1' : ''}`),
      client.get<ListSessionsResponse>('/api/sessions'),
    ])
    // Whether a token has expired is counted from one clock, on the server and in the browser.
    return { ...tokens, ...sessions, now: Date.now() }
  })

export const Route = createFileRoute('/config/access')({
  // The router parses `?all=1` into the number 1 (and would rewrite a string '1' as `"1"`).
  validateSearch: (search: Record<string, unknown>): { all?: 1 } => ({
    all: search.all === 1 ? 1 : undefined,
  }),
  loaderDeps: ({ search }) => ({ all: search.all === 1 }),
  loader: ({ deps }) => fetchTokens({ data: deps }),
  component: AccessPage,
})

function AccessPage() {
  const { tokens, sessions, now } = Route.useLoaderData()
  const includeRevoked = Route.useSearch().all === 1
  const router = useRouter()

  /** Revoking the session this browser uses signs it out. */
  async function afterRevoke(signedOut: boolean) {
    if (signedOut) window.location.assign('/login')
    else await router.invalidate({ sync: true })
  }

  return (
    <ConfigPage
      title="Access"
      description={
        <>
          Every token has full access to the HTTP API, the CLI and browser login. The{' '}
          <code>bootstrap</code> token from <code>~/.bazilion/auth.json</code> cannot be revoked;
          mint a separate, revocable token for each other device.
        </>
      }
    >
      <MintTokenCard onMinted={() => router.invalidate({ sync: true })} />
      <TokensCard
        tokens={tokens}
        sessions={sessions}
        includeRevoked={includeRevoked}
        now={now}
        onRevoked={afterRevoke}
      />
      <SessionsCard sessions={sessions} onRevoked={afterRevoke} />
    </ConfigPage>
  )
}

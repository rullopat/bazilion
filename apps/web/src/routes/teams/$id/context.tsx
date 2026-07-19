import type { Team } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { PageShell } from '../../../components/Page'
import { TeamTabs } from '../../../components/TeamTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchContext = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<Team>(`/api/teams/${encodeURIComponent(data.id)}`),
  )

export const Route = createFileRoute('/teams/$id/context')({
  loader: ({ params }) => fetchContext({ data: params }),
  component: ContextPage,
})

function ContextPage() {
  const team = Route.useLoaderData()
  return (
    <PageShell>
      <h1>Team context</h1>
      <p className="muted">Workspace, operator context, and integrations owned by this Team.</p>
      <TeamTabs teamId={team.id} />
      <section className="card">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="muted">workspace path</dt><dd><code>{team.path}</code></dd></div>
          <div><dt className="muted">Telegram topic format</dt><dd><code>{team.telegramTopicNameFormat ?? 'built-in naming'}</code></dd></div>
          <div className="sm:col-span-2"><dt className="muted">USER.md</dt><dd className="mt-2 whitespace-pre-wrap rounded-md border border-frost bg-ivory p-3 text-sm">{team.userMd || 'No operator context configured.'}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-mocha">Edit USER.md and Telegram naming from Overview during this transition. This route is the canonical context projection.</p>
      </section>
    </PageShell>
  )
}

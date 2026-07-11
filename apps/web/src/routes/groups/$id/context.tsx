import type { Group } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { GroupTabs } from '../../../components/GroupTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchContext = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<Group>(`/api/groups/${encodeURIComponent(data.id)}`),
  )

export const Route = createFileRoute('/groups/$id/context')({
  loader: ({ params }) => fetchContext({ data: params }),
  component: ContextPage,
})

function ContextPage() {
  const group = Route.useLoaderData()
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1>group context</h1>
      <p className="muted">Workspace, operator context, and integrations owned by this Group.</p>
      <GroupTabs groupId={group.id} />
      <section className="card">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="muted">workspace path</dt><dd><code>{group.path}</code></dd></div>
          <div><dt className="muted">Telegram topic format</dt><dd><code>{group.telegramTopicNameFormat ?? 'built-in naming'}</code></dd></div>
          <div className="sm:col-span-2"><dt className="muted">USER.md</dt><dd className="mt-2 whitespace-pre-wrap rounded-md border border-frost bg-ivory p-3 text-sm">{group.userMd || 'No operator context configured.'}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-mocha">Edit USER.md and Telegram naming from Overview during this transition. This route is the canonical context projection.</p>
      </section>
    </div>
  )
}

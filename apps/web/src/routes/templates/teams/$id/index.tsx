import type { Profile, TeamTemplate } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../../components/Button'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { PageShell } from '../../../../components/Page'
import { SectionTabs, TEMPLATE_TABS } from '../../../../components/SectionTabs'
import { TeamPolicyEditor } from '../../../../components/team-policy/TeamPolicyEditor'
import { api } from '../../../../lib/api'
import { daemonClient } from '../../../../lib/daemon-client'

const fetchTemplate = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [template, profiles] = await Promise.all([
      client.get<TeamTemplate>(`/api/team-templates/${encodeURIComponent(data.id)}`),
      client.get<Profile[]>('/api/profiles'),
    ])
    return { template, profiles }
  })

export const Route = createFileRoute('/templates/teams/$id/')({
  loader: ({ params }) => fetchTemplate({ data: { id: params.id } }),
  component: TeamTemplatePage,
})

function TeamTemplatePage() {
  const { template, profiles } = Route.useLoaderData()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <PageShell size="wide">
      <SectionTabs label="Template kinds" base="/templates" tabs={TEMPLATE_TABS} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href="/templates/teams">← Team templates</a>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete template
        </Button>
      </div>
      <TeamPolicyEditor source={{ kind: 'template', template }} profiles={profiles} />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete Team template ${template.name}?`}
        description={<p>Teams already spawned from it keep their Agents and edges.</p>}
        confirmLabel="Delete template"
        onConfirm={async () => {
          await api(`/api/team-templates/${encodeURIComponent(template.id)}`, {
            method: 'DELETE',
          })
          window.location.assign('/templates/teams')
        }}
        onOpenChange={setConfirmDelete}
      />
    </PageShell>
  )
}

import type { Profile, Team, TeamTemplate } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../../components/Button'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { ManagePage } from '../../../../components/ManagePage'
import { SpawnTeamModal } from '../../../../components/SpawnTeamModal'
import { TeamPolicyEditor } from '../../../../components/team-policy/TeamPolicyEditor'
import { RowMenu } from '../../../../components/ui/parts'
import { api } from '../../../../lib/api'
import { daemonClient } from '../../../../lib/daemon-client'
import { count } from '../../../../lib/manage'

const fetchTemplate = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    let template: TeamTemplate
    try {
      template = await client.get<TeamTemplate>(
        `/api/team-templates/${encodeURIComponent(data.id)}`,
      )
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
    const [profiles, teams] = await Promise.all([
      client.get<Profile[]>('/api/profiles'),
      client.get<Team[]>('/api/teams'),
    ])
    return { template, profiles, teams }
  })

export const Route = createFileRoute('/templates/teams/$id/')({
  loader: async ({ params }) => {
    const data = await fetchTemplate({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/templates/teams' })
    return data
  },
  component: TeamTemplatePage,
})

function TeamTemplatePage() {
  const { template, profiles, teams } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [spawning, setSpawning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Using it takes the saved roster: with changes on screen it would not be the one in view.
  const [unsaved, setUnsaved] = useState(false)

  return (
    <ManagePage
      title={template.name}
      description={`A roster of ${count(template.slots.length, 'Agent')} and ${count(template.edges.length, 'connection')}. Using it adds them to a new Team or one that exists; Teams made from it earlier keep their own.`}
      actions={
        <>
          <Button
            variant="primary"
            disabled={template.slots.length === 0 || unsaved}
            aria-describedby={unsaved ? 'spawn-needs-save' : undefined}
            onClick={() => setSpawning(true)}
          >
            Use this template
          </Button>
          <RowMenu
            label={`More for ${template.name}`}
            items={[
              {
                label: 'Delete template…',
                danger: true,
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        </>
      }
    >
      {unsaved && (
        <p id="spawn-needs-save" className="m-0 text-sm font-medium text-warning">
          Save the roster to spawn it as it is on screen.
        </p>
      )}
      <TeamPolicyEditor
        template={template}
        profiles={profiles}
        onSaved={() => router.invalidate({ sync: true })}
        onDirtyChange={setUnsaved}
      />
      {spawning && (
        <SpawnTeamModal
          template={template}
          teams={teams}
          onClose={() => setSpawning(false)}
          onSpawned={(slug) => {
            setSpawning(false)
            void navigate({ to: '/', search: { team: slug, panel: 'team' } })
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the ${template.name} Team template?`}
        description={
          <p className="m-0">Teams already spawned from it keep their Agents and connections.</p>
        }
        confirmLabel="Delete template"
        onConfirm={async () => {
          await api(`/api/team-templates/${encodeURIComponent(template.id)}`, {
            method: 'DELETE',
          })
          await navigate({ to: '/templates/teams' })
        }}
      />
    </ManagePage>
  )
}

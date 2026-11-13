import type { Profile, TeamPolicy, TeamTemplate } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Save } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { SectionCard } from '../../../components/Page'
import { TeamPolicyEditor } from '../../../components/team-policy/TeamPolicyEditor'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const fetchPolicy = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [policy, profiles] = await Promise.all([
      client.get<TeamPolicy>(`/api/teams/${encodeURIComponent(data.id)}/policy`),
      client.get<Profile[]>('/api/profiles'),
    ])
    return { policy, profiles }
  })

export const Route = createFileRoute('/teams/$id/policy')({
  loader: ({ params }) => fetchPolicy({ data: { id: params.id } }),
  component: TeamPolicyPage,
})

function TeamPolicyPage() {
  const { policy, profiles } = Route.useLoaderData()
  const { id } = Route.useParams()
  return (
    <div className="space-y-6">
      <p className="muted">
        Who may message whom in this Team. You can always talk to every Agent, and every Agent can
        always reach you.
      </p>
      <TeamPolicyEditor source={{ kind: 'live', policy }} profiles={profiles} />
      <SaveAsTemplate teamId={id} />
    </div>
  )
}

function SaveAsTemplate({ teamId }: { teamId: string }) {
  const [templateId, setTemplateId] = useState(`${teamId}-template`)
  const [name, setName] = useState(`${teamId} template`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const template = await api<TeamTemplate>(
        `/api/teams/${encodeURIComponent(teamId)}/policy/save-as-template`,
        { body: { id: templateId.trim(), name: name.trim() } },
      )
      window.location.assign(`/templates/teams/${encodeURIComponent(template.id)}`)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Save as Team template"
      description="Copies the members, allow edges, mode and USER.md into a new reusable template."
    >
      <div className="grid items-end gap-x-3 sm:grid-cols-[1fr_1fr_auto]">
        <label>
          Template ID
          <input value={templateId} onChange={(event) => setTemplateId(event.target.value)} />
        </label>
        <label>
          Template name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <Button
          variant="primary"
          className="mb-[0.6rem]"
          disabled={busy || !templateId.trim() || !name.trim()}
          onClick={() => void save()}
        >
          <Save className="h-4 w-4" />
          Save template
        </Button>
      </div>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
    </SectionCard>
  )
}

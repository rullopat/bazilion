import type { TeamTemplateWithCount } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { TemplatesTabs } from '../../../components/TemplatesTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchTeams = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<TeamTemplateWithCount[]>('/api/team-templates'),
)

export const Route = createFileRoute('/templates/teams/')({
  loader: () => fetchTeams(),
  component: TeamTemplatesPage,
})

function TeamTemplatesPage() {
  const teams = Route.useLoaderData()
  const router = useRouter()
  return (
    <div>
      <TemplatesTabs />
      <h1>team templates</h1>
      <p className="muted">
        The sole reusable Team roster. Every slot has stable identity and every saved definition
        has an immutable revision.
      </p>
      <CreateTeamForm onCreated={() => router.invalidate()} />
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>id</th><th>name</th><th>slots</th><th>revision</th><th>source state</th></tr></thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td><a href={`/templates/teams/${encodeURIComponent(team.id)}`}><code>{team.id}</code></a></td>
                <td>{team.name}</td><td>{team.slotCount}</td><td>{team.currentRevision}</td>
                <td>{team.deletedAt ? 'deleted source' : 'canonical'}</td>
              </tr>
            ))}
            {teams.length === 0 && <tr><td colSpan={5} className="muted">No team templates yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CreateTeamForm({ onCreated }: { onCreated: () => void }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const response = await fetch('/api/team-templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id.trim(), name: name.trim() }) })
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? response.statusText)
      setId(''); setName(''); await onCreated()
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  return <form className="card" onSubmit={submit}><h2 className="text-xl">new team template</h2>{error && <p className="err">{error}</p>}<div className="grid gap-3 sm:grid-cols-2"><label>id<input required value={id} onChange={(event) => setId(event.target.value)} placeholder="review-team" /></label><label>name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Review team" /></label></div><Button variant="primary" type="submit" disabled={busy}>{busy ? 'creating…' : 'create team template'}</Button></form>
}

import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
  Team,
  TeamTemplateWithCount,
  ResolvedTeamPolicy,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { TeamTabs } from '../../../components/TeamTabs'
import { daemonClient } from '../../../lib/daemon-client'

interface TeamDetail {
  team: Team
  members: Agent[]
  profileGroups: TeamTemplateWithCount[]
}

const fetchGroup = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<TeamDetail | null> => {
    const c = daemonClient()
    let team: Team
    try {
      team = await c.get<Team>(`/api/teams/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [all, profileGroups] = await Promise.all([
      c.get<Agent[]>('/api/agents?includeArchived=true'),
      c.get<TeamTemplateWithCount[]>('/api/team-templates'),
    ])
    const members = all.filter((a) => a.teamId === team.id)
    return { team, members, profileGroups }
  })

export const Route = createFileRoute('/teams/$id/')({
  loader: async ({ params }) => {
    const data = await fetchGroup({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/teams' })
    return data
  },
  component: TeamDetailPage,
})

function TeamDetailPage() {
  const { team, members, profileGroups } = Route.useLoaderData()
  const router = useRouter()
  const [userMd, setUserMd] = useState(team.userMd)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(team.id)}/user-md`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userMd }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      setSavedAt(Date.now())
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground">
        {team.name} <span className="text-muted-foreground text-base">({team.id})</span>
      </h1>
      <p className="text-muted-foreground text-sm mb-6 mt-1">
        <code className="font-mono">{team.path}</code> · {members.length}{' '}
        member{members.length === 1 ? '' : 's'} ·{' '}
        <a
          href={`/teams/${encodeURIComponent(team.id)}/memory`}
          className="text-primary underline"
        >
          shared memory →
        </a>
      </p>

      <TeamTabs teamId={team.id} />

      <section className="rounded-lg border bg-card p-5 mb-6">
        <h3 className="font-serif text-xl mb-1">USER.md</h3>
        <p className="text-muted-foreground text-sm mb-3">
          Read-only context about the human, injected into every member agent's system prompt.
          12 KB cap. Agents cannot edit this file — only you can.
        </p>
        <textarea
          value={userMd}
          onChange={(e) => setUserMd(e.target.value)}
          rows={16}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="What the agent should know about you in this team context…"
        />
        <div className="flex items-center gap-3 mt-3">
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || userMd === team.userMd}
          >
            {busy ? 'saving…' : 'save'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {userMd.length} / 12000 chars
          </span>
          {savedAt && <span className="text-xs text-emerald-700">✓ saved</span>}
          {err && <span className="text-xs text-rose-700">{err}</span>}
        </div>
      </section>

      <TopicNameFormatCard
        team={team}
        sampleAgent={members[0]?.name ?? 'researcher'}
        onSaved={() => router.invalidate()}
      />

      {members.length === 0 && (
        <SpawnFromTemplateCard
          teamId={team.id}
          profileGroups={profileGroups}
          onSpawned={() => router.invalidate()}
        />
      )}

      <section className="rounded-lg border bg-card p-5">
        <h3 className="font-serif text-xl mb-3">members</h3>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No agents in this team yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2">name</th>
                <th>status</th>
                <th>profile</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2">
                    <a href={`/agents/${m.id}`} className="text-primary underline">
                      {m.name}
                    </a>
                  </td>
                  <td>{m.status}</td>
                  <td>
                    <code className="font-mono text-xs">{m.profileId}</code>
                  </td>
                  <td>
                    <code className="font-mono text-xs text-muted-foreground">
                      {m.id.slice(0, 8)}…
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

function TopicNameFormatCard({
  team,
  sampleAgent,
  onSaved,
}: {
  team: Team
  sampleAgent: string
  onSaved: () => void
}) {
  const [format, setFormat] = useState(team.telegramTopicNameFormat ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const trimmed = format.trim()
  const preview = trimmed
    ? trimmed
        .replaceAll('{agent.name}', sampleAgent)
        .replaceAll('{team.name}', team.name)
        .replaceAll('{team.slug}', team.id)
    : team.id === 'default'
      ? sampleAgent
      : `${team.id} › ${sampleAgent}`

  const dirty = (team.telegramTopicNameFormat ?? '') !== format

  async function save(clear: boolean) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(team.id)}/topic-format`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: clear ? null : format }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      if (clear) setFormat('')
      setSavedAt(Date.now())
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 mb-6">
      <h3 className="font-serif text-xl mb-1">Telegram topic names</h3>
      <p className="text-muted-foreground text-sm mb-3">
        Template for this team's Telegram forum-topic titles. Leave empty for built-in naming.
        Tokens: <code className="font-mono">{'{agent.name}'}</code>{' '}
        <code className="font-mono">{'{team.name}'}</code>{' '}
        <code className="font-mono">{'{team.slug}'}</code> — must include{' '}
        <code className="font-mono">{'{agent.name}'}</code>. Saving renames existing topics that you
        haven't manually renamed in Telegram.
      </p>
      <input
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        placeholder="{team.name} / {agent.name}"
        className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
      />
      <p className="text-xs text-muted-foreground mt-2">
        preview: <span className="font-mono text-foreground">{preview}</span>
      </p>
      <div className="flex items-center gap-3 mt-3">
        <Button
          variant="primary"
          onClick={() => save(false)}
          disabled={busy || !dirty || trimmed.length === 0}
        >
          {busy ? 'saving…' : 'save'}
        </Button>
        {team.telegramTopicNameFormat && (
          <Button variant="ghost" onClick={() => save(true)} disabled={busy}>
            clear
          </Button>
        )}
        {savedAt && <span className="text-xs text-emerald-700">✓ saved</span>}
        {err && <span className="text-xs text-rose-700">{err}</span>}
      </div>
    </section>
  )
}

function SpawnFromTemplateCard({
  teamId,
  profileGroups,
  onSpawned,
}: {
  teamId: string
  profileGroups: TeamTemplateWithCount[]
  onSpawned: () => void
}) {
  const eligible = profileGroups.filter((g) => g.slotCount > 0 && !g.deletedAt)
  const [selected, setSelected] = useState<string>(eligible[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function spawn() {
    if (!selected) return
    setBusy(true)
    setErr(null)
    try {
      const template = eligible.find((item) => item.id === selected)
      if (!template) throw new Error('Team template is unavailable.')
      const policyResponse = await fetch(`/api/teams/${encodeURIComponent(teamId)}/policy`)
      if (!policyResponse.ok) throw new Error('The current Team policy is unavailable.')
      const current = (await policyResponse.json()) as ResolvedTeamPolicy
      const res = await fetch(`/api/team-templates/${encodeURIComponent(selected)}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          templateExpectedRevision: template.currentRevision,
          teamId,
          teamExpectedRevision: current.teamPolicy.revision,
          mode: 'initialize',
        }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      onSpawned()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 mb-6">
      <h3 className="font-serif text-xl mb-1">spawn a team into this team</h3>
      <p className="text-muted-foreground text-sm mb-3">
        This Team is empty. Pick a canonical Team template to initialize its roster and policy at
        the current reviewed Team and Team revisions.
      </p>
      {eligible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No Team templates with slots yet. Build one on{' '}
          <a href="/templates/teams" className="text-primary underline">
            Team templates
          </a>{' '}
          first.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          >
            {eligible.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.slotCount} slot{g.slotCount === 1 ? '' : 's'}, r{g.currentRevision})
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={spawn} disabled={busy || !selected}>
            {busy ? 'spawning…' : 'spawn team'}
          </Button>
          {err && <span className="text-xs text-rose-700">{err}</span>}
        </div>
      )}
    </section>
  )
}

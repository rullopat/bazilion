import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
  Team,
  TeamTemplateWithCount,
  ResolvedTeamPolicy,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { PageShell, SectionCard, StatusBadge } from '../../../components/Page'
import { TeamTabs } from '../../../components/TeamTabs'
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard'
import { daemonClient } from '../../../lib/daemon-client'

interface TeamDetail {
  team: Team
  members: Agent[]
  profileGroups: TeamTemplateWithCount[]
}

const fetchGroup = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
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
  const [topicDirty, setTopicDirty] = useState(false)
  const contextDirty = userMd !== team.userMd || topicDirty

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
    <PageShell>
      <UnsavedChangesGuard when={contextDirty} subject="Team context" />
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
        <label htmlFor="team-user-context" className="sr-only">
          USER.md Team context
        </label>
        <textarea
          id="team-user-context"
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
          {savedAt && <span role="status" className="text-xs text-success">Saved</span>}
          {err && <span role="alert" className="text-xs text-danger">{err}</span>}
        </div>
      </section>

      <TopicNameFormatCard
        team={team}
        sampleAgent={members[0]?.name ?? 'researcher'}
        onSaved={() => router.invalidate()}
        onDirtyChange={setTopicDirty}
      />

      {members.length === 0 && (
        <SpawnFromTemplateCard
          teamId={team.id}
          profileGroups={profileGroups}
          onSpawned={() => router.invalidate()}
        />
      )}

      <SectionCard
        title="Roster"
        description="Live Team membership has one canonical management view."
        actions={<StatusBadge variant={members.length > 0 ? 'success' : 'neutral'}>{members.length} member{members.length === 1 ? '' : 's'}</StatusBadge>}
      >
        <a href={`/teams/${encodeURIComponent(team.id)}/members`} className="ghost-btn">
          Manage Team members
        </a>
      </SectionCard>
    </PageShell>
  )
}

function TopicNameFormatCard({
  team,
  sampleAgent,
  onSaved,
  onDirtyChange,
}: {
  team: Team
  sampleAgent: string
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
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

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

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
      <label htmlFor="team-telegram-topic-format" className="sr-only">
        Telegram topic name format
      </label>
      <input
        id="team-telegram-topic-format"
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
        {savedAt && <span role="status" className="text-xs text-success">Saved</span>}
        {err && <span role="alert" className="text-xs text-danger">{err}</span>}
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
        <div className="flex flex-wrap items-end gap-3">
          <label className="m-0 flex min-w-0 flex-1 flex-col gap-1 text-sm text-foreground">
            Team template
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            >
              {eligible.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.slotCount} slot{g.slotCount === 1 ? '' : 's'}, r{g.currentRevision})
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={spawn} disabled={busy || !selected}>
            {busy ? 'spawning…' : 'spawn team'}
          </Button>
          {err && <span role="alert" className="basis-full text-xs text-danger">{err}</span>}
        </div>
      )}
    </section>
  )
}

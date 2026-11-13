import type { Agent, Team, TeamTemplate } from '@bazilion/api-types'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { CodingDefaultsCard } from '../../../components/CodingDefaultsCard'
import { SectionCard, StatusBadge } from '../../../components/Page'
import { SpawnTeamModal } from '../../../components/SpawnTeamModal'
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const teamRoute = getRouteApi('/teams/$id')

const fetchContext = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [agents, templates] = await Promise.all([
      client.get<Agent[]>('/api/agents?includeArchived=true'),
      client.get<TeamTemplate[]>('/api/team-templates'),
    ])
    return { members: agents.filter((agent) => agent.teamId === data.id), templates }
  })

export const Route = createFileRoute('/teams/$id/')({
  loader: ({ params }) => fetchContext({ data: { id: params.id } }),
  component: TeamContextPage,
})

function TeamContextPage() {
  const team = teamRoute.useLoaderData()
  const { members, templates } = Route.useLoaderData()
  const router = useRouter()
  const [userMdDirty, setUserMdDirty] = useState(false)
  const [topicDirty, setTopicDirty] = useState(false)

  return (
    <div className="space-y-6">
      <UnsavedChangesGuard when={userMdDirty || topicDirty} subject="Team context" />
      <UserMdCard team={team} onDirtyChange={setUserMdDirty} onSaved={() => router.invalidate()} />
      <SectionCard>
        <CodingDefaultsCard teamId={team.id} />
      </SectionCard>
      <TopicNameFormatCard
        team={team}
        sampleAgent={members[0]?.name ?? 'researcher'}
        onSaved={() => router.invalidate()}
        onDirtyChange={setTopicDirty}
      />
      {members.length === 0 && (
        <SpawnFromTemplateCard
          team={team}
          templates={templates}
          onSpawned={() => router.invalidate()}
        />
      )}
      <SectionCard
        title="Members"
        actions={
          <StatusBadge variant={members.length > 0 ? 'success' : 'neutral'}>
            {members.length} member{members.length === 1 ? '' : 's'}
          </StatusBadge>
        }
      >
        <a href={`/teams/${encodeURIComponent(team.id)}/members`} className="ghost-btn">
          Show Team members
        </a>
      </SectionCard>
    </div>
  )
}

function UserMdCard({
  team,
  onDirtyChange,
  onSaved,
}: {
  team: Team
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [userMd, setUserMd] = useState(team.userMd)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = userMd !== team.userMd

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/teams/${encodeURIComponent(team.id)}/user-md`, {
        method: 'PUT',
        body: { userMd },
      })
      setSaved(true)
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="USER.md"
      description="Context about you, added to every member's system prompt (12 KB at most). Only you can edit it; Agents cannot."
    >
      <textarea
        aria-label="USER.md Team context"
        value={userMd}
        onChange={(event) => setUserMd(event.target.value)}
        rows={16}
        className="font-mono text-sm"
        placeholder="What the agents should know about you in this Team…"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <span className="text-xs text-muted-foreground">{userMd.length} / 12000 chars</span>
        {saved && !dirty && (
          <span role="status" className="text-xs text-success">
            Saved
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </SectionCard>
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
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const trimmed = format.trim()
  const dirty = (team.telegramTopicNameFormat ?? '') !== format
  const preview = trimmed
    ? trimmed
        .replaceAll('{agent.name}', sampleAgent)
        .replaceAll('{team.name}', team.name)
        .replaceAll('{team.slug}', team.id)
    : team.id === 'default'
      ? sampleAgent
      : `${team.id} › ${sampleAgent}`

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  async function save(clear: boolean) {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/teams/${encodeURIComponent(team.id)}/topic-format`, {
        method: 'PUT',
        body: { format: clear ? null : format },
      })
      if (clear) setFormat('')
      setSaved(true)
      onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Telegram topic names"
      description={
        <>
          The title of each member's Telegram forum topic; leave empty for the built-in naming.
          Tokens: <code>{'{agent.name}'}</code> (required), <code>{'{team.name}'}</code>,{' '}
          <code>{'{team.slug}'}</code>. Saving renames the existing topics you have not renamed in
          Telegram.
        </>
      }
    >
      <input
        aria-label="Telegram topic name format"
        value={format}
        onChange={(event) => setFormat(event.target.value)}
        placeholder="{team.name} / {agent.name}"
        className="font-mono text-sm"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        preview: <span className="font-mono text-foreground">{preview}</span>
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void save(false)}
          disabled={busy || !dirty || trimmed.length === 0}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {team.telegramTopicNameFormat && (
          <Button variant="ghost" onClick={() => void save(true)} disabled={busy}>
            Clear
          </Button>
        )}
        {saved && !dirty && (
          <span role="status" className="text-xs text-success">
            Saved
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </SectionCard>
  )
}

/** An empty Team offers its Team templates; the spawn itself is the shared spawn dialog. */
function SpawnFromTemplateCard({
  team,
  templates,
  onSpawned,
}: {
  team: Team
  templates: TeamTemplate[]
  onSpawned: () => void
}) {
  const eligible = templates.filter((template) => template.slots.length > 0)
  const [selected, setSelected] = useState(eligible[0]?.id ?? '')
  const [dialogOpen, setDialogOpen] = useState(false)
  const template = eligible.find((item) => item.id === selected)

  return (
    <SectionCard
      title="Spawn from a Team template"
      description="This Team has no members. A Team template spawns its Agents and allow edges here."
    >
      {eligible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Team template has members yet. Build one under{' '}
          <a href="/templates/teams">Team templates</a> first.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="m-0 min-w-0 flex-1">
            Team template
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {eligible.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.slots.length} slot
                  {template.slots.length === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={() => setDialogOpen(true)} disabled={!template}>
            Spawn team…
          </Button>
        </div>
      )}
      {dialogOpen && template && (
        <SpawnTeamModal
          template={template}
          teams={[team]}
          initialTeamId={team.id}
          onClose={() => setDialogOpen(false)}
          onSpawned={() => {
            setDialogOpen(false)
            onSpawned()
          }}
        />
      )}
    </SectionCard>
  )
}

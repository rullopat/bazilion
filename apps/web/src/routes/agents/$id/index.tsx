import { ApiClientError } from '@bazilion/client'
import type {
  Team,
  ProviderMessage,
  ReasoningLevel,
  ResolvedAgent,
  ResolvedTeamPolicy,
  SessionHeadResponse,
  SkillInfo,
  SkillScanFinding,
  TelegramBindResponse,
  TelegramConfigState,
  TelegramMirrorMode,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AgentAvatar } from '../../../components/AgentAvatar'
import { AgentTabs } from '../../../components/AgentTabs'
import { Button } from '../../../components/Button'
import { ChatPane } from '../../../components/ChatPane'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { CopyButton } from '../../../components/CopyButton'
import { PageShell, SectionCard } from '../../../components/Page'
import { daemonClient } from '../../../lib/daemon-client'
import { REASONING_LEVELS } from '../../../lib/wire-constants'

interface ModelGroup {
  provider: string
  models: string[]
}

interface AvailableModelsResponse {
  teams: ModelGroup[]
}

interface AgentView {
  resolved: ResolvedAgent
  initialMessages: ProviderMessage[]
  sessionHead: SessionHeadResponse
  teams: Team[]
  skills: SkillInfo[]
  modelGroups: ModelGroup[]
  telegramConfigured: boolean
}

const fetchAgent = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<AgentView | null> => {
    const c = daemonClient()
    let resolved: ResolvedAgent
    try {
      resolved = await c.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [msgs, head, teams, skills, models, telegramConfig] = await Promise.all([
      c.get<{ messages: ProviderMessage[] }>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/messages`,
      ),
      c.get<SessionHeadResponse>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/head`,
      ),
      c.get<Team[]>('/api/teams'),
      c.get<SkillInfo[]>('/api/skills'),
      c.get<AvailableModelsResponse>('/api/config/available-models'),
      c
        .get<TelegramConfigState>('/api/config/telegram')
        .catch(() => ({ configured: false }) as TelegramConfigState),
    ])
    return {
      resolved,
      initialMessages: msgs.messages,
      sessionHead: head,
      teams,
      skills,
      modelGroups: models.teams,
      telegramConfigured: telegramConfig.configured,
    }
  })

export const Route = createFileRoute('/agents/$id/')({
  validateSearch: (search: Record<string, unknown>): { mode?: 'settings'; teamPolicy?: string; view?: 'flow'|'matrix'; selected?: string; vx?: number; vy?: number; vz?: number } => ({
    ...(search.mode === 'settings' ? { mode: 'settings' as const } : {}),
    ...(typeof search.teamPolicy === 'string' && search.teamPolicy
      ? { teamPolicy: search.teamPolicy }
      : {}),
    ...(search.view === 'matrix' || search.view === 'flow' ? { view: search.view } : {}),
    ...(typeof search.selected === 'string' ? { selected: search.selected } : {}),
    ...(Number.isFinite(Number(search.vx)) ? { vx: Number(search.vx) } : {}),
    ...(Number.isFinite(Number(search.vy)) ? { vy: Number(search.vy) } : {}),
    ...(Number.isFinite(Number(search.vz)) ? { vz: Number(search.vz) } : {}),
  }),
  loader: async ({ params }) => {
    const data = await fetchAgent({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/agents' })
    return data
  },
  component: AgentDetailPage,
})

function AgentDetailPage() {
  const {
    resolved,
    initialMessages,
    sessionHead,
    teams,
    skills,
    modelGroups,
    telegramConfigured,
  } = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const [confirmAction, setConfirmAction] = useState<'archive' | 'delete' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const settingsMode = search.mode === 'settings'

  async function archive() {
    const response = await fetch(`/api/agents/${encodeURIComponent(resolved.agent.id)}/archive`, {
      method: 'POST',
    })
    if (!response.ok && response.status !== 204) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not archive Agent (${response.status})`)
    }
    await router.invalidate()
  }
  async function unarchive() {
    setActionError(null)
    try {
      const response = await fetch(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/unarchive`,
        { method: 'POST' },
      )
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not restore Agent (${response.status})`)
      }
      await router.invalidate()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }
  async function del() {
    const policyResponse = await fetch(`/api/teams/${encodeURIComponent(resolved.team.id)}/policy`)
    if (!policyResponse.ok) {
      throw new Error('The current Team policy is unavailable. Nothing was deleted.')
    }
    const current = (await policyResponse.json()) as ResolvedTeamPolicy
    const res = await fetch(`/api/agents/${resolved.agent.id}?expectedTeamRevision=${current.teamPolicy.revision}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      window.location.assign('/agents')
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not delete Agent (${res.status})`)
    }
  }

  return (
    <PageShell>
      <header className="mb-8">
        {search.teamPolicy && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <a href={`/teams/${encodeURIComponent(search.teamPolicy)}/policy?view=${search.view ?? 'flow'}&selected=${encodeURIComponent(search.selected ?? '')}&vx=${search.vx ?? 0}&vy=${search.vy ?? 0}&vz=${search.vz ?? 0.9}`} className="ghost-btn"><ArrowLeft className="h-4 w-4" /> back to Team policy</a>
            <span className="text-xs text-mocha-light">Returns to the same projection, viewport, and selection.</span>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar identity={resolved.agent.identity} size={44} />
          <div className="min-w-0">
            <h1 className="mb-0 break-words">{resolved.agent.name}</h1>
            {(resolved.agent.identity?.creature || resolved.agent.identity?.vibe) && (
              <p className="muted mt-0.5 text-sm">
                {[resolved.agent.identity?.creature, resolved.agent.identity?.vibe]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Tag>
            <span className="min-w-0 break-all px-1.5 font-mono text-[0.95em] text-mocha select-all">
              {resolved.agent.id}
            </span>
            <CopyButton
              value={resolved.agent.id}
              ariaLabel="Copy agent UUID"
              title="Copy UUID to clipboard"
            />
          </Tag>
          <Tag>
            status: <span className="ml-1">{resolved.agent.status}</span>
          </Tag>
          <Tag>
            profile:{' '}
            <code className="ml-1 min-w-0 break-all bg-transparent px-0">
              {resolved.profile.id}
            </code>
          </Tag>
          <Tag>
            team:{' '}
            <a
              href={`/teams/${encodeURIComponent(resolved.team.id)}`}
              className="ml-1 min-w-0 break-all bg-transparent px-0 font-mono underline"
            >
              {resolved.team.id}
            </a>{' '}
            ·{' '}
            <a
              href={`/teams/${encodeURIComponent(resolved.team.id)}/memory`}
              className="ml-0.5 underline"
            >
              shared memory →
            </a>
          </Tag>
          <Tag>
            model:{' '}
            <code className="ml-1 min-w-0 break-all bg-transparent px-0">{resolved.model}</code>
          </Tag>
          <Tag>
            reasoning:{' '}
            <code className="ml-1 bg-transparent px-0">{resolved.reasoningLevel}</code>
          </Tag>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {resolved.agent.status === 'archived' ? (
            <Button variant="ghost" onClick={() => void unarchive()}>Restore</Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmAction('archive')}>Archive</Button>
          )}
          <Button variant="danger" onClick={() => setConfirmAction('delete')}>
            Delete permanently
          </Button>
        </div>
      </header>

      {actionError && <p role="alert" className="err">{actionError}</p>}

      {resolved.agent.status === 'archived' && (
        <div className="mb-4 rounded-md border border-frost bg-fawn/35 px-4 py-2 text-[0.9em] text-chocolate">
          <strong className="text-warning">This agent is archived.</strong> It's hidden from
          the default agent list; use <em>unarchive</em> above to bring it back, or{' '}
          <em>delete permanently</em> to remove its data entirely.
        </div>
      )}

      <AgentTabs
        agentId={resolved.agent.id}
        active={settingsMode ? 'settings' : 'chat'}
        archived={resolved.agent.status === 'archived'}
      />

      {!settingsMode ? (
        <>
      <SectionTitle>Chat</SectionTitle>
      <div className="h-[70vh]">
        <ChatPane
          agentId={resolved.agent.id}
          agentName={resolved.agent.name}
          initialMessages={initialMessages}
          initialSessionHead={sessionHead}
        />
      </div>
      <p className="mt-2 text-[0.82em] text-mocha-light">
        chat history persists in bazilion across navigation and restarts.
      </p>

        </>
      ) : (
        <div className="space-y-6">
          <SettingsDetails
            agentId={resolved.agent.id}
            currentModelOverride={resolved.agent.modelOverride ?? null}
            profileDefaultModel={resolved.profile.defaultModel}
            currentReasoning={resolved.reasoningLevel}
            modelGroups={modelGroups}
          />

      <SectionCard title="Team" description="Move this permanent Agent between Team workspaces with an exact policy preview.">
        <SectionTitle>Team</SectionTitle>
        <p className="text-[0.9em] text-mocha-light">
          Current team: <code>{resolved.team.id}</code> ({resolved.team.name}) —{' '}
          <code>{resolved.team.path}</code>.{' '}
          <a href={`/teams/${resolved.team.id}`}>view / edit USER.md</a>
        </p>
        <MoveGroupForm
          agentId={resolved.agent.id}
          currentTeamId={resolved.team.id}
          teams={teams}
        />
      </SectionCard>

      <SectionCard title="Skills" description="Attach or detach prompt skills for this Agent.">
        <SkillsTable
          agentId={resolved.agent.id}
          attached={new Set(resolved.skills)}
          all={skills}
        />
      </SectionCard>

      {telegramConfigured && (
        <SectionCard title="Telegram" description="Bind this Agent to its Telegram topic and control mirroring.">
          <TelegramSection agent={resolved.agent} />
        </SectionCard>
      )}
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        title={
          confirmAction === 'delete'
            ? `Delete ${resolved.agent.name} permanently?`
            : `Archive ${resolved.agent.name}?`
        }
        description={
          confirmAction === 'delete' ? (
            <p>
              This permanently removes messages, triggers, skill attachments, sessions, and the
              Agent's private on-disk directory. This cannot be undone.
            </p>
          ) : (
            <p>
              The Agent will stop receiving normal work and disappear from current lists. You
              can restore it later from “Show archived”.
            </p>
          )
        }
        confirmLabel={confirmAction === 'delete' ? 'Delete permanently' : 'Archive Agent'}
        confirmVariant={confirmAction === 'delete' ? 'danger' : 'primary'}
        onConfirm={async () => {
          setActionError(null)
          try {
            if (confirmAction === 'delete') await del()
            else await archive()
          } catch (error) {
            setActionError(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
      />
    </PageShell>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-body text-[0.85em] font-semibold uppercase tracking-wider text-mocha-light">
      {children}
    </h3>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1 break-all rounded-full border border-frost bg-ivory px-3 py-0.5 text-[0.84em] text-mocha-light">
      {children}
    </span>
  )
}

function SettingsDetails({
  agentId,
  currentModelOverride,
  profileDefaultModel,
  currentReasoning,
  modelGroups,
}: {
  agentId: string
  currentModelOverride: string | null
  profileDefaultModel: string
  currentReasoning: ReasoningLevel
  modelGroups: ModelGroup[]
}) {
  const router = useRouter()
  const [modelOverride, setModelOverride] = useState<string>(currentModelOverride ?? '')
  const [reasoning, setReasoning] = useState<ReasoningLevel>(currentReasoning)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentInGroups =
    currentModelOverride !== null &&
    modelGroups.some((g) =>
      g.models.some((m) => `${g.provider}:${m}` === currentModelOverride),
    )

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelOverride: modelOverride === '' ? null : modelOverride,
          reasoningLevel: reasoning,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
      await router.invalidate()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Model and reasoning"
      description="Override the Agent template defaults for this Agent only."
    >
      <form
        onSubmit={save}
        className="grid gap-4 sm:grid-cols-2"
      >
        <label className="m-0 flex min-w-0 flex-col gap-1 text-sm text-foreground">
          Model override
          <select
            name="modelOverride"
            value={modelOverride}
            onChange={(e) => setModelOverride(e.target.value)}
            className="min-w-0"
          >
            <option value="">inherit from profile ({profileDefaultModel})</option>
            {currentModelOverride !== null && !currentInGroups && (
              <option value={currentModelOverride}>
                {currentModelOverride} (not in curated list)
              </option>
            )}
            {modelGroups.map((g) => (
              <optgroup key={g.provider} label={g.provider}>
                {g.models.map((m) => {
                  const value = `${g.provider}:${m}`
                  return (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  )
                })}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="m-0 flex min-w-0 flex-col gap-1 text-sm text-foreground">
          Reasoning level
          <select
            name="reasoningLevel"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value as ReasoningLevel)}
            className="min-w-0"
          >
            {REASONING_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save model settings'}
          </Button>
          {savedFlash && <span role="status" className="text-sm text-success">Saved</span>}
          {error && <span role="alert" className="text-sm text-danger">{error}</span>}
        </div>
      </form>
    </SectionCard>
  )
}

function MoveGroupForm({
  agentId,
  currentTeamId,
  teams,
}: {
  agentId: string
  currentTeamId: string
  teams: Team[]
}) {
  const router = useRouter()
  const [teamId, setTeamId] = useState(currentTeamId)
  const [moving, setMoving] = useState(false)
  const [placement, setPlacement] = useState<'isolated' | 'profile_defaults'>('profile_defaults')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    source: { currentRevision: number; resultingRevision: number; removedEdges: unknown[] }
    destination: { currentRevision: number; resultingRevision: number; existingEdges: unknown[]; addedEdges: unknown[] }
    lineage: string
  } | null>(null)

  async function move(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (teamId === currentTeamId) return
    setMoving(true)
    setErr(null)
    try {
      const [sourceResponse, destinationResponse] = await Promise.all([
        fetch(`/api/teams/${encodeURIComponent(currentTeamId)}/policy`),
        fetch(`/api/teams/${encodeURIComponent(teamId)}/policy`),
      ])
      if (!sourceResponse.ok || !destinationResponse.ok) throw new Error('A Team policy is unavailable. Nothing was moved.')
      const source = (await sourceResponse.json()) as ResolvedTeamPolicy
      const destination = (await destinationResponse.json()) as ResolvedTeamPolicy
      const request = {
        teamId,
        sourceExpectedRevision: source.teamPolicy.revision,
        destinationExpectedRevision: destination.teamPolicy.revision,
        placement,
      }
      if (!preview) {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/team/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? response.statusText)
        }
        setPreview(await response.json())
        return
      }
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/team`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...request,
          sourceExpectedRevision: preview.source.currentRevision,
          destinationExpectedRevision: preview.destination.currentRevision,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      await router.invalidate()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setMoving(false)
    }
  }

  return (
    <form onSubmit={move} className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[0.85em] text-mocha-light">
        move to:
        <select
          value={teamId}
          onChange={(e) => {setTeamId(e.target.value);setPreview(null)}}
          className="w-full min-w-0 rounded-sm border border-frost bg-snow px-2 py-1.5 sm:min-w-[18rem]"
        >
          {teams.map((g) => (
            <option key={g.id} value={g.id}>
              {g.id} — {g.path}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[0.85em] text-mocha-light">
        destination placement:
        <select value={placement} onChange={(e) => {setPlacement(e.target.value as typeof placement);setPreview(null)}} className="rounded-sm border border-frost bg-snow px-2 py-1.5">
          <option value="profile_defaults">Agent-template defaults</option>
          <option value="isolated">isolated</option>
        </select>
      </label>
      <Button variant="primary" type="submit" disabled={moving || teamId === currentTeamId}>
        {moving ? 'working…' : preview ? 'commit reviewed move' : 'review move'}
      </Button>
      {err && <span role="alert" className="basis-full text-[0.85em] text-danger">{err}</span>}
      {preview && <div className="basis-full rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"><p>Source revision {preview.source.currentRevision} → <strong>{preview.source.resultingRevision}</strong>, removing {preview.source.removedEdges.length} incident edges. Destination revision {preview.destination.currentRevision} → <strong>{preview.destination.resultingRevision}</strong>, adding {preview.destination.addedEdges.length} edges to {preview.destination.existingEdges.length} existing edges.</p><p className="mt-1 muted">{preview.lineage}</p></div>}
    </form>
  )
}

function SkillsTable({
  agentId,
  attached,
  all,
}: {
  agentId: string
  attached: Set<string>
  all: SkillInfo[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [riskySkill, setRiskySkill] = useState<SkillInfo | null>(null)
  const [detachSkill, setDetachSkill] = useState<string | null>(null)

  async function attach(skill: SkillInfo, findingsConfirmed = false) {
    const findings = skill.scanFindings ?? []
    if (findings.length > 0 && !findingsConfirmed) {
      setRiskySkill(skill)
      return
    }
    setPending(skill.name)
    setErr(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill: skill.name, allowFindings: findings.length > 0 }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      await router.invalidate()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setPending(null)
    }
  }
  async function detach(name: string) {
    setPending(name)
    setErr(null)
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
      throw e
    } finally {
      setPending(null)
    }
  }

  if (all.length === 0) {
    return <p className="text-[0.9em] text-mocha-light">no skills installed</p>
  }
  return (
    <>
      {err && <p role="alert" className="mb-2 text-[0.85em] text-danger">{err}</p>}
      <table className="hidden md:table">
        <thead>
          <tr>
            <th>name</th>
            <th>description</th>
            <th>scan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {all.map((s) => {
            const isAttached = attached.has(s.name)
            const busy = pending === s.name
            return (
              <tr key={s.name}>
                <td>
                  <code>{s.name}</code>
                </td>
                <td>{s.description || <span className="text-mocha-light">—</span>}</td>
                <td>
                  <SkillFindingSummary findings={s.scanFindings ?? []} />
                </td>
                <td>
                  {isAttached ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDetachSkill(s.name)}
                    >
                      {busy ? '…' : 'detach'}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void attach(s).catch(() => {})}
                    >
                      {busy ? '…' : 'attach'}
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="grid gap-3 md:hidden">
        {all.map((skill) => {
          const isAttached = attached.has(skill.name)
          const busy = pending === skill.name
          return (
            <article key={skill.name} className="min-w-0 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <code className="min-w-0 break-all font-mono text-sm">{skill.name}</code>
                <span className={`shrink-0 text-xs font-semibold ${isAttached ? 'text-success' : 'text-muted-foreground'}`}>
                  {isAttached ? 'Attached' : 'Available'}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {skill.description || 'No description provided.'}
              </p>
              <div className="mt-2"><SkillFindingSummary findings={skill.scanFindings ?? []} /></div>
              <div className="mt-3">
                {isAttached ? (
                  <Button variant="ghost" disabled={busy} onClick={() => setDetachSkill(skill.name)}>
                    {busy ? 'Detaching…' : 'Detach'}
                  </Button>
                ) : (
                  <Button variant="ghost" disabled={busy} onClick={() => void attach(skill).catch(() => {})}>
                    {busy ? 'Attaching…' : 'Attach'}
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>
      <ConfirmDialog
        open={riskySkill !== null}
        onOpenChange={(open) => {
          if (!open) setRiskySkill(null)
        }}
        title={`Attach ${riskySkill?.name ?? 'skill'} despite scan findings?`}
        description={
          <div className="space-y-2">
            <p>
              Static scanning found {riskySkill?.scanFindings?.length ?? 0} potentially unsafe
              instruction{riskySkill?.scanFindings?.length === 1 ? '' : 's'}. Review the findings
              before allowing this skill into the Agent's prompt.
            </p>
            <SkillFindingSummary findings={riskySkill?.scanFindings ?? []} />
          </div>
        }
        confirmLabel="Attach despite findings"
        onConfirm={async () => {
          if (riskySkill) await attach(riskySkill, true)
        }}
      />
      <ConfirmDialog
        open={detachSkill !== null}
        onOpenChange={(open) => {
          if (!open) setDetachSkill(null)
        }}
        title={`Detach ${detachSkill ?? 'skill'}?`}
        description={
          <p>
            This removes the skill's instructions from this Agent's future turns. It does not
            uninstall the skill, and you can attach it again later.
          </p>
        }
        confirmLabel="Detach skill"
        onConfirm={async () => {
          if (detachSkill) await detach(detachSkill)
        }}
      />
    </>
  )
}

function SkillFindingSummary({ findings }: { findings: SkillScanFinding[] }) {
  if (findings.length === 0) return <span className="text-mocha-light">clean</span>
  const danger = findings.some((f) => f.severity === 'danger')
  return (
    <details className="text-[0.82em]">
      <summary className={danger ? 'cursor-pointer text-danger' : 'cursor-pointer text-mocha'}>
        {findings.length} finding{findings.length === 1 ? '' : 's'}
      </summary>
      <ul className="m-0 list-disc pl-4">
        {findings.map((f, i) => (
          <li key={`${f.code}-${f.line ?? 0}-${i}`}>
            <span className="font-mono">{f.severity}</span>: {f.code}
            {f.line ? ` line ${f.line}` : ''} - {f.message}
          </li>
        ))}
      </ul>
    </details>
  )
}

// ─── Telegram section ───────────────────────────────────────────────────

function TelegramSection({
  agent,
}: {
  agent: import('@bazilion/api-types').Agent
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMode, setMirrorMode] = useState<TelegramMirrorMode>(agent.telegramMirrorMode)
  const [iconEmoji, setIconEmoji] = useState(agent.telegramIconEmoji ?? '')
  const [confirmUnbind, setConfirmUnbind] = useState(false)

  const isBound = agent.telegramTopicId !== null

  async function bind() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agent.id)}/telegram/bind`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      const result = (await res.json()) as TelegramBindResponse
      // Open the deep-link in a new tab — works for Telegram desktop/Android.
      window.open(result.deepLink, '_blank', 'noopener')
      await router.invalidate()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unbind() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agent.id)}/telegram/binding`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not unbind Telegram topic (${res.status})`)
      }
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  async function saveMirrorMode(next: TelegramMirrorMode) {
    setMirrorMode(next)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telegramMirrorMode: next }),
      })
      if (!res.ok) throw new Error(res.statusText)
      await router.invalidate()
    } catch (e) {
      // Revert on failure.
      setMirrorMode(agent.telegramMirrorMode)
      setError((e as Error).message)
    }
  }

  async function saveIcon() {
    setError(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telegramIconEmoji: iconEmoji.trim() || null }),
      })
      if (!res.ok) throw new Error(res.statusText)
      await router.invalidate()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
    <div className="text-[0.9em]">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {isBound ? (
          <>
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
              bound
            </span>
            <span className="font-mono text-mocha">topic #{agent.telegramTopicId}</span>
            <button
              type="button"
              onClick={bind}
              disabled={busy}
              className="ghost-btn"
              title="Open the topic in Telegram (works on desktop/Android; iOS shows the topic list)"
            >
              open in Telegram
            </button>
            <Button variant="danger" onClick={() => setConfirmUnbind(true)} disabled={busy}>
              Unbind
            </Button>
          </>
        ) : (
          <>
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
              unbound
            </span>
            <button
              type="button"
              onClick={bind}
              disabled={busy}
              className="ghost-btn"
              title="Create a Telegram topic for this agent"
            >
              {busy ? 'binding…' : 'bind a topic'}
            </button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <label htmlFor="mirror-mode" className="m-0 text-mocha-light">
          Mirror mode
        </label>
        <select
          id="mirror-mode"
          value={mirrorMode}
          onChange={(e) => void saveMirrorMode(e.target.value as TelegramMirrorMode)}
          className="rounded-md border bg-background px-2 py-1 font-mono text-sm"
          disabled={busy}
        >
          <option value="minimal">minimal — assistant messages only</option>
          <option value="verbose">verbose — also tool calls</option>
        </select>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label htmlFor="topic-icon" className="m-0 text-mocha-light">
          Topic icon
        </label>
        <input
          id="topic-icon"
          value={iconEmoji}
          onChange={(e) => setIconEmoji(e.target.value)}
          placeholder="(profile default)"
          maxLength={8}
          className="w-32 rounded-md border bg-background px-2 py-1 font-mono text-sm"
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => void saveIcon()}
          disabled={busy || iconEmoji === (agent.telegramIconEmoji ?? '')}
          className="ghost-btn"
        >
          save icon
        </button>
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}

      <p className="mt-3 text-[0.85em] text-mocha-light">
        When bound, every assistant turn for this agent gets mirrored to the topic. Typing in
        the topic triggers a new turn. iOS Telegram clients have a known limitation that
        prevents inline link deep-links from opening directly into a topic — bound state is
        still functional; navigate via the topic list manually.
      </p>
    </div>
    <ConfirmDialog
      open={confirmUnbind}
      onOpenChange={setConfirmUnbind}
      title={`Unbind ${agent.name} from Telegram?`}
      description={
        <p>
          Telegram ingress and mirroring stop for this Agent. The existing forum topic remains in
          Telegram as an orphan until you remove it there.
        </p>
      }
      confirmLabel="Unbind Telegram topic"
      onConfirm={unbind}
    />
    </>
  )
}

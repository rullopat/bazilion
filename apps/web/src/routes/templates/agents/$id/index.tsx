import { ApiClientError } from '@bazilion/client'
import type { LoadedProfile, SkillInfo } from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { PageShell } from '../../../../components/Page'
import { ProfileCommunicationEditor } from '../../../../components/team-policy/ProfileCommunicationEditor'
import { TemplatesTabs } from '../../../../components/TemplatesTabs'
import { daemonClient } from '../../../../lib/daemon-client'
import { DEFAULT_PROFILE_COMMUNICATION } from '../../../../lib/team-policy'
import type { ProfileCommunicationDefaults } from '@bazilion/api-types'

interface ModelGroup {
  provider: string
  models: string[]
}
interface AvailableModelsResponse {
  teams: ModelGroup[]
}

interface ProfileDetailView {
  loaded: LoadedProfile
  modelGroups: ModelGroup[]
  skills: SkillInfo[]
}

const fetchProfile = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<ProfileDetailView | null> => {
    const c = daemonClient()
    let loaded: LoadedProfile
    try {
      loaded = await c.get<LoadedProfile>(`/api/profiles/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [models, skills] = await Promise.all([
      c.get<AvailableModelsResponse>('/api/config/available-models'),
      c.get<SkillInfo[]>('/api/skills'),
    ])
    return { loaded, modelGroups: models.teams, skills }
  })

export const Route = createFileRoute('/templates/agents/$id/')({
  loader: async ({ params }) => {
    const data = await fetchProfile({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/templates/agents' })
    return data
  },
  component: ProfileDetailPage,
})

function ProfileDetailPage() {
  const { loaded, modelGroups, skills } = Route.useLoaderData()
  const [tab, setTab] = useState<'basics' | 'skills' | 'communication'>('basics')

  return (
    <PageShell>
      <TemplatesTabs />
      <header className="mb-1">
        <a
          href="/templates/agents"
          className="mb-1 inline-block text-[0.85em] text-mocha-light hover:text-sapphire"
        >
          ← agent templates
        </a>
        <h1>{loaded.profile.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.9em] text-mocha-light">
          <code>{loaded.profile.id}</code>
          <span>·</span>
          <span>
            model: <code>{loaded.profile.defaultModel}</code>
          </span>
        </div>
      </header>

      <p className="muted my-6">
        These settings and files seed every agent spawned from this Agent template going forward.{' '}
        <strong>Existing agents keep their own copies</strong> — edits here don't propagate to
        already-spawned agents.
      </p>

      <Tabs
        items={[
          { id: 'basics', label: '1. basics' },
          { id: 'skills', label: '2. skills' },
          { id: 'communication', label: '3. communication' },
        ]}
        active={tab}
        onChange={(t) => setTab(t as 'basics' | 'skills' | 'communication')}
      />

      {tab === 'basics' && (
        <div>
          <SettingsCard
            profileId={loaded.profile.id}
            initialName={loaded.profile.name}
            currentModel={loaded.profile.defaultModel}
            modelGroups={modelGroups}
          />
          <FileCard profileId={loaded.profile.id} file="SOUL.md" initialContent={loaded.files.soul} rows={14} />
          <FileCard
            profileId={loaded.profile.id}
            file="IDENTITY.md"
            initialContent={loaded.files.identity}
            rows={10}
          />
          {loaded.files.bootstrap === null ? (
            <section className="file-card">
              <div className="file-head">
                <h3>BOOTSTRAP.md</h3>
              </div>
              <p className="muted">
                This profile was created without a bootstrap prompt. Spawned agents won't see a
                first-run intro message.
              </p>
            </section>
          ) : (
            <FileCard
              profileId={loaded.profile.id}
              file="BOOTSTRAP.md"
              initialContent={loaded.files.bootstrap}
              rows={10}
            />
          )}
          <OptionalFileCard
            profileId={loaded.profile.id}
            file="AGENTS.md"
            initialContent={loaded.files.agents}
            hint="Peers and routing notes — who this agent can hand off to."
          />
          <OptionalFileCard
            profileId={loaded.profile.id}
            file="TOOLS.md"
            initialContent={loaded.files.tools}
            hint="Tool playbook. Agent-specific usage notes that go beyond the generic tool descriptions."
          />
        </div>
      )}

      {tab === 'skills' && (
        <SkillsCard
          profileId={loaded.profile.id}
          initialMode={loaded.profile.skillsMode}
          initialPicked={new Set(loaded.defaultSkills)}
          skills={skills}
        />
      )}

      {tab === 'communication' && (
        <ProfileCommunicationCard profileId={loaded.profile.id} initial={loaded.profile.communicationDefaults ?? DEFAULT_PROFILE_COMMUNICATION} />
      )}
    </PageShell>
  )
}

function ProfileCommunicationCard({ profileId, initial }: { profileId: string; initial: ProfileCommunicationDefaults }) {
  const [value, setValue] = useState<ProfileCommunicationDefaults>(initial)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const dirty = JSON.stringify(value) !== JSON.stringify(initial)
  const save = async () => {
    const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ communicationDefaults: value }) })
    if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? response.statusText)
    setSavedAt(Date.now())
  }

  return (
    <section className="rounded-md border border-frost bg-snow p-5 shadow-baziu-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-body text-[0.95rem] font-semibold normal-case text-chocolate">
          Communication defaults
        </h3>
      </div>
      <p className="muted mb-4">
        Materialized into new Team and Team policy snapshots after preset resolution. Existing
        snapshots never inherit later changes. Stored by the daemon.
      </p>
      <ProfileCommunicationEditor value={value} onChange={setValue} />
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty}
          onClick={save}
        >
          save communication defaults
        </button>
        {savedAt && <span className="text-xs text-sapphire">saved to daemon</span>}
      </div>
    </section>
  )
}

interface TabsProps<T extends string> {
  items: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
}
function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  return (
    <nav
      role="tablist"
      className="-mb-px mb-5 flex gap-1 border-b border-frost"
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={active === it.id}
          onClick={() => onChange(it.id)}
          className={`unstyled cursor-pointer border-b-2 bg-transparent px-4 py-2 text-[0.9em] font-medium transition-colors ${
            active === it.id
              ? 'border-sapphire text-sapphire'
              : 'border-transparent text-mocha hover:text-sapphire'
          }`}
        >
          {it.label}
        </button>
      ))}
    </nav>
  )
}

type StatusKind = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
interface StatusState {
  kind: StatusKind
  message: string
}
function statusColor(kind: StatusKind) {
  if (kind === 'saved') return 'text-sapphire'
  if (kind === 'error') return 'text-danger'
  if (kind === 'dirty') return 'text-mocha'
  return 'text-mocha-light'
}

function FileCardShell({
  title,
  status,
  children,
}: {
  title: string
  status?: StatusState
  children: React.ReactNode
}) {
  return (
    <section className="file-card mb-5 rounded-[16px] border border-frost bg-snow p-5 shadow-baziu-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="m-0 font-mono text-[0.95em] font-semibold normal-case tracking-normal text-chocolate">
          {title}
        </h3>
        {status && (
          <span className={`text-[0.82em] ${statusColor(status.kind)}`}>{status.message}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function FileCard({
  profileId,
  file,
  initialContent,
  rows = 10,
}: {
  profileId: string
  file: string
  initialContent: string
  rows?: number
}) {
  const [original, setOriginal] = useState(initialContent)
  const [content, setContent] = useState(initialContent)
  const [status, setStatus] = useState<StatusState>({ kind: 'idle', message: '' })
  const dirty = content !== original
  const display: StatusState = dirty && status.kind !== 'saving' && status.kind !== 'error'
    ? { kind: 'dirty', message: 'unsaved changes' }
    : status

  async function save() {
    setStatus({ kind: 'saving', message: 'saving…' })
    try {
      const res = await fetch(
        `/api/profiles/${encodeURIComponent(profileId)}/files/${encodeURIComponent(file)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )
      if (!res.ok && res.status !== 204) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e?.error ?? res.statusText)
      }
      setOriginal(content)
      setStatus({ kind: 'saved', message: 'saved' })
    } catch (err) {
      setStatus({ kind: 'error', message: `error: ${(err as Error).message}` })
    }
  }
  function revert() {
    setContent(original)
    setStatus({ kind: 'idle', message: '' })
  }

  return (
    <FileCardShell title={file} status={display}>
      <textarea
        rows={rows}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="font-mono text-[0.88em] leading-[1.55]"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={save}
          disabled={status.kind === 'saving'}
        >
          save
        </button>
        <button type="button" className="ghost-btn" onClick={revert}>
          revert
        </button>
      </div>
    </FileCardShell>
  )
}

function OptionalFileCard({
  profileId,
  file,
  initialContent,
  hint,
}: {
  profileId: string
  file: string
  initialContent: string | null
  hint: string
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<StatusState>({ kind: 'idle', message: '' })

  async function createEmpty() {
    setCreating(true)
    setStatus({ kind: 'saving', message: 'creating…' })
    try {
      const res = await fetch(
        `/api/profiles/${encodeURIComponent(profileId)}/files/${encodeURIComponent(file)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: '' }),
        },
      )
      if (!res.ok && res.status !== 204) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e?.error ?? res.statusText)
      }
      await router.invalidate()
    } catch (err) {
      setStatus({ kind: 'error', message: `error: ${(err as Error).message}` })
      setCreating(false)
    }
  }

  if (initialContent === null) {
    return (
      <FileCardShell title={file} status={status}>
        <p className="muted my-1">{hint}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={createEmpty}
            disabled={creating}
          >
            {creating ? 'creating…' : 'create empty'}
          </button>
        </div>
      </FileCardShell>
    )
  }
  return (
    <>
      <p className="muted -mb-3 ml-1 mt-2 text-[0.85em]">{hint}</p>
      <FileCard profileId={profileId} file={file} initialContent={initialContent} rows={10} />
    </>
  )
}

function SettingsCard({
  profileId,
  initialName,
  currentModel,
  modelGroups,
}: {
  profileId: string
  initialName: string
  currentModel: string
  modelGroups: ModelGroup[]
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [defaultModel, setDefaultModel] = useState(currentModel)
  const [status, setStatus] = useState<StatusState>({ kind: 'idle', message: '' })

  const modelValues = modelGroups.flatMap((g) => g.models.map((m) => `${g.provider}:${m}`))
  const modelMissing = !modelValues.includes(currentModel)

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus({ kind: 'saving', message: 'saving…' })
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), defaultModel: defaultModel.trim() }),
      })
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? res.statusText)
      }
      await router.invalidate()
      setStatus({ kind: 'saved', message: 'saved' })
    } catch (err) {
      setStatus({ kind: 'error', message: `error: ${(err as Error).message}` })
    }
  }

  return (
    <FileCardShell title="settings" status={status}>
      <form onSubmit={save}>
        <div className="flex gap-4">
          <label className="flex-1">
            name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex-1">
            default model
            {modelGroups.length === 0 ? (
              <select disabled>
                <option>(no models available — enable on /config)</option>
              </select>
            ) : (
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                {modelMissing && (
                  <option value={currentModel}>{currentModel} (not in enabled list)</option>
                )}
                {modelGroups.map((g) => (
                  <optgroup key={g.provider} label={g.provider}>
                    {g.models.map((m) => (
                      <option key={m} value={`${g.provider}:${m}`}>
                        {`${g.provider}:${m}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={status.kind === 'saving'}>
            save settings
          </button>
        </div>
      </form>
    </FileCardShell>
  )
}

function SkillsCard({
  profileId,
  initialMode,
  initialPicked,
  skills,
}: {
  profileId: string
  initialMode: 'all' | 'selected'
  initialPicked: Set<string>
  skills: SkillInfo[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'all' | 'selected'>(initialMode)
  const [picked, setPicked] = useState<Set<string>>(initialPicked)
  const [status, setStatus] = useState<StatusState>({ kind: 'idle', message: '' })

  function toggle(name: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus({ kind: 'saving', message: 'saving…' })
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillsMode: mode,
          defaultSkills: mode === 'selected' ? Array.from(picked) : [],
        }),
      })
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? res.statusText)
      }
      // Refetch the loader so the parent's `loaded.defaultSkills` reflects
      // what we just saved. Without this, switching tabs unmounts SkillsCard
      // and remounts it with the stale `initialPicked` snapshot — the save
      // looks like it was lost even though the backend persisted it.
      await router.invalidate()
      setStatus({ kind: 'saved', message: 'saved' })
    } catch (err) {
      setStatus({ kind: 'error', message: `error: ${(err as Error).message}` })
    }
  }

  return (
    <FileCardShell title="skills" status={status}>
      <p className="muted my-2">
        Choose what agents spawned from this profile inherit. Existing agents aren't affected
        — they keep whatever skills they were spawned with.
      </p>
      <form onSubmit={save}>
        <label className="my-2 flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            checked={mode === 'all'}
            onChange={() => setMode('all')}
          />
          <span>
            <strong>allow all skills</strong> — every skill on disk is attached at spawn.
          </span>
        </label>
        <label className="my-2 flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            checked={mode === 'selected'}
            onChange={() => setMode('selected')}
          />
          <span>
            <strong>select skills</strong> — attach only the ones ticked below.
          </span>
        </label>
        <div
          className={`mt-3 max-h-[22rem] overflow-y-auto rounded-md border border-frost p-3 ${mode === 'all' ? 'pointer-events-none opacity-50' : ''}`}
        >
          {skills.length === 0 ? (
            <p className="muted">
              No skills installed yet. Import some on <a href="/skills">/skills</a>.
            </p>
          ) : (
            skills.map((s) => (
              <label key={s.name} className="my-1.5 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(s.name)}
                  onChange={() => toggle(s.name)}
                />
                <span>
                  <code>{s.name}</code>
                  {s.description && (
                    <span className="text-[0.9em] text-mocha-light"> — {s.description}</span>
                  )}
                </span>
              </label>
            ))
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={status.kind === 'saving'}>
            save skills
          </button>
        </div>
      </form>
    </FileCardShell>
  )
}

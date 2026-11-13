import type {
  AvailableModelsResponse,
  LoadedProfile,
  ModelGroup,
  SkillInfo,
  SkillsMode,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Button } from '../../../../components/Button'
import { AVAILABLE_MODELS_PATH, ModelSelect } from '../../../../components/ModelSelect'
import { PageShell } from '../../../../components/Page'
import { SectionTabs, TEMPLATE_TABS } from '../../../../components/SectionTabs'
import { SkillsPicker } from '../../../../components/SkillsPicker'
import { Tabs } from '../../../../components/Tabs'
import { UnsavedChangesGuard } from '../../../../components/UnsavedChangesGuard'
import { api, errorMessage } from '../../../../lib/api'
import { daemonClient } from '../../../../lib/daemon-client'

const fetchProfile = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    let loaded: LoadedProfile
    try {
      loaded = await client.get<LoadedProfile>(`/api/profiles/${encodeURIComponent(data.id)}`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
    const [models, skills] = await Promise.all([
      client.get<AvailableModelsResponse>(AVAILABLE_MODELS_PATH),
      client.get<SkillInfo[]>('/api/skills'),
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

type DirtyChange = (section: string, dirty: boolean) => void

function ProfileDetailPage() {
  const { loaded, modelGroups, skills } = Route.useLoaderData()
  const { profile, files } = loaded
  const [tab, setTab] = useState<'basics' | 'skills'>('basics')
  const [dirtySections, setDirtySections] = useState<Record<string, boolean>>({})
  const reportDirty = useCallback<DirtyChange>((section, dirty) => {
    setDirtySections((current) =>
      current[section] === dirty ? current : { ...current, [section]: dirty },
    )
  }, [])
  const dirtyCount = Object.values(dirtySections).filter(Boolean).length

  return (
    <PageShell>
      <UnsavedChangesGuard when={dirtyCount > 0} subject="Agent template changes" />
      <SectionTabs label="Template kinds" base="/templates" tabs={TEMPLATE_TABS} />
      <header>
        <a
          href="/templates/agents"
          className="mb-1 inline-block text-[0.85em] text-mocha-light hover:text-sapphire"
        >
          ← Agent templates
        </a>
        <h1>{profile.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.9em] text-mocha-light">
          <code>{profile.id}</code>
          <span>·</span>
          <span>
            model: <code>{profile.defaultModel}</code>
          </span>
        </div>
        <p className="muted mt-4">
          These settings and files seed every agent spawned from this template from now on. Existing
          agents keep their own copies.
        </p>
      </header>

      <Tabs
        items={[
          { id: 'basics', label: 'Basics' },
          { id: 'skills', label: 'Skills' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {dirtyCount > 0 && (
        <p role="status" className="text-sm text-warning">
          {dirtyCount} unsaved {dirtyCount === 1 ? 'section' : 'sections'}: switching tabs keeps
          them; leaving the page asks first.
        </p>
      )}

      <div hidden={tab !== 'basics'} className="space-y-5">
        <SettingsCard
          profileId={profile.id}
          initialName={profile.name}
          currentModel={profile.defaultModel}
          modelGroups={modelGroups}
          onDirtyChange={reportDirty}
        />
        <FileCard
          profileId={profile.id}
          file="SOUL.md"
          initial={files.soul}
          rows={14}
          onDirtyChange={reportDirty}
        />
        <FileCard
          profileId={profile.id}
          file="IDENTITY.md"
          initial={files.identity}
          rows={10}
          onDirtyChange={reportDirty}
        />
        {files.bootstrap === null ? (
          <Card title="BOOTSTRAP.md">
            <p className="muted">
              This template has no first-run ritual, so spawned agents get no intro message.
            </p>
          </Card>
        ) : (
          <FileCard
            profileId={profile.id}
            file="BOOTSTRAP.md"
            initial={files.bootstrap}
            rows={10}
            onDirtyChange={reportDirty}
          />
        )}
        <OptionalFileCard
          profileId={profile.id}
          file="AGENTS.md"
          initial={files.agents}
          hint="Peers and routing notes: who this agent can hand off to."
          onDirtyChange={reportDirty}
        />
        <OptionalFileCard
          profileId={profile.id}
          file="TOOLS.md"
          initial={files.tools}
          hint="Agent-specific tool notes beyond the generic tool descriptions."
          onDirtyChange={reportDirty}
        />
      </div>

      <div hidden={tab !== 'skills'}>
        <SkillsCard
          profileId={profile.id}
          initialMode={profile.skillsMode}
          initialPicked={loaded.defaultSkills}
          skills={skills}
          onDirtyChange={reportDirty}
        />
      </div>
    </PageShell>
  )
}

interface Status {
  kind: 'idle' | 'saving' | 'saved' | 'error'
  message: string
}
const IDLE: Status = { kind: 'idle', message: '' }

/** Saving and failure win over "unsaved changes". */
function shownStatus(dirty: boolean, status: Status): Status & { dirty?: boolean } {
  return dirty && status.kind !== 'saving' && status.kind !== 'error'
    ? { kind: 'idle', message: 'unsaved changes', dirty: true }
    : status
}

function useDirty(section: string, dirty: boolean, onDirtyChange: DirtyChange) {
  useEffect(() => onDirtyChange(section, dirty), [dirty, onDirtyChange, section])
}

function Card({
  title,
  status,
  children,
}: {
  title: string
  status?: Status & { dirty?: boolean }
  children: ReactNode
}) {
  const tone =
    status?.kind === 'saved'
      ? 'text-sapphire'
      : status?.kind === 'error'
        ? 'text-danger'
        : status?.dirty
          ? 'text-mocha'
          : 'text-mocha-light'
  return (
    <section className="rounded-[16px] border border-frost bg-snow p-5 shadow-baziu-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="m-0 font-mono text-[0.95em] font-semibold normal-case tracking-normal text-chocolate">
          {title}
        </h3>
        {status?.message && (
          <span
            role={status.kind === 'error' ? 'alert' : 'status'}
            className={`text-[0.82em] ${tone}`}
          >
            {status.message}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

/** Run a save, reporting progress in the card's status line. */
async function saving(setStatus: (status: Status) => void, save: () => Promise<void>) {
  setStatus({ kind: 'saving', message: 'saving…' })
  try {
    await save()
    setStatus({ kind: 'saved', message: 'saved' })
  } catch (cause) {
    setStatus({ kind: 'error', message: `error: ${errorMessage(cause)}` })
  }
}

function filePath(profileId: string, file: string): string {
  return `/api/profiles/${encodeURIComponent(profileId)}/files/${encodeURIComponent(file)}`
}

function FileCard({
  profileId,
  file,
  initial,
  rows,
  onDirtyChange,
}: {
  profileId: string
  file: string
  initial: string
  rows: number
  onDirtyChange: DirtyChange
}) {
  const [original, setOriginal] = useState(initial)
  const [content, setContent] = useState(initial)
  const [status, setStatus] = useState(IDLE)
  const dirty = content !== original
  useDirty(`file:${file}`, dirty, onDirtyChange)

  return (
    <Card title={file} status={shownStatus(dirty, status)}>
      <textarea
        aria-label={`${file} contents`}
        rows={rows}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        className="font-mono text-[0.88em] leading-[1.55]"
      />
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          disabled={status.kind === 'saving'}
          onClick={() =>
            void saving(setStatus, async () => {
              await api(filePath(profileId, file), { method: 'PUT', body: { content } })
              setOriginal(content)
            })
          }
        >
          Save
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setContent(original)
            setStatus(IDLE)
          }}
        >
          Revert
        </Button>
      </div>
    </Card>
  )
}

function OptionalFileCard({
  profileId,
  file,
  initial,
  hint,
  onDirtyChange,
}: {
  profileId: string
  file: string
  initial: string | null
  hint: string
  onDirtyChange: DirtyChange
}) {
  const router = useRouter()
  const [status, setStatus] = useState(IDLE)

  if (initial === null) {
    return (
      <Card title={file} status={status}>
        <p className="muted my-1">{hint}</p>
        <Button
          variant="primary"
          className="mt-3"
          disabled={status.kind === 'saving'}
          onClick={() =>
            void saving(setStatus, async () => {
              await api(filePath(profileId, file), { method: 'PUT', body: { content: '' } })
              await router.invalidate()
            })
          }
        >
          {status.kind === 'saving' ? 'Creating…' : 'Create empty'}
        </Button>
      </Card>
    )
  }
  return (
    <div>
      <p className="muted mb-2 ml-1 text-[0.85em]">{hint}</p>
      <FileCard
        profileId={profileId}
        file={file}
        initial={initial}
        rows={10}
        onDirtyChange={onDirtyChange}
      />
    </div>
  )
}

function SettingsCard({
  profileId,
  initialName,
  currentModel,
  modelGroups,
  onDirtyChange,
}: {
  profileId: string
  initialName: string
  currentModel: string
  modelGroups: ModelGroup[]
  onDirtyChange: DirtyChange
}) {
  const router = useRouter()
  const [original, setOriginal] = useState({ name: initialName, model: currentModel })
  const [name, setName] = useState(initialName)
  const [model, setModel] = useState(currentModel)
  const [status, setStatus] = useState(IDLE)
  const dirty = name !== original.name || model !== original.model
  useDirty('settings', dirty, onDirtyChange)

  return (
    <Card title="settings" status={shownStatus(dirty, status)}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void saving(setStatus, async () => {
            const next = { name: name.trim(), model }
            await api(`/api/profiles/${encodeURIComponent(profileId)}`, {
              method: 'PATCH',
              body: { name: next.name, defaultModel: next.model },
            })
            await router.invalidate()
            setName(next.name)
            setOriginal(next)
          })
        }}
      >
        <div className="grid gap-x-4 sm:grid-cols-2">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <ModelSelect
            label="Default model"
            value={model}
            onChange={setModel}
            groups={modelGroups}
            required
          />
        </div>
        <Button
          variant="primary"
          type="submit"
          className="mt-3"
          disabled={!dirty || status.kind === 'saving'}
        >
          Save settings
        </Button>
      </form>
    </Card>
  )
}

function SkillsCard({
  profileId,
  initialMode,
  initialPicked,
  skills,
  onDirtyChange,
}: {
  profileId: string
  initialMode: SkillsMode
  initialPicked: string[]
  skills: SkillInfo[]
  onDirtyChange: DirtyChange
}) {
  const router = useRouter()
  const [original, setOriginal] = useState({ mode: initialMode, picked: new Set(initialPicked) })
  const [mode, setMode] = useState(initialMode)
  const [picked, setPicked] = useState(() => new Set(initialPicked))
  const [status, setStatus] = useState(IDLE)
  const dirty =
    mode !== original.mode ||
    picked.size !== original.picked.size ||
    [...picked].some((name) => !original.picked.has(name))
  useDirty('skills', dirty, onDirtyChange)

  return (
    <Card title="skills" status={shownStatus(dirty, status)}>
      <p className="muted my-2">
        What agents spawned from this template start with. Existing agents keep their skills.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void saving(setStatus, async () => {
            const saved = mode === 'selected' ? new Set(picked) : new Set<string>()
            await api(`/api/profiles/${encodeURIComponent(profileId)}`, {
              method: 'PATCH',
              body: { skillsMode: mode, defaultSkills: [...saved] },
            })
            // The reload keeps the Skills tab in step if it remounts.
            await router.invalidate()
            setPicked(saved)
            setOriginal({ mode, picked: saved })
          })
        }}
      >
        <SkillsPicker
          mode={mode}
          onModeChange={setMode}
          picked={picked}
          onPickedChange={setPicked}
          skills={skills}
        />
        <Button
          variant="primary"
          type="submit"
          className="mt-3"
          disabled={!dirty || status.kind === 'saving'}
        >
          Save skills
        </Button>
      </form>
    </Card>
  )
}

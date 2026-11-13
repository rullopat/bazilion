import type {
  AvailableModelsResponse,
  CreateProfileRequest,
  ModelGroup,
  ProfileSummary,
  ProfileTemplates,
  SkillInfo,
  SkillsMode,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { AVAILABLE_MODELS_PATH, ModelSelect } from '../../../components/ModelSelect'
import {
  ItemList,
  ItemRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
} from '../../../components/Page'
import { SectionTabs, TEMPLATE_TABS } from '../../../components/SectionTabs'
import { SkillsPicker } from '../../../components/SkillsPicker'
import { Tabs } from '../../../components/Tabs'
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const fetchProfiles = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [profiles, models, skills, templates] = await Promise.all([
    client.get<ProfileSummary[]>('/api/profiles'),
    client.get<AvailableModelsResponse>(AVAILABLE_MODELS_PATH),
    client.get<SkillInfo[]>('/api/skills'),
    client.get<ProfileTemplates>('/api/profiles/_/templates'),
  ])
  return { profiles, modelGroups: models.teams, skills, templates }
})

export const Route = createFileRoute('/templates/agents/')({
  loader: () => fetchProfiles(),
  component: ProfilesPage,
})

function ProfilesPage() {
  const { profiles, modelGroups, skills, templates } = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<ProfileSummary | null>(null)

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Templates"
        title="Agent templates"
        description="Reusable identity, model and skills for newly spawned agents."
      />
      <SectionTabs label="Template kinds" base="/templates" tabs={TEMPLATE_TABS} />

      <CreateProfileForm
        modelGroups={modelGroups}
        skills={skills}
        templates={templates}
        onCreated={() => router.invalidate()}
      />

      <SectionCard title="Templates">
        {profiles.length === 0 ? (
          <p className="muted">No Agent templates yet.</p>
        ) : (
          <ItemList>
            {profiles.map((profile) => (
              <ItemRow
                key={profile.id}
                title={
                  <a href={`/templates/agents/${encodeURIComponent(profile.id)}`}>{profile.name}</a>
                }
                meta={
                  <>
                    <code>{profile.id}</code>
                    <code>{profile.defaultModel}</code>
                    <span>
                      {profile.agentCount} agent{profile.agentCount === 1 ? '' : 's'}
                    </span>
                    <span>
                      skills:{' '}
                      {profile.skillsMode === 'all'
                        ? 'all'
                        : profile.defaultSkills.join(', ') || 'none'}
                    </span>
                  </>
                }
                actions={
                  profile.agentCount === 0 ? (
                    <Button variant="danger" onClick={() => setDeleteTarget(profile)}>
                      Delete
                    </Button>
                  ) : (
                    <StatusBadge title={`${profile.agentCount} agent(s) use this template`}>
                      In use
                    </StatusBadge>
                  )
                }
              />
            ))}
          </ItemList>
        )}
      </SectionCard>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete Agent template ${deleteTarget?.name ?? ''}?`}
        description={
          <p>
            This permanently deletes <code className="font-mono">{deleteTarget?.id}</code> and its
            files. Existing Agents keep their own copies.
          </p>
        }
        confirmLabel="Delete Agent template"
        onConfirm={async () => {
          if (!deleteTarget) return
          await api(`/api/profiles/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
          await router.invalidate()
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </PageShell>
  )
}

type FileKey = 'soul' | 'identity' | 'bootstrap' | 'agents' | 'tools'
type TabKey = 'basics' | FileKey | 'skills'

const FILES: { key: FileKey; label: string; hint: string; rows: number; optional: boolean }[] = [
  {
    key: 'soul',
    label: 'SOUL.md',
    hint: 'Persona, values and operating principles. Part of every session.',
    rows: 16,
    optional: false,
  },
  {
    key: 'identity',
    label: 'IDENTITY.md',
    hint: 'Name, creature, vibe, emoji, avatar: filled in during the first-run ritual.',
    rows: 12,
    optional: false,
  },
  {
    key: 'bootstrap',
    label: 'BOOTSTRAP.md',
    hint: 'The first-run ritual; the agent retires it once introductions are done.',
    rows: 16,
    optional: true,
  },
  {
    key: 'agents',
    label: 'AGENTS.md',
    hint: 'The workspace operating manual: memory discipline, red lines, channel etiquette.',
    rows: 16,
    optional: true,
  },
  {
    key: 'tools',
    label: 'TOOLS.md',
    hint: 'Agent-specific tool notes and environment facts beyond the tool descriptions.',
    rows: 14,
    optional: true,
  },
]

function CreateProfileForm({
  modelGroups,
  skills,
  templates,
  onCreated,
}: {
  modelGroups: ModelGroup[]
  skills: SkillInfo[]
  templates: ProfileTemplates
  onCreated: () => Promise<void>
}) {
  const initialFiles = (): Record<FileKey, string> => ({
    soul: templates.soul,
    identity: templates.identity,
    bootstrap: templates.bootstrap,
    agents: templates.agents,
    tools: templates.tools,
  })
  const [tab, setTab] = useState<TabKey>('basics')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [files, setFiles] = useState(initialFiles)
  // SOUL and IDENTITY are always created; the optional files start enabled.
  const [enabled, setEnabled] = useState<Record<FileKey, boolean>>({
    soul: true,
    identity: true,
    bootstrap: true,
    agents: true,
    tools: true,
  })
  const [skillsMode, setSkillsMode] = useState<SkillsMode>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const starter = initialFiles()
  const dirty =
    id.length > 0 ||
    name.length > 0 ||
    model.length > 0 ||
    FILES.some((file) => files[file.key] !== starter[file.key] || !enabled[file.key]) ||
    skillsMode !== 'all' ||
    picked.size > 0

  function toggleFile(key: FileKey, on: boolean) {
    setEnabled((current) => ({ ...current, [key]: on }))
    if (!on && tab === key) setTab('basics')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api('/api/profiles', {
        body: {
          id: id.trim(),
          name: name.trim() || undefined,
          defaultModel: model,
          skillsMode,
          defaultSkills: skillsMode === 'selected' ? Array.from(picked) : [],
          soul: files.soul,
          identity: files.identity,
          // null leaves an optional file out.
          bootstrap: enabled.bootstrap ? files.bootstrap : null,
          agents: enabled.agents ? files.agents : null,
          tools: enabled.tools ? files.tools : null,
        } satisfies CreateProfileRequest,
      })
      setId('')
      setName('')
      setModel('')
      setFiles(initialFiles())
      setEnabled({ soul: true, identity: true, bootstrap: true, agents: true, tools: true })
      setPicked(new Set())
      setSkillsMode('all')
      setTab('basics')
      await onCreated()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const file = FILES.find((entry) => entry.key === tab)
  return (
    <SectionCard title="Create an Agent template">
      <form onSubmit={(event) => void submit(event)}>
        <UnsavedChangesGuard when={dirty && !submitting} subject="Agent template draft" />
        {error && (
          <p role="alert" className="err">
            {error}
          </p>
        )}
        <Tabs
          items={[
            { id: 'basics', label: 'Basics' },
            ...FILES.map((entry) => ({
              id: entry.key,
              label: entry.label.replace('.md', ''),
              disabled: !enabled[entry.key],
            })),
            { id: 'skills', label: 'Skills' },
          ]}
          active={tab}
          onChange={setTab}
        />

        <fieldset className="mb-5 rounded-md border border-frost p-3">
          <legend className="px-1 text-[0.85em] font-medium text-mocha">Files to include</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[0.9em]">
            {FILES.map((entry) => (
              <label
                key={entry.key}
                className={`m-0 inline-flex items-center gap-1.5 ${entry.optional ? 'cursor-pointer' : 'opacity-60'}`}
                title={entry.optional ? undefined : 'always included'}
              >
                <input
                  type="checkbox"
                  checked={enabled[entry.key]}
                  disabled={!entry.optional}
                  onChange={(event) => toggleFile(entry.key, event.target.checked)}
                />
                {entry.label}
              </label>
            ))}
          </div>
          <p className="muted mt-2 text-[0.8em]">
            Each spawned agent gets its own copy of the included files.
          </p>
        </fieldset>

        {tab === 'basics' && (
          <div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <label>
                ID (slug)
                <input value={id} onChange={(event) => setId(event.target.value)} required />
              </label>
              <label>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            </div>
            <ModelSelect
              label="Default model"
              value={model}
              onChange={setModel}
              groups={modelGroups}
              required
            />
            {modelGroups.length === 0 && (
              <p className="muted text-[0.85em]">
                Enable a provider and curate its models under <a href="/config">Setup</a> first.
              </p>
            )}
          </div>
        )}
        {file && (
          <div>
            <p className="muted my-2 text-[0.85em]">{file.hint}</p>
            <label>
              {file.label}
              <textarea
                rows={file.rows}
                value={files[file.key]}
                onChange={(event) =>
                  setFiles((current) => ({ ...current, [file.key]: event.target.value }))
                }
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
          </div>
        )}
        {tab === 'skills' && (
          <SkillsPicker
            mode={skillsMode}
            onModeChange={setSkillsMode}
            picked={picked}
            onPickedChange={setPicked}
            skills={skills}
          />
        )}

        <div className="mt-5">
          <Button variant="primary" type="submit" disabled={submitting || !id.trim() || !model}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </SectionCard>
  )
}

import type { Profile, SkillInfo } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { TemplatesTabs } from '../../components/TemplatesTabs'
import { daemonClient } from '../../lib/daemon-client'

interface ProfileWithCounts extends Profile {
  agentCount: number
  defaultSkills: string[]
}
interface ModelGroup {
  provider: string
  models: string[]
}
interface AvailableModelsResponse {
  groups: ModelGroup[]
}
interface TemplatesResponse {
  soul: string
  identity: string
  bootstrap: string
}

interface ProfilesView {
  profiles: ProfileWithCounts[]
  modelGroups: ModelGroup[]
  skills: SkillInfo[]
  templates: TemplatesResponse
}

const fetchProfiles = createServerFn({ method: 'GET' }).handler(async (): Promise<ProfilesView> => {
  const c = daemonClient()
  const [profiles, models, skills, templates] = await Promise.all([
    c.get<ProfileWithCounts[]>('/api/profiles'),
    c.get<AvailableModelsResponse>('/api/config/available-models'),
    c.get<SkillInfo[]>('/api/skills'),
    c.get<TemplatesResponse>('/api/profiles/_/templates'),
  ])
  return { profiles, modelGroups: models.groups, skills, templates }
})

export const Route = createFileRoute('/profiles/')({
  loader: () => fetchProfiles(),
  component: ProfilesPage,
})

function ProfilesPage() {
  const { profiles, modelGroups, skills, templates } = Route.useLoaderData()
  const router = useRouter()

  async function del(id: string) {
    if (!confirm('delete profile and all its files?')) return
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      alert(body?.error ?? res.statusText)
      return
    }
    await router.invalidate()
  }

  return (
    <div>
      <TemplatesTabs />
      <h1>profiles</h1>
      <p className="muted">
        A profile is a spawn template — SOUL/IDENTITY templates, a default model, a skills
        policy. Agents choose a group at spawn time, independent of their profile.
      </p>

      <CreateProfileForm
        modelGroups={modelGroups}
        skills={skills}
        templates={templates}
        onCreated={() => router.invalidate()}
      />

      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>model</th>
            <th>agents</th>
            <th>skills</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {profiles.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                no profiles yet
              </td>
            </tr>
          )}
          {profiles.map((p) => {
            const skillsLabel =
              p.skillsMode === 'all'
                ? 'all'
                : p.defaultSkills.length === 0
                  ? '—'
                  : p.defaultSkills.join(', ')
            return (
              <tr key={p.id}>
                <td>
                  <a href={`/profiles/${p.id}`}>
                    <code>{p.id}</code>
                  </a>
                </td>
                <td>{p.name}</td>
                <td>
                  <code>{p.defaultModel}</code>
                </td>
                <td>{p.agentCount}</td>
                <td className="text-xs text-mocha-light">{skillsLabel}</td>
                <td>
                  {p.agentCount === 0 ? (
                    <Button variant="danger" onClick={() => del(p.id)}>
                      delete
                    </Button>
                  ) : (
                    <span className="muted" title={`${p.agentCount} agent(s) use this profile`}>
                      in use
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CreateProfileForm({
  modelGroups,
  skills,
  templates,
  onCreated,
}: {
  modelGroups: ModelGroup[]
  skills: SkillInfo[]
  templates: TemplatesResponse
  onCreated: () => void
}) {
  const [tab, setTab] = useState<'basics' | 'skills'>('basics')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [soul, setSoul] = useState(templates.soul)
  const [identity, setIdentity] = useState(templates.identity)
  const [bootstrap, setBootstrap] = useState(templates.bootstrap)
  const [skipBootstrap, setSkipBootstrap] = useState(false)
  const [agentsTpl, setAgentsTpl] = useState('')
  const [toolsTpl, setToolsTpl] = useState('')
  const [heartbeatTpl, setHeartbeatTpl] = useState('')
  const [skillsMode, setSkillsMode] = useState<'all' | 'selected'>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function togglePicked(name: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!id.trim()) {
      setError('id is required')
      return
    }
    if (!model.trim()) {
      setError('default model is required')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        id: id.trim(),
        name: name.trim() || undefined,
        model: model.trim(),
        skillsMode,
        defaultSkills: skillsMode === 'selected' ? Array.from(picked) : [],
        soul,
        identity,
        bootstrap,
        skipBootstrap,
        agents: agentsTpl,
        tools: toolsTpl,
        heartbeat: heartbeatTpl,
      }
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? res.statusText)
      }
      // Reset
      setId('')
      setName('')
      setModel('')
      setAgentsTpl('')
      setToolsTpl('')
      setHeartbeatTpl('')
      setPicked(new Set())
      setSkillsMode('all')
      setTab('basics')
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>create profile</h3>
      {error && <div className="err">{error}</div>}

      <Tabs
        items={[
          { id: 'basics', label: '1. basics' },
          { id: 'skills', label: '2. skills' },
        ]}
        active={tab}
        onChange={(t) => setTab(t as 'basics' | 'skills')}
      />

      {tab === 'basics' && (
        <div>
          <div className="flex gap-4">
            <label className="flex-1">
              id (slug)
              <input value={id} onChange={(e) => setId(e.target.value)} required />
            </label>
            <label className="flex-1">
              name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label>
            default model
            {modelGroups.length === 0 ? (
              <>
                <select disabled>
                  <option>(no models available)</option>
                </select>
                <span className="muted text-[0.85em]">
                  Enable a provider and curate models on <a href="/config">/config</a> first.
                </span>
              </>
            ) : (
              <select value={model} onChange={(e) => setModel(e.target.value)} required>
                <option value="">-- pick a model --</option>
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

          <details className="mt-4 [&>summary]:cursor-pointer [&>summary]:py-1.5 [&>summary]:font-medium [&>summary]:text-mocha [&[open]>summary]:text-sapphire">
            <summary>templates (SOUL · IDENTITY · BOOTSTRAP)</summary>
            <p className="muted my-2">
              These seed each agent spawned from this profile. Every agent gets its own copy at
              spawn time — editing the profile later doesn't affect existing agents.
            </p>
            <label>
              SOUL.md
              <textarea
                rows={10}
                value={soul}
                onChange={(e) => setSoul(e.target.value)}
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
            <label>
              IDENTITY.md
              <textarea
                rows={6}
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
            <label>
              BOOTSTRAP.md
              <textarea
                rows={8}
                value={bootstrap}
                onChange={(e) => setBootstrap(e.target.value)}
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={skipBootstrap}
                onChange={(e) => setSkipBootstrap(e.target.checked)}
              />
              skip bootstrap (no first-run intro)
            </label>
          </details>

          <details className="mt-4 [&>summary]:cursor-pointer [&>summary]:py-1.5 [&>summary]:font-medium [&>summary]:text-mocha [&[open]>summary]:text-sapphire">
            <summary>optional files (AGENTS · TOOLS · HEARTBEAT)</summary>
            <p className="muted my-2">
              Optional. Paste in content to seed these files. Left blank, the files are not
              created — you can always add them later from the profile detail page.
            </p>
            <label>
              AGENTS.md
              <textarea
                rows={6}
                placeholder="Peers this agent can route to."
                value={agentsTpl}
                onChange={(e) => setAgentsTpl(e.target.value)}
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
            <label>
              TOOLS.md
              <textarea
                rows={6}
                placeholder="Agent-specific tool usage notes."
                value={toolsTpl}
                onChange={(e) => setToolsTpl(e.target.value)}
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
            <label>
              HEARTBEAT.md
              <textarea
                rows={6}
                placeholder="Tasks to check on scheduled wake-ups."
                value={heartbeatTpl}
                onChange={(e) => setHeartbeatTpl(e.target.value)}
                className="font-mono text-[0.88em] leading-[1.55]"
              />
            </label>
          </details>
        </div>
      )}

      {tab === 'skills' && (
        <div>
          <p className="muted my-2">
            Choose which skills agents inherit at spawn time. In both modes each agent can still
            attach or detach skills individually after it's spawned.
          </p>
          <label className="flex items-start gap-2 my-2 cursor-pointer">
            <input
              type="radio"
              name="skillsMode"
              value="all"
              checked={skillsMode === 'all'}
              onChange={() => setSkillsMode('all')}
            />
            <span>
              <strong>allow all skills</strong> — every skill on disk is attached when an agent
              is spawned.
            </span>
          </label>
          <label className="flex items-start gap-2 my-2 cursor-pointer">
            <input
              type="radio"
              name="skillsMode"
              value="selected"
              checked={skillsMode === 'selected'}
              onChange={() => setSkillsMode('selected')}
            />
            <span>
              <strong>select skills</strong> — attach only the ones you pick below.
            </span>
          </label>

          <div
            className={`mt-3 max-h-[22rem] overflow-y-auto rounded-md border border-frost p-3 ${skillsMode === 'all' ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {skills.length === 0 ? (
              <p className="muted">
                No skills installed yet. Import some on <a href="/skills">/skills</a>.
              </p>
            ) : (
              skills.map((s) => (
                <label
                  key={s.name}
                  className="my-1.5 flex cursor-pointer items-start gap-2"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(s.name)}
                    onChange={() => togglePicked(s.name)}
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
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? 'creating…' : 'create'}
        </Button>
      </div>
    </form>
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

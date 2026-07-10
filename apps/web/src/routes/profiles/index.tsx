import type { Profile, SkillInfo } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ProfileCommunicationEditor } from '../../components/harness/ProfileCommunicationEditor'
import { PrototypeBadge } from '../../components/harness/PrototypeBadge'
import { useHarnessPrototype } from '../../hooks/use-harness-prototype'
import { TemplatesTabs } from '../../components/TemplatesTabs'
import { daemonClient } from '../../lib/daemon-client'
import { DEFAULT_PROFILE_COMMUNICATION } from '../../lib/harness-prototype'

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
  agents: string
  tools: string
  heartbeat: string
  userMd: string
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

type TabKey =
  | 'basics'
  | 'soul'
  | 'identity'
  | 'bootstrap'
  | 'agents'
  | 'tools'
  | 'heartbeat'
  | 'skills'
  | 'communication'

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
  const { update: updateHarnessPrototype } = useHarnessPrototype()
  const [tab, setTab] = useState<TabKey>('basics')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [soul, setSoul] = useState(templates.soul)
  const [identity, setIdentity] = useState(templates.identity)
  const [bootstrap, setBootstrap] = useState(templates.bootstrap)
  // SOUL + IDENTITY are always included (no toggle). BOOTSTRAP/AGENTS/TOOLS are
  // on by default; HEARTBEAT is opt-in (off). Textareas are
  // prefilled with the built-in defaults so an enabled file is ready to edit.
  const [enableBootstrap, setEnableBootstrap] = useState(true)
  const [agentsTpl, setAgentsTpl] = useState(templates.agents)
  const [enableAgents, setEnableAgents] = useState(true)
  const [toolsTpl, setToolsTpl] = useState(templates.tools)
  const [enableTools, setEnableTools] = useState(true)
  const [heartbeatTpl, setHeartbeatTpl] = useState(templates.heartbeat)
  const [enableHeartbeat, setEnableHeartbeat] = useState(false)

  // Toggle a template on/off. Disabling the currently-open tab drops the editor
  // back to "basics" so we never show a disabled tab's panel.
  function setTemplateEnabled(key: TabKey, setter: (on: boolean) => void, on: boolean) {
    setter(on)
    if (!on && tab === key) setTab('basics')
  }
  const [skillsMode, setSkillsMode] = useState<'all' | 'selected'>('all')
  const [communication, setCommunication] = useState(DEFAULT_PROFILE_COMMUNICATION)
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
        // null opts a template out; SOUL/IDENTITY are always sent.
        bootstrap: enableBootstrap ? bootstrap : null,
        agents: enableAgents ? agentsTpl : null,
        tools: enableTools ? toolsTpl : null,
        heartbeat: enableHeartbeat ? heartbeatTpl : null,
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
      const profileId = id.trim()
      updateHarnessPrototype((current) => ({
        ...current,
        profileDefaults: {
          ...current.profileDefaults,
          [profileId]: communication,
        },
      }))
      // Reset
      setId('')
      setName('')
      setModel('')
      setEnableBootstrap(true)
      setAgentsTpl(templates.agents)
      setEnableAgents(true)
      setToolsTpl(templates.tools)
      setEnableTools(true)
      setHeartbeatTpl(templates.heartbeat)
      setEnableHeartbeat(false)
      setPicked(new Set())
      setSkillsMode('all')
      setCommunication(DEFAULT_PROFILE_COMMUNICATION)
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
          { id: 'basics', label: 'basics' },
          { id: 'soul', label: 'SOUL' },
          { id: 'identity', label: 'IDENTITY' },
          { id: 'bootstrap', label: 'BOOTSTRAP', disabled: !enableBootstrap },
          { id: 'agents', label: 'AGENTS', disabled: !enableAgents },
          { id: 'tools', label: 'TOOLS', disabled: !enableTools },
          { id: 'heartbeat', label: 'HEARTBEAT', disabled: !enableHeartbeat },
          { id: 'skills', label: 'skills' },
          { id: 'communication', label: 'communication' },
        ]}
        active={tab}
        onChange={(t) => setTab(t as TabKey)}
      />

      {/* Enable checklist — outside the tab panels so it always governs which
          template tabs are active. SOUL + IDENTITY are always included. */}
      <fieldset className="mb-5 rounded-md border border-frost p-3">
        <legend className="px-1 text-[0.85em] font-medium text-mocha">templates to include</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[0.9em]">
          <label className="inline-flex items-center gap-1.5 opacity-60" title="always included">
            <input type="checkbox" defaultChecked disabled /> SOUL.md
          </label>
          <label className="inline-flex items-center gap-1.5 opacity-60" title="always included">
            <input type="checkbox" defaultChecked disabled /> IDENTITY.md
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={enableBootstrap}
              onChange={(e) => setTemplateEnabled('bootstrap', setEnableBootstrap, e.target.checked)}
            />
            BOOTSTRAP.md
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={enableAgents}
              onChange={(e) => setTemplateEnabled('agents', setEnableAgents, e.target.checked)}
            />
            AGENTS.md
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={enableTools}
              onChange={(e) => setTemplateEnabled('tools', setEnableTools, e.target.checked)}
            />
            TOOLS.md
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={enableHeartbeat}
              onChange={(e) => setTemplateEnabled('heartbeat', setEnableHeartbeat, e.target.checked)}
            />
            HEARTBEAT.md
          </label>
        </div>
        <p className="muted mt-2 text-[0.8em]">
          Disabled files aren't created for this profile. Each spawned agent gets its own copy of
          the enabled files at spawn time.
        </p>
      </fieldset>

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
        </div>
      )}

      {tab === 'soul' && (
        <TemplateTab
          label="SOUL.md"
          hint="Persona, values, and operating principles. Injected into every session."
          value={soul}
          onChange={setSoul}
          rows={16}
        />
      )}
      {tab === 'identity' && (
        <TemplateTab
          label="IDENTITY.md"
          hint="Name, creature, vibe, emoji, avatar — filled in during the bootstrap ritual."
          value={identity}
          onChange={setIdentity}
          rows={12}
        />
      )}
      {tab === 'bootstrap' && (
        <TemplateTab
          label="BOOTSTRAP.md"
          hint="One-time first-run ritual. The agent retires it once introductions are done."
          value={bootstrap}
          onChange={setBootstrap}
          rows={16}
        />
      )}
      {tab === 'agents' && (
        <TemplateTab
          label="AGENTS.md"
          hint="The workspace operating manual — memory discipline, red lines, channel etiquette."
          value={agentsTpl}
          onChange={setAgentsTpl}
          rows={16}
        />
      )}
      {tab === 'tools' && (
        <TemplateTab
          label="TOOLS.md"
          hint="Agent-specific tool notes and environment facts beyond the generic tool descriptions."
          value={toolsTpl}
          onChange={setToolsTpl}
          rows={14}
        />
      )}
      {tab === 'heartbeat' && (
        <TemplateTab
          label="HEARTBEAT.md"
          hint="Optional checklist run on scheduled wake-ups. Pair with an interval/cron trigger."
          value={heartbeatTpl}
          onChange={setHeartbeatTpl}
          rows={12}
        />
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

      {tab === 'communication' && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h4 className="text-sm font-semibold text-chocolate">Communication defaults</h4>
            <PrototypeBadge />
          </div>
          <p className="muted mb-4">
            Copied into a harness preview when this profile is selected. These values stay in
            this browser and are not sent to the daemon.
          </p>
          <ProfileCommunicationEditor value={communication} onChange={setCommunication} />
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
  items: { id: T; label: string; disabled?: boolean }[]
  active: T
  onChange: (id: T) => void
}
function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  return (
    <nav role="tablist" className="-mb-px mb-5 flex flex-wrap gap-1 border-b border-frost">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={active === it.id}
          disabled={it.disabled}
          title={it.disabled ? 'disabled — enable it in “templates to include”' : undefined}
          onClick={() => onChange(it.id)}
          className={`unstyled border-b-2 bg-transparent px-4 py-2 text-[0.9em] font-medium transition-colors ${
            it.disabled
              ? 'cursor-not-allowed border-transparent text-mocha-light/40'
              : active === it.id
                ? 'cursor-pointer border-sapphire text-sapphire'
                : 'cursor-pointer border-transparent text-mocha hover:text-sapphire'
          }`}
        >
          {it.label}
        </button>
      ))}
    </nav>
  )
}

function TemplateTab({
  label,
  hint,
  value,
  onChange,
  rows,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  rows: number
}) {
  return (
    <div>
      <p className="muted my-2 text-[0.85em]">{hint}</p>
      <label>
        {label}
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-[0.88em] leading-[1.55]"
        />
      </label>
    </div>
  )
}

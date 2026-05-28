import { ApiClientError } from '@bazilion/client'
import type {
  Group,
  ProviderMessage,
  ReasoningLevel,
  ResolvedAgent,
  SessionHeadResponse,
  SkillInfo,
  TelegramBindResponse,
  TelegramConfigState,
  TelegramMirrorMode,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentTabs } from '../../../components/AgentTabs'
import { ChatPane } from '../../../components/ChatPane'
import { CopyButton } from '../../../components/CopyButton'
import { daemonClient } from '../../../lib/daemon-client'
import { REASONING_LEVELS } from '../../../lib/wire-constants'

interface ModelGroup {
  provider: string
  models: string[]
}

interface AvailableModelsResponse {
  groups: ModelGroup[]
}

interface AgentView {
  resolved: ResolvedAgent
  initialMessages: ProviderMessage[]
  sessionHead: SessionHeadResponse
  groups: Group[]
  skills: SkillInfo[]
  modelGroups: ModelGroup[]
  telegramConfigured: boolean
}

const fetchAgent = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<AgentView | null> => {
    const c = daemonClient()
    let resolved: ResolvedAgent
    try {
      resolved = await c.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [msgs, head, groups, skills, models, telegramConfig] = await Promise.all([
      c.get<{ messages: ProviderMessage[] }>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/messages`,
      ),
      c.get<SessionHeadResponse>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/head`,
      ),
      c.get<Group[]>('/api/groups'),
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
      groups,
      skills,
      modelGroups: models.groups,
      telegramConfigured: telegramConfig.configured,
    }
  })

export const Route = createFileRoute('/agents/$id/')({
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
    groups,
    skills,
    modelGroups,
    telegramConfigured,
  } = Route.useLoaderData()
  const router = useRouter()

  async function archive() {
    if (!confirm(`archive "${resolved.agent.name}"? (reversible)`)) return
    await fetch(`/api/agents/${resolved.agent.id}/archive`, { method: 'POST' })
    await router.invalidate()
  }
  async function unarchive() {
    await fetch(`/api/agents/${resolved.agent.id}/unarchive`, { method: 'POST' })
    await router.invalidate()
  }
  async function del() {
    const msg =
      `Permanently delete agent "${resolved.agent.name}"?\n\n` +
      `This removes the DB rows (messages, triggers, skill attachments) AND the agent's on-disk directory (memory, templates, state, sessions). This cannot be undone.`
    if (!confirm(msg)) return
    const res = await fetch(`/api/agents/${resolved.agent.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      window.location.assign('/agents')
    } else {
      alert(`failed: ${res.statusText}`)
    }
  }

  return (
    <div>
      <header className="mb-8">
        <h1>{resolved.agent.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Tag>
            <span className="px-1.5 font-mono text-[0.95em] text-mocha select-all">
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
            profile: <code className="ml-1 bg-transparent px-0">{resolved.profile.id}</code>
          </Tag>
          <Tag>
            group:{' '}
            <a
              href={`/groups/${encodeURIComponent(resolved.group.id)}`}
              className="ml-1 bg-transparent px-0 font-mono underline"
            >
              {resolved.group.id}
            </a>{' '}
            ·{' '}
            <a
              href={`/groups/${encodeURIComponent(resolved.group.id)}/memory`}
              className="ml-0.5 underline"
            >
              shared memory →
            </a>
          </Tag>
          <Tag>
            model: <code className="ml-1 bg-transparent px-0">{resolved.model}</code>
          </Tag>
          <Tag>
            reasoning:{' '}
            <code className="ml-1 bg-transparent px-0">{resolved.reasoningLevel}</code>
          </Tag>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {resolved.agent.status === 'archived' ? (
            <button type="button" onClick={unarchive} className="ghost-btn">
              unarchive
            </button>
          ) : (
            <button type="button" onClick={archive} className="ghost-btn">
              archive
            </button>
          )}
          <button
            type="button"
            onClick={del}
            className="ghost-btn border-[rgba(196,135,138,0.4)] text-[#9B3D3D] hover:bg-[rgba(196,135,138,0.08)]"
          >
            delete permanently
          </button>
        </div>

        <SettingsDetails
          agentId={resolved.agent.id}
          currentModelOverride={resolved.agent.modelOverride ?? null}
          profileDefaultModel={resolved.profile.defaultModel}
          currentReasoning={resolved.reasoningLevel}
          modelGroups={modelGroups}
        />
      </header>

      {resolved.agent.status === 'archived' && (
        <div className="mb-4 rounded-md border border-frost bg-fawn/35 px-4 py-2 text-[0.9em] text-chocolate">
          <strong className="text-[#7a4e2a]">This agent is archived.</strong> It's hidden from
          the default agent list; use <em>unarchive</em> above to bring it back, or{' '}
          <em>delete permanently</em> to remove its data entirely.
        </div>
      )}

      <AgentTabs
        agentId={resolved.agent.id}
        active="chat"
        archived={resolved.agent.status === 'archived'}
      />

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

      <section className="mt-10">
        <SectionTitle>Group</SectionTitle>
        <p className="text-[0.9em] text-mocha-light">
          Current group: <code>{resolved.group.id}</code> ({resolved.group.name}) —{' '}
          <code>{resolved.group.path}</code>.{' '}
          <a href={`/groups/${resolved.group.id}`}>view / edit USER.md</a>
        </p>
        <MoveGroupForm
          agentId={resolved.agent.id}
          currentGroupId={resolved.group.id}
          groups={groups}
        />
      </section>

      <section className="mt-10">
        <SectionTitle>Skills</SectionTitle>
        <SkillsTable
          agentId={resolved.agent.id}
          attached={new Set(resolved.skills)}
          all={skills}
        />
      </section>

      {telegramConfigured && (
        <section className="mt-10">
          <SectionTitle>Telegram</SectionTitle>
          <TelegramSection agent={resolved.agent} />
        </section>
      )}
    </div>
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
    <span className="inline-flex items-center gap-1 rounded-full border border-frost bg-ivory px-3 py-0.5 text-[0.84em] text-mocha-light">
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
    <details className="mt-3 text-[0.9em]">
      <summary className="cursor-pointer text-mocha-light">settings</summary>
      <form
        onSubmit={save}
        className="mt-2 flex flex-wrap items-end gap-3 border-t border-dashed border-frost py-3"
      >
        <label className="flex flex-col gap-1 text-[0.85em] text-mocha-light">
          model override
          <select
            name="modelOverride"
            value={modelOverride}
            onChange={(e) => setModelOverride(e.target.value)}
            className="min-w-[16rem] rounded-sm border border-frost bg-snow px-2 py-1.5"
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
        <label className="flex flex-col gap-1 text-[0.85em] text-mocha-light">
          reasoning level
          <select
            name="reasoningLevel"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value as ReasoningLevel)}
            className="min-w-[16rem] rounded-sm border border-frost bg-snow px-2 py-1.5"
          >
            {REASONING_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'saving…' : 'save'}
        </button>
        {savedFlash && <span className="text-[0.85em] text-[#3b7a3b]">saved ✓</span>}
        {error && <span className="text-[0.85em] text-[#9B3D3D]">{error}</span>}
      </form>
    </details>
  )
}

function MoveGroupForm({
  agentId,
  currentGroupId,
  groups,
}: {
  agentId: string
  currentGroupId: string
  groups: Group[]
}) {
  const router = useRouter()
  const [groupId, setGroupId] = useState(currentGroupId)
  const [moving, setMoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function move(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (groupId === currentGroupId) return
    setMoving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/group`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId }),
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
      <label className="flex flex-col gap-1 text-[0.85em] text-mocha-light">
        move to:
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="min-w-[18rem] rounded-sm border border-frost bg-snow px-2 py-1.5"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.id} — {g.path}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={moving || groupId === currentGroupId}>
        {moving ? 'moving…' : 'move'}
      </button>
      {err && <span className="text-[0.85em] text-[#9B3D3D]">{err}</span>}
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

  async function attach(name: string) {
    setPending(name)
    setErr(null)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill: name }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
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
    } finally {
      setPending(null)
    }
  }

  if (all.length === 0) {
    return <p className="text-[0.9em] text-mocha-light">no skills installed</p>
  }
  return (
    <>
      {err && <p className="mb-2 text-[0.85em] text-[#9B3D3D]">{err}</p>}
      <table>
        <thead>
          <tr>
            <th>name</th>
            <th>description</th>
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
                  {isAttached ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => detach(s.name)}
                    >
                      {busy ? '…' : 'detach'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => attach(s.name)}
                    >
                      {busy ? '…' : 'attach'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
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
    if (!confirm('Unbind this agent from its Telegram topic? The topic stays in Telegram as an orphan.'))
      return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agent.id)}/telegram/binding`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(res.statusText)
      await router.invalidate()
    } catch (e) {
      setError((e as Error).message)
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
    <div className="text-[0.9em]">
      <div className="mb-3 flex items-center gap-3">
        {isBound ? (
          <>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
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
            <button
              type="button"
              onClick={unbind}
              disabled={busy}
              className="ghost-btn border-[rgba(196,135,138,0.4)] text-[#9B3D3D] hover:bg-[rgba(196,135,138,0.08)]"
            >
              unbind
            </button>
          </>
        ) : (
          <>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
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

      <div className="flex items-center gap-2">
        <label htmlFor="mirror-mode" className="text-mocha-light">
          mirror mode:
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

      <div className="mt-2 flex items-center gap-2">
        <label htmlFor="topic-icon" className="text-mocha-light">
          topic icon:
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

      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}

      <p className="mt-3 text-[0.85em] text-mocha-light">
        When bound, every assistant turn for this agent gets mirrored to the topic. Typing in
        the topic triggers a new turn. iOS Telegram clients have a known limitation that
        prevents inline link deep-links from opening directly into a topic — bound state is
        still functional; navigate via the topic list manually.
      </p>
    </div>
  )
}

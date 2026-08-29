// Per-team shared memory: BM25-indexed markdown notes that every member
// agent reads from and writes to. Browse the list, search, edit/create
// entries. The qmd index lives at <team.path>/memory/ on disk.

import { ApiClientError } from '@bazilion/client'
import type { Agent, Team, MemoryEntry, MemoryHit } from '@bazilion/api-types'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageShell } from '../../../components/Page'
import { TeamTabs } from '../../../components/TeamTabs'
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard'
import { daemonClient } from '../../../lib/daemon-client'

interface MemoryView {
  team: Team
  memberCount: number
  entries: MemoryEntry[]
}

const fetchMemory = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<MemoryView | null> => {
    const c = daemonClient()
    let team: Team
    try {
      team = await c.get<Team>(`/api/teams/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [entries, agents] = await Promise.all([
      c.get<MemoryEntry[]>(`/api/teams/${encodeURIComponent(team.id)}/memory`),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
    ])
    const memberCount = agents.filter((a) => a.teamId === team.id).length
    return { team, memberCount, entries }
  })

export const Route = createFileRoute('/teams/$id/memory')({
  loader: async ({ params }) => {
    const data = await fetchMemory({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/teams' })
    return data
  },
  component: MemoryPage,
})

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

interface ListRow {
  key: string
  preview: string
  score?: number
}

type Mode = 'none' | 'edit' | 'new'

interface MemoryConfirmation {
  title: string
  description: React.ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}

function MemoryPage() {
  const { team, memberCount, entries: initialEntries } = Route.useLoaderData()
  const teamId = team.id

  const [rows, setRows] = useState<ListRow[]>(() =>
    initialEntries.map((e) => ({ key: e.key, preview: e.content.slice(0, 80) })),
  )
  const [isSearch, setIsSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('none')
  const [keyInput, setKeyInput] = useState('')
  const [content, setContent] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [status, setStatus] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null)
  const [confirmation, setConfirmation] = useState<MemoryConfirmation | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = mode !== 'none' && (keyInput !== savedKey || content !== savedContent)

  async function loadList(q: string) {
    try {
      const url =
        q.trim().length > 0
          ? `/api/teams/${encodeURIComponent(teamId)}/memory/search?q=${encodeURIComponent(q)}&limit=50`
          : `/api/teams/${encodeURIComponent(teamId)}/memory`
      const res = await fetch(url)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      const data = (await res.json()) as MemoryEntry[] | MemoryHit[]
      if (q.trim().length > 0) {
        setRows(
          (data as MemoryHit[]).map((h) => ({
            key: h.key,
            preview: h.snippet,
            score: h.score,
          })),
        )
        setIsSearch(true)
      } else {
        setRows(
          (data as MemoryEntry[]).map((e) => ({
            key: e.key,
            preview: e.content.slice(0, 80),
          })),
        )
        setIsSearch(false)
      }
    } catch (err) {
      setStatus({ msg: `error: ${(err as Error).message}`, kind: 'error' })
    }
  }

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      void loadList(query)
    }, 200)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function loadEntry(key: string) {
    setStatus({ msg: 'loading…', kind: 'info' })
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/memory/${encodeKey(key)}`,
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      const entry = (await res.json()) as MemoryEntry
      setSelectedKey(entry.key)
      setMode('edit')
      setKeyInput(entry.key)
      setContent(entry.content ?? '')
      setSavedKey(entry.key)
      setSavedContent(entry.content ?? '')
      setStatus({ msg: `loaded ${entry.key}`, kind: 'info' })
    } catch (err) {
      setStatus({ msg: `error: ${(err as Error).message}`, kind: 'error' })
    }
  }

  function requestOpenEntry(key: string) {
    if (mode === 'edit' && key === selectedKey) return
    if (!dirty) {
      void loadEntry(key)
      return
    }
    setConfirmation({
      title: 'Discard unsaved memory changes?',
      description: (
        <p>
          Opening <code className="font-mono">{key}</code> will permanently discard your changes
          to{' '}
          <code className="font-mono">{selectedKey ?? (keyInput || 'this new entry')}</code>.
        </p>
      ),
      confirmLabel: 'discard and open entry',
      onConfirm: () => loadEntry(key),
    })
  }

  function startNewEntry() {
    setSelectedKey(null)
    setMode('new')
    setKeyInput('')
    setContent('')
    setSavedKey('')
    setSavedContent('')
    setStatus({ msg: 'new entry — type a key and content, then save', kind: 'info' })
  }

  function requestNewEntry() {
    if (!dirty) {
      startNewEntry()
      return
    }
    setConfirmation({
      title: 'Discard unsaved memory changes?',
      description: (
        <p>
          Starting a new entry will permanently discard your changes to{' '}
          <code className="font-mono">{selectedKey ?? (keyInput || 'this new entry')}</code>.
        </p>
      ),
      confirmLabel: 'discard and create new',
      onConfirm: startNewEntry,
    })
  }

  async function save() {
    const key = keyInput.trim()
    if (!key) {
      setStatus({ msg: 'key is required', kind: 'error' })
      return
    }
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/memory/${encodeKey(key)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      setSelectedKey(key)
      setMode('edit')
      setKeyInput(key)
      setSavedKey(key)
      setSavedContent(content)
      setStatus({ msg: 'saved', kind: 'info' })
      await loadList(query)
    } catch (err) {
      setStatus({ msg: `error: ${(err as Error).message}`, kind: 'error' })
    }
  }

  async function deleteSelected() {
    if (!selectedKey) return
    const key = selectedKey
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/memory/${encodeKey(key)}`,
      { method: 'DELETE' },
    )
    if (!res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? res.statusText)
    }
    setSelectedKey(null)
    setMode('none')
    setKeyInput('')
    setContent('')
    setSavedKey('')
    setSavedContent('')
    setStatus({ msg: `${key} deleted`, kind: 'info' })
    await loadList(query)
  }

  function requestDelete() {
    if (!selectedKey) return
    const key = selectedKey
    setConfirmation({
      title: `Delete ${key}?`,
      description: (
        <p>
          This permanently deletes <code className="font-mono">{key}</code> from shared Team
          memory and removes it from search results for every Team member. This cannot be undone.
        </p>
      ),
      confirmLabel: 'delete memory entry',
      onConfirm: deleteSelected,
    })
  }

  const canSave = mode !== 'none' && keyInput.trim().length > 0
  const canDelete = mode === 'edit' && selectedKey !== null

  return (
    <PageShell>
      <UnsavedChangesGuard when={dirty} subject="Team memory draft" />
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-foreground">
          {team.name}{' '}
          <span className="text-muted-foreground text-base">/ Shared memory</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          BM25-indexed markdown notes shared by every agent in{' '}
          <a
            href={`/teams/${encodeURIComponent(team.id)}`}
            className="font-mono underline"
          >
            {team.id}
          </a>{' '}
          ({memberCount} member{memberCount === 1 ? '' : 's'}). Anything written here is
          visible to every member; per-agent notes belong in the agent's own{' '}
          <code className="font-mono">IDENTITY.md</code> via <code>home_write</code>.
        </p>
      </header>
      <TeamTabs teamId={team.id} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <div className="overflow-hidden rounded-[16px] border border-frost bg-snow">
            <div className="border-b border-frost p-2">
              <label htmlFor="team-memory-search" className="sr-only">
                Search Team memory
              </label>
              <input
                id="team-memory-search"
                type="text"
                placeholder="search (BM25)..."
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-mocha-light">no entries</div>
              ) : (
                rows.map((r) => {
                  const active = r.key === selectedKey
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => requestOpenEntry(r.key)}
                      className={`unstyled block w-full cursor-pointer border-b border-frost/50 px-3.5 py-2 text-left font-mono text-[0.84em] transition-colors last:border-b-0 hover:bg-sapphire-glow ${
                        active ? 'bg-sapphire-glow font-medium text-sapphire-deep' : ''
                      }`}
                    >
                      {isSearch && r.score !== undefined && (
                        <span className="float-right text-[0.75em] text-sapphire">
                          {r.score.toFixed(2)}
                        </span>
                      )}
                      {r.key}
                      {r.preview && (
                        <span className="mt-1 block text-[0.9em] font-normal text-mocha-light">
                          {r.preview}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
          <Button variant="ghost" className="mt-3 w-full" onClick={requestNewEntry}>
            + new entry
          </Button>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <label htmlFor="team-memory-key" className="sr-only">
              Memory entry key
            </label>
            <input
              id="team-memory-key"
              type="text"
              placeholder="key (e.g. prefs/hiking.md)"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={mode !== 'new'}
              className="flex-1 font-mono"
            />
          </div>
          <label htmlFor="team-memory-content" className="sr-only">
            Memory entry content
          </label>
          <textarea
            id="team-memory-content"
            placeholder="select an entry on the left, or create a new one."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={mode === 'none'}
            className="min-h-[360px] w-full font-mono text-[0.9em] leading-[1.55]"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={save} disabled={!canSave || !dirty}>
              save
            </Button>
            <Button variant="danger" onClick={requestDelete} disabled={!canDelete}>
              delete
            </Button>
          </div>
          {status && (
            <p
              role={status.kind === 'error' ? 'alert' : 'status'}
              className={`mt-2 text-[0.9em] ${
                status.kind === 'error' ? 'text-danger' : 'text-mocha-light'
              }`}
            >
              {status.msg}
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title ?? ''}
        description={confirmation?.description ?? null}
        confirmLabel={confirmation?.confirmLabel ?? 'continue'}
        onConfirm={() => confirmation?.onConfirm()}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      />
    </PageShell>
  )
}

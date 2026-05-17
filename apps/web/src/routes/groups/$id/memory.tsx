// Per-group shared memory: BM25-indexed markdown notes that every member
// agent reads from and writes to. Browse the list, search, edit/create
// entries. The qmd index lives at <group.path>/memory/ on disk.

import { ApiClientError } from '@bazilion/client'
import type { Agent, Group, MemoryEntry, MemoryHit } from '@bazilion/api-types'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import { daemonClient } from '../../../lib/daemon-client'

interface MemoryView {
  group: Group
  memberCount: number
  entries: MemoryEntry[]
}

const fetchMemory = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<MemoryView | null> => {
    const c = daemonClient()
    let group: Group
    try {
      group = await c.get<Group>(`/api/groups/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [entries, agents] = await Promise.all([
      c.get<MemoryEntry[]>(`/api/groups/${encodeURIComponent(group.id)}/memory`),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
    ])
    const memberCount = agents.filter((a) => a.groupId === group.id).length
    return { group, memberCount, entries }
  })

export const Route = createFileRoute('/groups/$id/memory')({
  loader: async ({ params }) => {
    const data = await fetchMemory({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/groups' })
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

function MemoryPage() {
  const { group, memberCount, entries: initialEntries } = Route.useLoaderData()
  const groupId = group.id

  const [rows, setRows] = useState<ListRow[]>(() =>
    initialEntries.map((e) => ({ key: e.key, preview: e.content.slice(0, 80) })),
  )
  const [isSearch, setIsSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('none')
  const [keyInput, setKeyInput] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function loadList(q: string) {
    try {
      const url =
        q.trim().length > 0
          ? `/api/groups/${encodeURIComponent(groupId)}/memory/search?q=${encodeURIComponent(q)}&limit=50`
          : `/api/groups/${encodeURIComponent(groupId)}/memory`
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

  async function openEntry(key: string) {
    setSelectedKey(key)
    setMode('edit')
    setStatus({ msg: 'loading…', kind: 'info' })
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/memory/${encodeKey(key)}`,
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? res.statusText)
      }
      const entry = (await res.json()) as MemoryEntry
      setKeyInput(entry.key)
      setContent(entry.content ?? '')
      setStatus({ msg: `loaded ${entry.key}`, kind: 'info' })
    } catch (err) {
      setStatus({ msg: `error: ${(err as Error).message}`, kind: 'error' })
    }
  }

  function newEntry() {
    setSelectedKey(null)
    setMode('new')
    setKeyInput('')
    setContent('')
    setStatus({ msg: 'new entry — type a key and content, then save', kind: 'info' })
  }

  async function save() {
    const key = keyInput.trim()
    if (!key) {
      setStatus({ msg: 'key is required', kind: 'error' })
      return
    }
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/memory/${encodeKey(key)}`,
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
      setStatus({ msg: 'saved', kind: 'info' })
      await loadList(query)
    } catch (err) {
      setStatus({ msg: `error: ${(err as Error).message}`, kind: 'error' })
    }
  }

  async function del() {
    if (!selectedKey) return
    if (!confirm(`delete ${selectedKey}?`)) return
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/memory/${encodeKey(selectedKey)}`,
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
      setStatus({ msg: 'deleted', kind: 'info' })
      await loadList(query)
    } catch (err) {
      setStatus({ msg: `error: ${(err as Error).message}`, kind: 'error' })
    }
  }

  const canSave = mode !== 'none' && keyInput.trim().length > 0
  const canDelete = mode === 'edit' && selectedKey !== null

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-foreground">
          {group.name}{' '}
          <span className="text-muted-foreground text-base">/ shared memory</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          BM25-indexed markdown notes shared by every agent in{' '}
          <a
            href={`/groups/${encodeURIComponent(group.id)}`}
            className="font-mono underline"
          >
            {group.id}
          </a>{' '}
          ({memberCount} member{memberCount === 1 ? '' : 's'}). Anything written here is
          visible to every member; per-agent notes belong in the agent's own{' '}
          <code className="font-mono">IDENTITY.md</code> via <code>home_write</code>.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <div className="overflow-hidden rounded-[16px] border border-frost bg-snow">
            <div className="border-b border-frost p-2">
              <input
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
                      onClick={() => openEntry(r.key)}
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
          <button type="button" className="ghost-btn mt-3 w-full" onClick={newEntry}>
            + new entry
          </button>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              placeholder="key (e.g. prefs/hiking.md)"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={mode !== 'new'}
              className="flex-1 font-mono"
            />
          </div>
          <textarea
            placeholder="select an entry on the left, or create a new one."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[360px] w-full font-mono text-[0.9em] leading-[1.55]"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={!canSave}
            >
              save
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={del}
              disabled={!canDelete}
            >
              delete
            </button>
          </div>
          {status && (
            <p
              className={`mt-2 text-[0.9em] ${
                status.kind === 'error' ? 'text-[#9B3D3D]' : 'text-mocha-light'
              }`}
            >
              {status.msg}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

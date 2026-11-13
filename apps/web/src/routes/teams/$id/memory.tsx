// The Team's shared memory: BM25-indexed markdown notes every member reads and writes (stored in
// <team>/memory/). List, search, open, edit, create and delete entries.

import type { MemoryEntry, MemoryHit } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const fetchMemory = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<MemoryEntry[]>(`/api/teams/${encodeURIComponent(data.id)}/memory`),
  )

export const Route = createFileRoute('/teams/$id/memory')({
  loader: ({ params }) => fetchMemory({ data: { id: params.id } }),
  component: MemoryPage,
})

interface ListRow {
  key: string
  preview: string
  score?: number
}

const toRow = (entry: MemoryEntry): ListRow => ({
  key: entry.key,
  preview: entry.content.slice(0, 80),
})

type Mode = 'none' | 'edit' | 'new'

interface Confirmation {
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}

function MemoryPage() {
  const initialEntries = Route.useLoaderData()
  const { id: teamId } = Route.useParams()
  const base = `/api/teams/${encodeURIComponent(teamId)}/memory`
  const entryPath = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`

  const [rows, setRows] = useState<ListRow[]>(() => initialEntries.map(toRow))
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('none')
  const [keyInput, setKeyInput] = useState('')
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState({ key: '', content: '' })
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const dirty = mode !== 'none' && (keyInput !== saved.key || content !== saved.content)

  async function loadList(text: string) {
    try {
      if (text.trim()) {
        const hits = await api<MemoryHit[]>(`${base}/search?q=${encodeURIComponent(text)}&limit=50`)
        setRows(hits.map((hit) => ({ key: hit.key, preview: hit.snippet, score: hit.score })))
        setSearching(true)
      } else {
        setRows((await api<MemoryEntry[]>(base)).map(toRow))
        setSearching(false)
      }
    } catch (cause) {
      setStatus({ message: errorMessage(cause), error: true })
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: search as the query changes.
  useEffect(() => {
    const timer = setTimeout(() => void loadList(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  function show(nextMode: Mode, key: string, text: string) {
    setMode(nextMode)
    setSelectedKey(nextMode === 'edit' ? key : null)
    setKeyInput(key)
    setContent(text)
    setSaved({ key, content: text })
  }

  async function open(key: string) {
    setStatus({ message: 'Loading…', error: false })
    try {
      const entry = await api<MemoryEntry>(entryPath(key))
      show('edit', entry.key, entry.content ?? '')
      setStatus(null)
    } catch (cause) {
      setStatus({ message: errorMessage(cause), error: true })
    }
  }

  /** Run `action`, first asking to discard unsaved changes. */
  function leaveDraft(action: () => void | Promise<void>, label: string) {
    if (!dirty) {
      void action()
      return
    }
    setConfirmation({
      title: 'Discard unsaved memory changes?',
      description: (
        <p>
          Your changes to{' '}
          <code className="font-mono">{selectedKey ?? (keyInput || 'the new entry')}</code> will be
          lost.
        </p>
      ),
      confirmLabel: label,
      onConfirm: action,
    })
  }

  async function save() {
    const key = keyInput.trim()
    try {
      await api(entryPath(key), { method: 'PUT', body: { content } })
      show('edit', key, content)
      setStatus({ message: 'Saved', error: false })
      await loadList(query)
    } catch (cause) {
      setStatus({ message: errorMessage(cause), error: true })
    }
  }

  async function remove(key: string) {
    await api(entryPath(key), { method: 'DELETE' })
    show('none', '', '')
    setStatus({ message: `${key} deleted`, error: false })
    await loadList(query)
  }

  return (
    <div className="space-y-6">
      <UnsavedChangesGuard when={dirty} subject="Team memory draft" />
      <p className="text-sm text-muted-foreground">
        Notes shared by every Agent in this Team and found by the memory search. Notes about one
        Agent belong in its own <code className="font-mono">IDENTITY.md</code> instead.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <div className="overflow-hidden rounded-[16px] border border-frost bg-snow">
            <div className="border-b border-frost p-2">
              <input
                aria-label="Search Team memory"
                type="search"
                placeholder="search (BM25)..."
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-mocha-light">no entries</div>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => {
                      if (mode !== 'edit' || row.key !== selectedKey) {
                        leaveDraft(() => open(row.key), 'Discard and open')
                      }
                    }}
                    className={`unstyled block w-full cursor-pointer border-b border-frost/50 px-3.5 py-2 text-left font-mono text-[0.84em] transition-colors last:border-b-0 hover:bg-sapphire-glow ${
                      row.key === selectedKey
                        ? 'bg-sapphire-glow font-medium text-sapphire-deep'
                        : ''
                    }`}
                  >
                    {searching && row.score !== undefined && (
                      <span className="float-right text-[0.75em] text-sapphire">
                        {row.score.toFixed(2)}
                      </span>
                    )}
                    {row.key}
                    {row.preview && (
                      <span className="mt-1 block text-[0.9em] font-normal text-mocha-light">
                        {row.preview}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            className="mt-3 w-full"
            onClick={() =>
              leaveDraft(() => {
                show('new', '', '')
                setStatus({
                  message: 'New entry: type a key and content, then save.',
                  error: false,
                })
              }, 'Discard and create new')
            }
          >
            + new entry
          </Button>
        </div>

        <div>
          <input
            aria-label="Memory entry key"
            type="text"
            placeholder="key (e.g. prefs/hiking.md)"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            disabled={mode !== 'new'}
            className="mb-3 font-mono"
          />
          <textarea
            aria-label="Memory entry content"
            placeholder="Select an entry on the left, or create a new one."
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={mode === 'none'}
            className="min-h-[360px] font-mono text-[0.9em] leading-[1.55]"
          />
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={mode === 'none' || !keyInput.trim() || !dirty}
            >
              Save
            </Button>
            <Button
              variant="danger"
              disabled={mode !== 'edit' || selectedKey === null}
              onClick={() => {
                const key = selectedKey
                if (!key) return
                setConfirmation({
                  title: `Delete ${key}?`,
                  description: (
                    <p>
                      This permanently deletes <code className="font-mono">{key}</code> from the
                      Team's shared memory and its search results.
                    </p>
                  ),
                  confirmLabel: 'Delete memory entry',
                  onConfirm: () => remove(key),
                })
              }}
            >
              Delete
            </Button>
          </div>
          {status && (
            <p
              role={status.error ? 'alert' : 'status'}
              className={`mt-2 text-[0.9em] ${status.error ? 'text-danger' : 'text-mocha-light'}`}
            >
              {status.message}
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title ?? ''}
        description={confirmation?.description ?? null}
        confirmLabel={confirmation?.confirmLabel ?? 'Continue'}
        onConfirm={() => confirmation?.onConfirm()}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      />
    </div>
  )
}

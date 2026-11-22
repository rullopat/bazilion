// The Team's shared memory: Markdown notes every member reads, writes and searches (stored in
// <team>/memory/). Notes are listed by their title and read formatted; Edit opens the text.

import type { MemoryEntry, MemoryHit, Team } from '@bazilion/api-types'
import { NotebookText, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { markdownPreview, markdownTitle } from '../../lib/markdown-text'
import { renderMd } from '../../lib/md'
import { useHydrated } from '../../lib/use-resource'
import { cn } from '../../lib/utils'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'
import { SaveBar, saveStatus, TextAreaField, TextField } from '../ui/form'
import {
  CARD_ROW,
  CardEmpty,
  CardForm,
  CardToolbar,
  Notice,
  RowMenu,
  SearchField,
  SetupCard,
} from '../ui/parts'

interface NoteRow {
  key: string
  title: string
  preview: string
}

/** A note's name in the list: its first heading, else the last part of its path. */
function noteRow(key: string, text: string): NoteRow {
  return {
    key,
    title: markdownTitle(text) ?? key.split('/').pop()?.replace(/\.md$/, '') ?? key,
    preview: markdownPreview(text, 110),
  }
}

type Open =
  | { mode: 'none' }
  | { mode: 'read'; key: string; content: string }
  | { mode: 'edit'; key: string; content: string; draft: string }
  | { mode: 'new'; key: string; draft: string }

export function TeamMemory({ team, openKey }: { team: Team; openKey?: string }) {
  const base = `/api/teams/${encodeURIComponent(team.id)}/memory`
  const entryPath = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
  const hydrated = useHydrated()

  const [rows, setRows] = useState<NoteRow[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Open>({ mode: 'none' })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const dirty =
    (open.mode === 'edit' && open.draft !== open.content) ||
    (open.mode === 'new' && (open.key.trim() !== '' || open.draft !== ''))
  const selectedKey = open.mode === 'read' || open.mode === 'edit' ? open.key : null

  async function loadList(text: string) {
    try {
      if (text.trim()) {
        const hits = await api<MemoryHit[]>(`${base}/search?q=${encodeURIComponent(text)}&limit=50`)
        setRows(hits.map((hit) => noteRow(hit.key, hit.snippet)))
        setSearching(true)
      } else {
        const entries = await api<MemoryEntry[]>(base)
        setRows(entries.map((entry) => noteRow(entry.key, entry.content)))
        setTotal(entries.length)
        setSearching(false)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: search as the query changes.
  useEffect(() => {
    const timer = setTimeout(() => void loadList(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  // A note picked in the Team tab opens with the sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for the note asked for.
  useEffect(() => {
    if (openKey) void read(openKey)
  }, [openKey])

  /** Do `action`, first asking whether to drop an unsaved edit. */
  function leave(action: () => void) {
    if (dirty) setPending(() => action)
    else action()
  }

  async function read(key: string) {
    setError(null)
    setSaved(false)
    setLoading(key)
    try {
      const entry = await api<MemoryEntry>(entryPath(key))
      setOpen({ mode: 'read', key: entry.key, content: entry.content ?? '' })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(null)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (open.mode !== 'edit' && open.mode !== 'new') return
    const key = open.key.trim()
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      await api(entryPath(key), { method: 'PUT', body: { content: open.draft } })
      setOpen({ mode: 'read', key, content: open.draft })
      setSaved(true)
      await loadList(query)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const current = open.mode === 'none' ? null : open
  const heading =
    current === null
      ? ''
      : current.mode === 'new'
        ? 'A new note'
        : noteRow(current.key, current.mode === 'edit' ? current.draft : current.content).title

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <UnsavedChangesGuard when={dirty} subject="note" />

      <SetupCard
        labelledBy="team-notes"
        icon={<NotebookText className="size-5" />}
        title="Notes"
        description={total === 1 ? '1 note' : `${total} notes`}
        action={
          <Button
            variant="ghost"
            onClick={() =>
              leave(() => {
                setSaved(false)
                setOpen({ mode: 'new', key: '', draft: '' })
              })
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            New note
          </Button>
        }
      >
        <CardToolbar>
          <SearchField
            label="Search the notes"
            placeholder="Search the notes"
            value={query}
            onChange={setQuery}
            className="flex-1"
          />
        </CardToolbar>
        {rows.length === 0 ? (
          <CardEmpty title={searching ? 'No note matches' : 'No notes yet'}>
            {searching
              ? 'Try another word.'
              : 'Agents keep here what the whole Team should remember; you can write notes too.'}
          </CardEmpty>
        ) : (
          <ul className="m-0 max-h-[56dvh] list-none overflow-y-auto p-0">
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  aria-current={row.key === selectedKey ? 'true' : undefined}
                  onClick={() => {
                    if (row.key !== selectedKey) leave(() => void read(row.key))
                  }}
                  className={cn(
                    CARD_ROW,
                    'unstyled block w-full py-2.5 text-left transition-colors hover:bg-accent/30',
                    row.key === selectedKey && 'bg-accent/50',
                  )}
                >
                  <span className="block w-full truncate text-sm font-semibold text-foreground">
                    {row.title}
                  </span>
                  <span className="block w-full truncate font-mono text-xs text-muted-foreground">
                    {row.key}
                  </span>
                  {row.preview && (
                    <span className="mt-0.5 line-clamp-2 block w-full text-sm text-muted-foreground">
                      {row.preview}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SetupCard>

      <section
        aria-label={heading || 'Note'}
        className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
      >
        {error && (
          <div className="px-4 pt-4 sm:px-5">
            <Notice role="alert" title="That did not work.">
              {error}
            </Notice>
          </div>
        )}
        {loading !== null ? (
          <p role="status" className="m-0 px-4 py-6 text-sm text-muted-foreground sm:px-5">
            Opening {loading}…
          </p>
        ) : current === null ? (
          <CardEmpty icon={<NotebookText className="size-5" />} title="Pick a note to read it">
            Or write a new one with New note.
          </CardEmpty>
        ) : current.mode === 'read' ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <h3 className="m-0 font-body text-lg font-semibold text-foreground">{heading}</h3>
                <span className="font-mono text-xs text-muted-foreground">{current.key}</span>
              </div>
              {saved && (
                <span role="status" className="text-sm font-medium text-success">
                  Saved.
                </span>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setSaved(false)
                  setOpen({ ...current, mode: 'edit', draft: current.content })
                }}
              >
                Edit
              </Button>
              <RowMenu
                label={`More for ${heading}`}
                items={[
                  { label: 'Delete…', danger: true, onSelect: () => setRemoving(current.key) },
                ]}
              />
            </div>
            <div
              className="md-content max-h-[60dvh] overflow-y-auto border-t border-border px-4 py-4 text-base leading-[1.6] text-chocolate sm:px-5"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
              dangerouslySetInnerHTML={{ __html: renderMd(current.content, hydrated) }}
            />
          </>
        ) : (
          <CardForm onSubmit={(event) => void save(event)} className="border-t-0">
            {current.mode === 'new' ? (
              <TextField
                label="Name"
                value={current.key}
                mono
                disabled={busy}
                placeholder="decisions/launch-date.md"
                hint="A path: folders group notes, such as people/sam.md."
                onChange={(value) => setOpen({ ...current, key: value })}
              />
            ) : (
              <div>
                <h3 className="m-0 font-body text-lg font-semibold text-foreground">{heading}</h3>
                <span className="font-mono text-xs text-muted-foreground">{current.key}</span>
              </div>
            )}
            <TextAreaField
              label="Text"
              value={current.draft}
              rows={14}
              mono
              disabled={busy}
              hint="Markdown. A first line such as “# Launch date” names the note."
              onChange={(value) => setOpen({ ...current, draft: value })}
            />
            <SaveBar
              busy={busy}
              disabled={!dirty || !current.key.trim()}
              status={saveStatus({ dirty, saved: false })}
              extra={
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    leave(() =>
                      current.mode === 'edit'
                        ? setOpen({ mode: 'read', key: current.key, content: current.content })
                        : setOpen({ mode: 'none' }),
                    )
                  }
                >
                  Cancel
                </Button>
              }
            />
          </CardForm>
        )}
      </section>

      <ConfirmDialog
        open={pending !== null}
        title="Drop your unsaved edit?"
        description={<p className="m-0">What you changed in this note is lost.</p>}
        confirmLabel="Drop the edit"
        onConfirm={() => {
          const action = pending
          setPending(null)
          action?.()
        }}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPending(null)
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Delete this note?"
        description={
          <p className="m-0">
            <code className="font-mono">{removing}</code> leaves the Team’s shared memory, and
            searches no longer find it.
          </p>
        }
        confirmLabel="Delete the note"
        onConfirm={async () => {
          if (!removing) return
          await api(entryPath(removing), { method: 'DELETE' })
          setOpen({ mode: 'none' })
          await loadList(query)
        }}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRemoving(null)
        }}
      />
    </div>
  )
}

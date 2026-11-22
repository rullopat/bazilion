// The cards of an Agent template's page: its settings, and its files.

import type {
  ChatModelEntry,
  LoadedProfile,
  ProfileTemplates,
  SkillInfo,
  SkillsMode,
} from '@bazilion/api-types'
import { FileCode2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Button } from '../Button'
import { ModelMenu } from '../ModelMenu'
import { SaveBar, saveStatus, TextField } from '../ui/form'
import { CardForm, CardToolbar, SetupCard } from '../ui/parts'
import { type FileKey, SkillsChoice, TEMPLATE_FILES } from './AgentTemplateParts'

const profilePath = (id: string) => `/api/profiles/${encodeURIComponent(id)}`

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((name) => b.has(name))
}

/** Name, default model and skills, saved together. */
export function TemplateSettingsCard({
  loaded,
  chat,
  skills,
  onDirtyChange,
  onSaved,
}: {
  loaded: LoadedProfile
  chat: readonly ChatModelEntry[]
  skills: readonly SkillInfo[]
  onDirtyChange: (dirty: boolean) => void
  /** Called after a save; resolves once the page has the new template. */
  onSaved: () => Promise<void>
}) {
  const { profile } = loaded
  const [stored, setStored] = useState(() => ({
    name: profile.name,
    model: profile.defaultModel,
    mode: profile.skillsMode,
    picked: new Set(loaded.defaultSkills),
  }))
  const [name, setName] = useState(stored.name)
  const [model, setModel] = useState(stored.model)
  const [mode, setMode] = useState<SkillsMode>(stored.mode)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(stored.picked))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty =
    name.trim() !== stored.name ||
    model !== stored.model ||
    mode !== stored.mode ||
    (mode === 'selected' && !sameSet(picked, stored.picked))
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const touched = () => {
    setSaved(false)
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || busy || !model) return
    setBusy(true)
    setError(null)
    try {
      const next = {
        name: name.trim(),
        model,
        mode,
        picked: mode === 'selected' ? new Set(picked) : new Set<string>(),
      }
      await api(profilePath(profile.id), {
        method: 'PATCH',
        body: {
          name: next.name,
          defaultModel: next.model,
          skillsMode: next.mode,
          defaultSkills: [...next.picked],
        },
      })
      setStored(next)
      setName(next.name)
      setPicked(new Set(next.picked))
      setSaved(true)
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="template-settings"
      icon={<SlidersHorizontal className="size-5" />}
      title="Settings"
      description="What it is called, the model its Agents answer with, and the skills they start with."
    >
      <CardForm onSubmit={save}>
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
          <TextField
            label="Name"
            value={name}
            disabled={busy}
            placeholder={profile.id}
            className="max-w-none"
            onChange={(value) => {
              touched()
              setName(value)
            }}
          />
          <ModelMenu
            kit
            label="Default model"
            value={model}
            models={chat}
            required
            onChange={(value) => {
              touched()
              setModel(value)
            }}
          />
        </div>
        <SkillsChoice
          mode={mode}
          picked={picked}
          skills={skills}
          disabled={busy}
          onModeChange={(value) => {
            touched()
            setMode(value)
          }}
          onPickedChange={(value) => {
            touched()
            setPicked(value)
          }}
        />
        <SaveBar
          busy={busy}
          disabled={!dirty || !model}
          status={saveStatus({
            error,
            dirty,
            saved,
            savedText: 'Saved. Agents spawned from now on get these.',
            footnote: 'Agents already spawned keep their own model and skills.',
          })}
        />
      </CardForm>
    </SetupCard>
  )
}

type Contents = Record<FileKey, string | null>

function contentsOf(files: LoadedProfile['files']): Contents {
  return {
    soul: files.soul,
    identity: files.identity,
    bootstrap: files.bootstrap,
    agents: files.agents,
    tools: files.tools,
  }
}

/** The template's files, one at a time, saved together. */
export function TemplateFilesCard({
  loaded,
  starter,
  onDirtyChange,
}: {
  loaded: LoadedProfile
  starter: ProfileTemplates
  onDirtyChange: (dirty: boolean) => void
}) {
  const id = loaded.profile.id
  const [stored, setStored] = useState<Contents>(() => contentsOf(loaded.files))
  const [draft, setDraft] = useState<Contents>(() => contentsOf(loaded.files))
  const [open, setOpen] = useState<FileKey>('soul')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const edited = TEMPLATE_FILES.filter((file) => draft[file.key] !== stored[file.key])
  const dirty = edited.length > 0
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const file = TEMPLATE_FILES.find((entry) => entry.key === open) ?? TEMPLATE_FILES[0]
  const content = file ? draft[file.key] : null

  function edit(key: FileKey, value: string) {
    setSaved(false)
    setError(null)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || busy) return
    setBusy(true)
    setError(null)
    // One request per file: those that were written stay written if a later one fails.
    const written: Partial<Contents> = {}
    try {
      for (const entry of edited) {
        const value = draft[entry.key]
        if (value === null) continue
        await api(`${profilePath(id)}/files/${encodeURIComponent(entry.name)}`, {
          method: 'PUT',
          body: { content: value },
        })
        written[entry.key] = value
      }
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setStored((current) => ({ ...current, ...written }))
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="template-files"
      icon={<FileCode2 className="size-5" />}
      title="Files"
      description="Each Agent spawned from this template gets its own copy of these, and may change it."
    >
      <CardToolbar>
        <div
          role="tablist"
          aria-label="Template files"
          className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1"
        >
          {TEMPLATE_FILES.map((entry) => {
            const selected = entry.key === open
            const absent = draft[entry.key] === null
            const changed = draft[entry.key] !== stored[entry.key]
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                id={`template-file-${entry.key}`}
                aria-selected={selected}
                aria-controls="template-file-panel"
                onClick={() => setOpen(entry.key)}
                className={cn(
                  'unstyled inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors sm:px-3',
                  selected
                    ? 'border-border bg-card text-foreground shadow-baziu-sm'
                    : 'border-transparent hover:bg-card/70 hover:text-foreground',
                  !selected && (absent ? 'text-muted-foreground/70' : 'text-muted-foreground'),
                )}
              >
                {entry.name}
                {changed && (
                  <span
                    className="size-1.5 rounded-full bg-warning"
                    role="img"
                    aria-label="not saved"
                  />
                )}
              </button>
            )
          })}
        </div>
      </CardToolbar>
      <div id="template-file-panel" role="tabpanel" aria-labelledby={`template-file-${open}`}>
        <CardForm onSubmit={save}>
          {file && content === null ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
              <p className="m-0 text-[0.95rem] font-semibold text-foreground">
                This template has no {file.name}
              </p>
              <p className="m-0 max-w-md text-sm text-muted-foreground">
                {file.hint} It starts from the built-in text and is saved with the other files.
              </p>
              <Button
                variant="ghost"
                className="mt-2"
                disabled={busy}
                onClick={() => edit(file.key, starter[file.key])}
              >
                Add {file.name}
              </Button>
            </div>
          ) : (
            file && (
              <>
                <p className="m-0 text-sm text-muted-foreground">{file.hint}</p>
                <textarea
                  aria-label={`${file.name} contents`}
                  value={content ?? ''}
                  disabled={busy}
                  spellCheck={false}
                  rows={22}
                  onChange={(event) => edit(file.key, event.target.value)}
                  className="min-h-[18rem] resize-y font-mono text-[0.85rem] leading-[1.6]"
                />
              </>
            )
          )}
          <SaveBar
            busy={busy}
            disabled={!dirty}
            label={edited.length > 1 ? `Save ${edited.length} files` : 'Save'}
            status={saveStatus({
              error,
              dirty,
              saved,
              savedText: 'Saved. Agents spawned from now on get these files.',
              footnote: 'Saving keeps every file you changed, not only the one in view.',
            })}
            extra={
              dirty && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDraft(stored)
                    setError(null)
                  }}
                >
                  Discard changes
                </Button>
              )
            }
          />
        </CardForm>
      </div>
    </SetupCard>
  )
}

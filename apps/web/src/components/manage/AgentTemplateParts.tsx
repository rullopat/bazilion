// What the Agent template pages share: the files a template has, the skills it attaches, and the
// dialog that creates one.

import type {
  ChatModelEntry,
  CreateProfileRequest,
  ProfileTemplates,
  SkillInfo,
  SkillsMode,
} from '@bazilion/api-types'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { slugify, slugProblem } from '../../lib/manage'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'
import { ModelMenu } from '../ModelMenu'
import { CheckboxRow, ChoiceCards, TextField } from '../ui/form'
import { Notice } from '../ui/parts'

export type FileKey = 'soul' | 'identity' | 'bootstrap' | 'agents' | 'tools'

export interface TemplateFile {
  key: FileKey
  name: string
  /** What the file is for, in a sentence. */
  hint: string
  /** A template may leave it out. */
  optional: boolean
}

export const TEMPLATE_FILES: readonly TemplateFile[] = [
  {
    key: 'soul',
    name: 'SOUL.md',
    hint: 'Persona, values and operating principles. Part of every session.',
    optional: false,
  },
  {
    key: 'identity',
    name: 'IDENTITY.md',
    hint: 'Name, creature, vibe, emoji and avatar: filled in during the first conversation.',
    optional: false,
  },
  {
    key: 'bootstrap',
    name: 'BOOTSTRAP.md',
    hint: 'The first-run ritual in which the Agent introduces itself; it retires the file once done.',
    optional: true,
  },
  {
    key: 'agents',
    name: 'AGENTS.md',
    hint: 'How the Agent works in its workspace: memory, red lines, who it hands work to.',
    optional: true,
  },
  {
    key: 'tools',
    name: 'TOOLS.md',
    hint: 'Notes on its tools and environment beyond the tool descriptions.',
    optional: true,
  },
]

const SKILL_MODES = [
  {
    value: 'all',
    label: 'All skills',
    hint: 'Every installed skill, including ones imported later.',
  },
  { value: 'selected', label: 'Chosen skills', hint: 'Only the ones ticked below.' },
] as const

/** Which skills a template attaches at spawn: all of them, or the ticked ones. */
export function SkillsChoice({
  mode,
  picked,
  skills,
  disabled,
  onModeChange,
  onPickedChange,
}: {
  mode: SkillsMode
  picked: ReadonlySet<string>
  skills: readonly SkillInfo[]
  disabled?: boolean
  onModeChange: (mode: SkillsMode) => void
  onPickedChange: (picked: Set<string>) => void
}) {
  return (
    <div className="grid gap-3">
      <ChoiceCards
        legend="Skills at spawn"
        name="template-skills"
        value={mode}
        options={SKILL_MODES}
        disabled={disabled}
        onChange={onModeChange}
      />
      {mode === 'selected' &&
        (skills.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            No skills are installed yet. Import some under <a href="/skills">Skills</a>.
          </p>
        ) : (
          <fieldset className="m-0 grid max-h-64 min-w-0 gap-2.5 overflow-y-auto rounded-xl border border-border bg-muted/30 p-3.5">
            <legend className="sr-only">Chosen skills</legend>
            {skills.map((skill) => (
              <CheckboxRow
                key={skill.name}
                checked={picked.has(skill.name)}
                disabled={disabled}
                label={
                  <span className="min-w-0">
                    <span className="font-mono text-[0.9em] font-semibold">{skill.name}</span>
                    {skill.description && (
                      <span className="text-muted-foreground"> · {skill.description}</span>
                    )}
                  </span>
                }
                onChange={(checked) => {
                  const next = new Set(picked)
                  if (checked) next.add(skill.name)
                  else next.delete(skill.name)
                  onPickedChange(next)
                }}
              />
            ))}
          </fieldset>
        ))}
      <p className="m-0 text-xs text-muted-foreground">
        Each Agent can still attach or detach skills after it is spawned.
      </p>
    </div>
  )
}

/** Create an Agent template from the starter files, then open it to edit them. */
export function CreateAgentTemplateDialog({
  chat,
  skills,
  starter,
  onClose,
}: {
  chat: readonly ChatModelEntry[]
  skills: readonly SkillInfo[]
  starter: ProfileTemplates
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [model, setModel] = useState('')
  const [mode, setMode] = useState<SkillsMode>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [optional, setOptional] = useState<Record<FileKey, boolean>>({
    soul: true,
    identity: true,
    bootstrap: true,
    agents: true,
    tools: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownId = idTouched ? id : slugify(name)
  const idProblem = slugProblem(shownId)
  const ready = shownId !== '' && !idProblem && model !== ''

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/profiles', {
        body: {
          id: shownId,
          name: name.trim() || undefined,
          defaultModel: model,
          skillsMode: mode,
          defaultSkills: mode === 'selected' ? [...picked] : [],
          soul: starter.soul,
          identity: starter.identity,
          // null leaves an optional file out.
          bootstrap: optional.bootstrap ? starter.bootstrap : null,
          agents: optional.agents ? starter.agents : null,
          tools: optional.tools ? starter.tools : null,
        } satisfies CreateProfileRequest,
      })
      await navigate({ to: '/templates/agents/$id', params: { id: shownId } })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="New Agent template"
      description="It starts from the built-in files, which you can edit next. Agents spawned from it get their own copies."
      busy={busy}
      onClose={onClose}
      className="max-w-xl"
    >
      <form onSubmit={(event) => void create(event)} className="grid gap-4">
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
          <TextField
            label="Name"
            value={name}
            disabled={busy}
            placeholder="Writer"
            className="max-w-none"
            onChange={setName}
          />
          <TextField
            label="ID"
            value={shownId}
            disabled={busy}
            placeholder="writer"
            mono
            className="max-w-none"
            problem={idProblem}
            onChange={(value) => {
              setIdTouched(true)
              setId(value)
            }}
          />
        </div>
        <ModelMenu
          kit
          label="Default model"
          value={model}
          onChange={setModel}
          models={chat}
          required
        />
        {chat.length === 0 && (
          <Notice tone="warning">
            No chat model is in use yet. Add one under <a href="/config">Setup → Models</a> first.
          </Notice>
        )}
        <SkillsChoice
          mode={mode}
          picked={picked}
          skills={skills}
          disabled={busy}
          onModeChange={setMode}
          onPickedChange={setPicked}
        />
        <fieldset className="m-0 grid min-w-0 gap-2.5 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold text-foreground">Files</legend>
          <p className="m-0 text-xs text-muted-foreground">
            SOUL.md and IDENTITY.md are always there. These three can be left out:
          </p>
          {TEMPLATE_FILES.filter((file) => file.optional).map((file) => (
            <CheckboxRow
              key={file.key}
              checked={optional[file.key]}
              disabled={busy}
              label={
                <span className="min-w-0">
                  <span className="font-mono text-[0.9em] font-semibold">{file.name}</span>
                  <span className="text-muted-foreground"> · {file.hint}</span>
                </span>
              }
              onChange={(checked) =>
                setOptional((current) => ({ ...current, [file.key]: checked }))
              }
            />
          ))}
        </fieldset>
        {error && (
          <Notice tone="warning" role="alert" title="The template was not created.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create and edit its files'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// A Team's settings that are set once and left: where its files are and how its commands run in
// Docker, the names of its Telegram topics, and a copy of the Team as a reusable template.

import type { Team, TeamTemplate } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { FolderOpen, LayoutTemplate, MessagesSquare } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { slugify, slugProblem } from '../../lib/manage'
import { Button } from '../Button'
import { CodingDefaultsCard } from '../CodingDefaultsCard'
import { CopyButton } from '../CopyButton'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'
import { SaveBar, saveStatus, TextField } from '../ui/form'
import { CardForm, Fact, Facts, SetupCard } from '../ui/parts'

export function TeamSettings({ team, sampleAgent }: { team: Team; sampleAgent: string }) {
  return (
    <div className="grid gap-5">
      <SetupCard
        labelledBy="team-workspace"
        icon={<FolderOpen className="size-5" />}
        title="Workspace"
        description="Where this Team’s Agents read and write files."
      >
        <Facts>
          <Fact label="Folder">
            <span className="flex min-w-0 items-center gap-1.5">
              <code className="min-w-0 break-all font-mono text-sm">{team.path}</code>
              <CopyButton value={team.path} ariaLabel="Copy the folder" title="Copy the folder" />
            </span>
          </Fact>
        </Facts>
        <CodingDefaultsCard teamId={team.id} />
      </SetupCard>
      <TopicNames team={team} sampleAgent={sampleAgent} />
      <SaveAsTemplate team={team} />
    </div>
  )
}

function TopicNames({ team, sampleAgent }: { team: Team; sampleAgent: string }) {
  const router = useRouter()
  const [format, setFormat] = useState(team.telegramTopicNameFormat ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const trimmed = format.trim()
  const dirty = (team.telegramTopicNameFormat ?? '') !== format
  const problem =
    trimmed && !trimmed.includes('{agent.name}')
      ? 'Put {agent.name} in it, so each member’s topic has its own name.'
      : undefined
  const preview = trimmed
    ? trimmed
        .replaceAll('{agent.name}', sampleAgent)
        .replaceAll('{team.name}', team.name)
        .replaceAll('{team.slug}', team.id)
    : team.id === 'default'
      ? sampleAgent
      : `${team.id} › ${sampleAgent}`

  async function save(clear: boolean) {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/teams/${encodeURIComponent(team.id)}/topic-format`, {
        method: 'PUT',
        body: { format: clear ? null : format },
      })
      if (clear) setFormat('')
      await router.invalidate({ sync: true })
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="team-topic-names"
      icon={<MessagesSquare className="size-5" />}
      title="Telegram topic names"
      description="What each member’s forum topic is called in the Telegram group."
    >
      <UnsavedChangesGuard when={dirty} subject="topic name changes" />
      <CardForm
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void save(false)
        }}
      >
        <TextField
          label="Topic name"
          value={format}
          mono
          disabled={busy}
          placeholder="{team.name} / {agent.name}"
          problem={problem}
          hint={
            <>
              Empty: the built-in name. Use <code>{'{agent.name}'}</code>,{' '}
              <code>{'{team.name}'}</code> and <code>{'{team.slug}'}</code>. Saving renames the
              topics you have not renamed in Telegram yourself.
            </>
          }
          onChange={(value) => {
            setFormat(value)
            setSaved(false)
          }}
        />
        <p className="m-0 text-sm text-muted-foreground">
          {sampleAgent}’s topic would read{' '}
          <span className="font-semibold text-foreground">{preview}</span>.
        </p>
        <SaveBar
          busy={busy}
          disabled={!dirty || trimmed.length === 0 || Boolean(problem)}
          status={saveStatus({ error, dirty, saved })}
          extra={
            team.telegramTopicNameFormat && (
              <Button variant="ghost" onClick={() => void save(true)} disabled={busy}>
                Use the built-in name
              </Button>
            )
          }
        />
      </CardForm>
    </SetupCard>
  )
}

function SaveAsTemplate({ team }: { team: Team }) {
  const [name, setName] = useState(`${team.name} template`)
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownId = idTouched ? id : slugify(name)
  const idProblem = shownId ? slugProblem(shownId) : null

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const template = await api<TeamTemplate>(
        `/api/teams/${encodeURIComponent(team.id)}/policy/save-as-template`,
        { body: { id: shownId, name: name.trim() } },
      )
      window.location.assign(`/templates/teams/${encodeURIComponent(template.id)}`)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="team-save-template"
      icon={<LayoutTemplate className="size-5" />}
      title="Save as a Team template"
      description="Its members, who may message whom, and USER.md, ready to start another Team."
    >
      <CardForm onSubmit={(event) => void save(event)}>
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
          <TextField
            label="Template name"
            value={name}
            disabled={busy}
            className="max-w-none"
            onChange={setName}
          />
          <TextField
            label="ID"
            value={shownId}
            mono
            disabled={busy}
            className="max-w-none"
            hint="Used in commands; it cannot change later."
            problem={idProblem ?? undefined}
            onChange={(value) => {
              setIdTouched(true)
              setId(value)
            }}
          />
        </div>
        <SaveBar
          busy={busy}
          disabled={!name.trim() || !shownId || Boolean(idProblem)}
          label="Save as a template"
          busyLabel="Saving…"
          status={saveStatus({ error, dirty: false, saved: false })}
        />
      </CardForm>
    </SetupCard>
  )
}

// A Team's settings that are set once and left: the sandbox defaults for its commands, the names
// of its Telegram topics, and a copy of the Team as a reusable template.

import type { Team, TeamTemplate } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { Save } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { CodingDefaultsCard } from '../CodingDefaultsCard'
import { CopyButton } from '../CopyButton'
import { SectionCard } from '../Page'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'

export function TeamSettings({ team, sampleAgent }: { team: Team; sampleAgent: string }) {
  return (
    <div className="space-y-4">
      <SectionCard title="Workspace" description="Where this Team's Agents read and write files.">
        <p className="m-0 flex min-w-0 items-center gap-1.5 text-sm">
          <code className="min-w-0 break-all">{team.path}</code>
          <CopyButton value={team.path} ariaLabel="Copy the workspace path" title="Copy the path" />
        </p>
        <div className="mt-4">
          <CodingDefaultsCard teamId={team.id} />
        </div>
      </SectionCard>
      <TopicNames team={team} sampleAgent={sampleAgent} />
      <SaveAsTemplate teamId={team.id} />
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
    <SectionCard
      title="Telegram topic names"
      description={
        <>
          The title of each member's Telegram forum topic; leave empty for the built-in naming.
          Tokens: <code>{'{agent.name}'}</code> (required), <code>{'{team.name}'}</code>,{' '}
          <code>{'{team.slug}'}</code>. Saving renames the existing topics you have not renamed in
          Telegram.
        </>
      }
    >
      <UnsavedChangesGuard when={dirty} subject="topic name changes" />
      <input
        aria-label="Telegram topic name format"
        value={format}
        onChange={(event) => {
          setFormat(event.target.value)
          setSaved(false)
        }}
        placeholder="{team.name} / {agent.name}"
        className="font-mono text-sm"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Preview: <span className="font-mono text-foreground">{preview}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void save(false)}
          disabled={busy || !dirty || trimmed.length === 0}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {team.telegramTopicNameFormat && (
          <Button variant="ghost" onClick={() => void save(true)} disabled={busy}>
            Clear
          </Button>
        )}
        {saved && !dirty && (
          <span role="status" className="text-xs text-success">
            Saved
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </SectionCard>
  )
}

function SaveAsTemplate({ teamId }: { teamId: string }) {
  const [templateId, setTemplateId] = useState(`${teamId}-template`)
  const [name, setName] = useState(`${teamId} template`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const template = await api<TeamTemplate>(
        `/api/teams/${encodeURIComponent(teamId)}/policy/save-as-template`,
        { body: { id: templateId.trim(), name: name.trim() } },
      )
      window.location.assign(`/templates/teams/${encodeURIComponent(template.id)}`)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Save as Team template"
      description="Copies the members, their connections, the mode and USER.md into a reusable template."
    >
      <div className="grid items-end gap-x-3 sm:grid-cols-[1fr_1fr_auto]">
        <label>
          Template ID
          <input value={templateId} onChange={(event) => setTemplateId(event.target.value)} />
        </label>
        <label>
          Template name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <Button
          variant="primary"
          className="mb-[0.6rem]"
          disabled={busy || !templateId.trim() || !name.trim()}
          onClick={() => void save()}
        >
          <Save className="size-4" aria-hidden="true" />
          Save template
        </Button>
      </div>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
    </SectionCard>
  )
}

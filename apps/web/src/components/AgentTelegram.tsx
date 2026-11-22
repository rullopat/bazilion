// An Agent's Telegram forum topic: open or make it, what of its work shows there, and its icon.

import type { Agent, TelegramBindResponse, TelegramMirrorMode } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { MessagesSquare } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { SaveBar, SelectField, saveStatus, TextField } from './ui/form'
import { CardForm, Chip, Fact, Facts, Notice, RowMenu, SetupCard } from './ui/parts'

const MIRROR: readonly { value: TelegramMirrorMode; label: string }[] = [
  { value: 'minimal', label: 'Its replies' },
  { value: 'verbose', label: 'Its replies and every tool it uses' },
]

export function AgentTelegram({ agent }: { agent: Agent }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMode, setMirrorMode] = useState<TelegramMirrorMode>(agent.telegramMirrorMode)
  const [iconEmoji, setIconEmoji] = useState(agent.telegramIconEmoji ?? '')
  const [iconSaved, setIconSaved] = useState(false)
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  const path = `/api/agents/${encodeURIComponent(agent.id)}`
  const bound = agent.telegramTopicId !== null
  const iconDirty = iconEmoji !== (agent.telegramIconEmoji ?? '')

  async function run(request: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await request()
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  async function bind() {
    await run(async () => {
      const { deepLink } = await api<TelegramBindResponse>(`${path}/telegram/bind`, {
        method: 'POST',
      })
      // Opens the topic in Telegram desktop and Android; iOS shows the topic list.
      window.open(deepLink, '_blank', 'noopener')
    }).catch(() => {})
  }

  async function saveMirrorMode(next: TelegramMirrorMode) {
    setMirrorMode(next)
    await run(() => api(path, { method: 'PATCH', body: { telegramMirrorMode: next } })).catch(() =>
      setMirrorMode(agent.telegramMirrorMode),
    )
  }

  async function saveIcon(event: FormEvent) {
    event.preventDefault()
    await run(() =>
      api(path, { method: 'PATCH', body: { telegramIconEmoji: iconEmoji.trim() || null } }),
    )
      .then(() => setIconSaved(true))
      .catch(() => {})
  }

  return (
    <SetupCard
      labelledBy="agent-telegram"
      icon={<MessagesSquare className="size-5" />}
      title="Telegram topic"
      description={`${agent.name}’s own topic in the Telegram group: its turns show there, and a message there starts one.`}
      action={
        <div className="flex items-center gap-2">
          {bound ? <Chip tone="success">Has a topic</Chip> : <Chip tone="neutral">No topic</Chip>}
          {bound && (
            <RowMenu
              label={`More for ${agent.name}’s topic`}
              disabled={busy}
              items={[{ label: 'Unbind…', danger: true, onSelect: () => setConfirmUnbind(true) }]}
            />
          )}
        </div>
      }
    >
      {error && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <Notice role="alert" title="That did not work.">
            {error}
          </Notice>
        </div>
      )}
      <Facts>
        <Fact label="Topic">
          <span className="flex flex-wrap items-center gap-3">
            <span>{bound ? `Topic ${agent.telegramTopicId}` : 'None yet'}</span>
            <Button variant="ghost" onClick={() => void bind()} disabled={busy}>
              {bound ? 'Open in Telegram' : busy ? 'Making it…' : 'Make its topic'}
            </Button>
          </span>
        </Fact>
      </Facts>
      <CardForm onSubmit={(event) => void saveIcon(event)}>
        <SelectField<TelegramMirrorMode>
          label="What shows in the topic"
          value={mirrorMode}
          options={MIRROR}
          disabled={busy}
          hint="Changed at once."
          onChange={(value) => void saveMirrorMode(value)}
        />
        <TextField
          label="Topic icon"
          value={iconEmoji}
          disabled={busy}
          placeholder="🦉"
          hint="An emoji; empty takes the template’s."
          className="max-w-40"
          onChange={(value) => {
            setIconEmoji(value.slice(0, 8))
            setIconSaved(false)
          }}
        />
        <SaveBar
          busy={busy}
          disabled={!iconDirty}
          label="Save the icon"
          status={saveStatus({
            dirty: iconDirty,
            saved: iconSaved,
            footnote: 'On iOS, Telegram opens the list of topics rather than the topic.',
          })}
        />
      </CardForm>
      <ConfirmDialog
        open={confirmUnbind}
        onOpenChange={setConfirmUnbind}
        title={`Unbind ${agent.name} from its topic?`}
        description={
          <p className="m-0">
            Its turns stop showing in the topic, and messages there no longer reach it. The topic
            stays in Telegram until you delete it there.
          </p>
        }
        confirmLabel="Unbind the topic"
        onConfirm={() => run(() => api(`${path}/telegram/binding`, { method: 'DELETE' }))}
      />
    </SetupCard>
  )
}

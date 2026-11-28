// Telegram notices for new Attention items: on or off, which kinds, and quiet hours.

import type { AttentionRecordedKind, NotificationSettingsResponse } from '@bazilion/api-types'
import { BellRing } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import {
  type NotificationsDraft,
  notificationsBody,
  notificationsDraft,
  notificationsState,
  sameNotifications,
} from '../../lib/telegram-setup'
import { CheckboxRow, Problem, SaveBar, SwitchRow, saveStatus, TextField } from '../ui/form'
import { CardBody, CardForm, Chip, Notice, SetupCard, Waiting } from '../ui/parts'

const KINDS: Record<AttentionRecordedKind, string> = {
  trigger_failure: 'Scheduled trigger failures',
  agent_loop_break: 'Agents going round in circles',
  queue_interrupted: 'Queues paused after restart',
  turn_failure: 'Failed background turns',
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function NotificationsCard({
  settings,
  error,
  onSaved,
}: {
  /** Undefined until the daemon has answered. */
  settings: NotificationSettingsResponse | undefined
  /** Why the settings could not be loaded. */
  error: string | null
  /** Called after a save; resolves once the page has the new settings. */
  onSaved: () => Promise<void>
}) {
  const [saves, setSaves] = useState(0)
  const state = notificationsState(settings)
  return (
    <SetupCard
      labelledBy="telegram-notifications"
      icon={<BellRing className="size-5" />}
      title="Attention notifications"
      description="Posts each new Attention item of the kinds you choose to the bot’s service topic, once. Items that were already open when you switch this on are not sent."
      action={state && <Chip tone={state.tone}>{state.label}</Chip>}
    >
      {settings ? (
        <NotificationsForm
          // A saved form starts again from what is stored now.
          key={saves}
          settings={settings}
          justSaved={saves > 0}
          onSaved={async () => {
            await onSaved()
            setSaves((count) => count + 1)
          }}
        />
      ) : (
        <CardBody>
          {error ? (
            <Notice tone="warning" role="alert" title="The settings could not be loaded.">
              {error}
            </Notice>
          ) : (
            <Waiting>Loading…</Waiting>
          )}
        </CardBody>
      )}
    </SetupCard>
  )
}

function NotificationsForm({
  settings,
  justSaved,
  onSaved,
}: {
  settings: NotificationSettingsResponse
  justSaved: boolean
  onSaved: () => Promise<void>
}) {
  const [stored] = useState(() => notificationsDraft(settings, browserZone()))
  const [draft, setDraft] = useState<NotificationsDraft>(stored)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const dirty = !sameNotifications(stored, draft)
  const noKinds = draft.kinds.length === 0
  const noZone = draft.quiet && draft.timezone.trim() === ''

  const edit = (change: Partial<NotificationsDraft>) => {
    setTouched(true)
    setError(null)
    setDraft((current) => ({ ...current, ...change }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || noKinds || noZone || busy) return
    setBusy(true)
    setError(null)
    try {
      await api<NotificationSettingsResponse>('/api/notifications', {
        method: 'PUT',
        body: notificationsBody(draft),
      })
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardForm onSubmit={save}>
      {!settings.telegramReady && (
        <Notice tone="neutral">
          The bot is not running yet; notices go out once it is connected and activated.
        </Notice>
      )}
      <SwitchRow
        label="Send Attention notifications to Telegram"
        checked={draft.enabled}
        disabled={busy}
        onChange={(enabled) => edit({ enabled })}
      />
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={busy}>
        <legend className="mb-2 p-0 text-sm font-semibold text-foreground">Kinds</legend>
        <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {(Object.keys(KINDS) as AttentionRecordedKind[]).map((kind) => (
            <CheckboxRow
              key={kind}
              label={KINDS[kind]}
              checked={draft.kinds.includes(kind)}
              onChange={(checked) =>
                edit({
                  kinds: checked
                    ? [...draft.kinds, kind]
                    : draft.kinds.filter((value) => value !== kind),
                })
              }
            />
          ))}
        </div>
        {noKinds && <Problem>Choose at least one kind.</Problem>}
      </fieldset>
      <SwitchRow
        label="Quiet hours"
        description="Notices wait until they end."
        checked={draft.quiet}
        disabled={busy}
        onChange={(quiet) => edit({ quiet })}
      />
      {draft.quiet && (
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-[8.5rem_8.5rem_minmax(0,18rem)]">
          <TextField
            label="From"
            type="time"
            value={draft.start}
            disabled={busy}
            required
            onChange={(start) => edit({ start })}
          />
          <TextField
            label="To"
            type="time"
            value={draft.end}
            disabled={busy}
            required
            onChange={(end) => edit({ end })}
          />
          <TextField
            label="Timezone"
            value={draft.timezone}
            disabled={busy}
            required
            placeholder="Europe/Warsaw"
            problem={noZone ? 'Quiet hours need a timezone.' : undefined}
            onChange={(timezone) => edit({ timezone })}
          />
        </div>
      )}
      <SaveBar
        busy={busy}
        disabled={!dirty || noKinds || noZone}
        status={saveStatus({ error, dirty, saved: justSaved && !touched })}
      />
    </CardForm>
  )
}

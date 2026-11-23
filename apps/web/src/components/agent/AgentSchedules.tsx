// An Agent's schedules: messages it gets at set times, as if the operator had written them, and
// what happened the last times they ran. Times are this computer's, where the daemon runs.

import type {
  Agent,
  AgentTrigger,
  ListTriggersResponse,
  TriggerDispatch,
} from '@bazilion/api-types'
import { CalendarClock, History, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import type { Tone } from '../../lib/model-facts'
import {
  describeSchedule,
  EMPTY_SCHEDULE,
  REPEATS,
  type Repeat,
  type ScheduleDraft,
  type ScheduleField,
  scheduleRequest,
  WEEKDAYS,
} from '../../lib/schedules'
import { useHydrated, useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Dialog } from '../Dialog'
import { SelectField, TextAreaField, TextField } from '../ui/form'
import { CardEmpty, CardList, Chip, ListRow, Notice, RowMenu, SetupCard, Switch } from '../ui/parts'

export function AgentSchedules({ agent }: { agent: Agent }) {
  const path = `/api/agents/${encodeURIComponent(agent.id)}/triggers`
  const data = useResource((signal) => api<ListTriggersResponse>(path, { signal }), [path])
  if (!data.data) {
    return data.error ? (
      <Notice role="alert" title="The schedules could not be loaded.">
        {data.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the schedules…
      </p>
    )
  }
  return (
    <SchedulesView
      agentId={agent.id}
      agentName={agent.name}
      {...data.data}
      onChanged={data.reload}
    />
  )
}

/** "Next run in 5 min", "Next run Mon 24 Nov, 09:00": when a schedule runs next, in words. */
export function nextRunWords(at: number, now: number): string {
  const wait = at - now
  if (wait < 60_000) return 'Next run now'
  if (wait < 3_600_000) return `Next run in ${Math.round(wait / 60_000)} min`
  return `Next run ${new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

const RUN: Record<TriggerDispatch['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for the Agent', tone: 'neutral' },
  running: { label: 'Running', tone: 'success' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

/** The schedules and their recent runs, as loaded. */
export function SchedulesView({
  agentId,
  agentName = 'The Agent',
  triggers,
  dispatches,
  nextRuns,
  schedulerOff,
  onChanged,
}: ListTriggersResponse & {
  agentId: string
  agentName?: string
  onChanged: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<AgentTrigger | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Dates are written in the browser's own format, which the server cannot know.
  const hydrated = useHydrated()
  const when = (at: number) => (hydrated ? new Date(at).toLocaleString() : '')
  const byId = new Map(triggers.map((trigger) => [trigger.id, trigger]))

  async function toggle(trigger: AgentTrigger) {
    setBusyId(trigger.id)
    setError(null)
    try {
      await api(`/api/triggers/${encodeURIComponent(trigger.id)}`, {
        method: 'PATCH',
        body: { enabled: !trigger.enabled },
      })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid gap-5">
      <SetupCard
        labelledBy="agent-schedules"
        icon={<CalendarClock className="size-5" />}
        title="Schedules"
        description={`Each one sends ${agentName} its message at the times it says.`}
        action={
          triggers.length > 0 && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add a schedule
            </Button>
          )
        }
      >
        {error && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <Notice role="alert" title="That did not work.">
              {error}
            </Notice>
          </div>
        )}
        {schedulerOff && triggers.length > 0 && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <Notice title="No schedule runs on this daemon">
              It was started with <code>BAZILION_SCHEDULER=off</code>.
            </Notice>
          </div>
        )}
        {triggers.length === 0 ? (
          <CardEmpty
            icon={<CalendarClock className="size-5" />}
            title="No schedules yet"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add a schedule
              </Button>
            }
          >
            A schedule gives {agentName} a message at set times: a morning check, a weekly summary.
          </CardEmpty>
        ) : (
          <CardList>
            {triggers.map((trigger) => {
              const schedule = describeSchedule(trigger)
              return (
                <ListRow
                  key={trigger.id}
                  inline
                  title={
                    schedule.raw ? (
                      <code className="font-mono text-[0.92em]">{schedule.text}</code>
                    ) : (
                      schedule.text
                    )
                  }
                  chip={
                    trigger.enabled ? (
                      <Chip tone="success">On</Chip>
                    ) : (
                      <Chip tone="neutral">Paused</Chip>
                    )
                  }
                  meta={
                    <>
                      {hydrated && typeof nextRuns[trigger.id] === 'number' && (
                        <span>{nextRunWords(nextRuns[trigger.id] as number, Date.now())}</span>
                      )}
                      <span>
                        {trigger.lastFiredAt
                          ? `Last ran ${when(trigger.lastFiredAt)}`
                          : 'Has not run yet'}
                      </span>
                    </>
                  }
                  actions={
                    <>
                      <Switch
                        label={`${schedule.text}: ${trigger.enabled ? 'on' : 'paused'}`}
                        checked={trigger.enabled}
                        disabled={busyId === trigger.id}
                        onChange={() => void toggle(trigger)}
                      />
                      <RowMenu
                        label={`More for ${schedule.text}`}
                        items={[
                          {
                            label: 'Delete…',
                            danger: true,
                            onSelect: () => setRemoving(trigger),
                          },
                        ]}
                      />
                    </>
                  }
                >
                  <p className="m-0 whitespace-pre-wrap break-words rounded-xl bg-muted/50 px-3 py-2 text-sm text-foreground">
                    {trigger.message}
                  </p>
                </ListRow>
              )
            })}
          </CardList>
        )}
      </SetupCard>

      <SetupCard
        labelledBy="agent-schedule-runs"
        icon={<History className="size-5" />}
        title="Recent runs"
        description="Each time a schedule came due, and how it went."
      >
        {dispatches.length === 0 ? (
          <CardEmpty title="Nothing has run yet">
            A schedule's first run shows here once its time comes.
          </CardEmpty>
        ) : (
          <CardList>
            {dispatches.map((dispatch) => {
              const run = RUN[dispatch.status]
              const trigger = byId.get(dispatch.triggerId)
              return (
                <ListRow
                  key={dispatch.id}
                  inline
                  title={when(dispatch.scheduledAt) || '…'}
                  chip={<Chip tone={run.tone}>{run.label}</Chip>}
                  meta={
                    <span>{trigger ? describeSchedule(trigger).text : 'A deleted schedule'}</span>
                  }
                >
                  {dispatch.error && (
                    <p className="m-0 break-words text-sm text-danger">{dispatch.error}</p>
                  )}
                </ListRow>
              )
            })}
          </CardList>
        )}
      </SetupCard>

      {adding && (
        <AddSchedule
          agentId={agentId}
          agentName={agentName}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false)
            await onChanged()
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Delete this schedule?"
        description={
          <p className="m-0">
            {removing ? describeSchedule(removing).text : 'The schedule'} stops, and its run history
            goes with it. {agentName} and its conversations stay.
          </p>
        }
        confirmLabel="Delete the schedule"
        onConfirm={async () => {
          if (!removing) return
          await api(`/api/triggers/${encodeURIComponent(removing.id)}`, { method: 'DELETE' })
          await onChanged()
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      />
    </div>
  )
}

function AddSchedule({
  agentId,
  agentName,
  onClose,
  onAdded,
}: {
  agentId: string
  agentName: string
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY_SCHEDULE)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <Key extends keyof ScheduleDraft>(key: Key, value: ScheduleDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setError(null)
  }
  const built = scheduleRequest(draft)
  // The schedule in words as soon as it is valid, before the message is written.
  const timing = scheduleRequest({ ...draft, message: draft.message.trim() || '…' })
  const preview = timing.request ? describeSchedule(timing.request) : null
  const problemOf = (field: ScheduleField) =>
    tried && built.field === field ? built.problem : undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!built.request) return
    setBusy(true)
    try {
      await api(`/api/agents/${encodeURIComponent(agentId)}/triggers`, { body: built.request })
      await onAdded()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Add a schedule"
      description={`${agentName} gets the message at these times, as if you had written it.`}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4">
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
          <SelectField<Repeat>
            label="Repeat"
            value={draft.repeat}
            options={REPEATS}
            disabled={busy}
            onChange={(value) => set('repeat', value)}
            className="max-w-none"
          />
          {draft.repeat === 'minutes' && (
            <TextField
              label="Every how many minutes"
              value={draft.minutes}
              inputMode="numeric"
              disabled={busy}
              problem={problemOf('minutes')}
              className="max-w-none"
              onChange={(value) => set('minutes', value.replace(/\D/g, ''))}
            />
          )}
          {(draft.repeat === 'daily' || draft.repeat === 'weekdays') && (
            <TextField
              label="At"
              type="time"
              value={draft.time}
              problem={problemOf('time')}
              disabled={busy}
              className="max-w-none"
              onChange={(value) => set('time', value)}
            />
          )}
          {draft.repeat === 'cron' && (
            <TextField
              label="Cron expression"
              value={draft.cron}
              problem={problemOf('cron')}
              mono
              placeholder="*/15 9-17 * * 1-5"
              disabled={busy}
              className="max-w-none"
              hint="Minute, hour, day of the month, month, day of the week."
              onChange={(value) => set('cron', value)}
            />
          )}
        </div>
        {draft.repeat === 'weekly' && (
          <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
            <SelectField
              label="On"
              value={draft.day}
              options={WEEKDAYS}
              disabled={busy}
              onChange={(value) => set('day', value)}
              className="max-w-none"
            />
            <TextField
              label="At"
              type="time"
              value={draft.time}
              problem={problemOf('time')}
              disabled={busy}
              className="max-w-none"
              onChange={(value) => set('time', value)}
            />
          </div>
        )}
        <TextAreaField
          label="Message"
          value={draft.message}
          rows={3}
          disabled={busy}
          placeholder="Morning check: what is blocked, what ships today?"
          problem={problemOf('message')}
          onChange={(value) => set('message', value)}
        />
        {preview && (
          <p className="m-0 text-sm text-muted-foreground">
            {preview.raw ? (
              <>
                {agentName} gets it when <code>{preview.text}</code> matches, on this computer's
                clock.
              </>
            ) : (
              <>
                {agentName} gets it: {preview.text.charAt(0).toLowerCase() + preview.text.slice(1)},
                on this computer's clock.
              </>
            )}
          </p>
        )}
        {error && (
          <Notice role="alert" title="The schedule was not added.">
            {error}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add the schedule'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

import type { AttentionKind, NotificationSettingsResponse } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'

const kinds: Record<AttentionKind, string> = {
  lesson_proposal: 'Lesson proposals',
  review_failure: 'Review failures',
  trigger_failure: 'Scheduled trigger failures',
  agent_loop_break: 'Agent message loop breaks',
  queue_interrupted: 'Queues paused after restart',
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Telegram notices for new Attention items: on/off, kinds, quiet hours. */
export function NotificationSettings() {
  const [state, setState] = useState<NotificationSettingsResponse | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [selected, setSelected] = useState<AttentionKind[]>([])
  const [timezone, setTimezone] = useState('UTC')
  const [quiet, setQuiet] = useState(false)
  const [start, setStart] = useState('22:00')
  const [end, setEnd] = useState('07:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function show(value: NotificationSettingsResponse) {
    setState(value)
    setEnabled(value.enabled)
    setSelected(value.kinds)
    // A never-saved home reports UTC; the browser's zone is the better default.
    setTimezone(value.enabled || value.quietHours ? value.timezone : browserTimezone())
    setQuiet(value.quietHours !== null)
    setStart(value.quietHours?.start ?? '22:00')
    setEnd(value.quietHours?.end ?? '07:00')
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: show only calls state setters.
  useEffect(() => {
    api<NotificationSettingsResponse>('/api/notifications')
      .then(show)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      show(
        await api<NotificationSettingsResponse>('/api/notifications', {
          method: 'PUT',
          body: { enabled, kinds: selected, timezone, quietHours: quiet ? { start, end } : null },
        }),
      )
      setNotice('Saved.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="card"
      style={{ marginTop: '1.5rem', padding: '1.25rem', minWidth: 0 }}
      aria-labelledby="notification-title"
    >
      <h2 id="notification-title">Attention notifications</h2>
      <p className="muted">
        Posts each new Attention item of the selected kinds to the bot&apos;s service topic, once.
        Items that were already open when you switch this on are not sent.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        !error && <p>Loading notification settings…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {!state.telegramReady && (
            <p className="muted">
              The bot is not running yet; notices go out once it is connected and activated.
            </p>
          )}
          <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
            <label style={{ display: 'block', marginBlock: '.75rem' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />{' '}
              Send Attention notifications to Telegram
            </label>
            <fieldset style={{ marginBlock: '1rem', minWidth: 0 }}>
              <legend>Kinds</legend>
              {(Object.keys(kinds) as AttentionKind[]).map((kind) => (
                <label key={kind} style={{ display: 'block', marginBlock: '.5rem' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(kind)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, kind]
                          : selected.filter((value) => value !== kind),
                      )
                    }
                  />{' '}
                  {kinds[kind]}
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'block', marginBlock: '.75rem' }}>
              <input
                type="checkbox"
                checked={quiet}
                onChange={(event) => setQuiet(event.target.checked)}
              />{' '}
              Quiet hours (notices wait until they end)
            </label>
            {quiet && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
                <label>
                  From{' '}
                  <input
                    type="time"
                    value={start}
                    required
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <label>
                  To{' '}
                  <input
                    type="time"
                    value={end}
                    required
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
                <label style={{ display: 'grid', gap: '.35rem', minWidth: 0 }}>
                  Timezone
                  <input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="Europe/Warsaw"
                    required
                    style={{ maxWidth: '100%', minWidth: 0 }}
                  />
                </label>
              </div>
            )}
            <div style={{ marginTop: '1rem' }}>
              <Button variant="primary" type="submit" disabled={!selected.length}>
                Save
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}

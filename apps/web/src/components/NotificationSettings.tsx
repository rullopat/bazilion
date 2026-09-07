import type {
  AttentionKind,
  NotificationPreview,
  NotificationReceipt,
  NotificationReceiptList,
  NotificationSettingsResponse,
} from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

const kinds: Record<AttentionKind, string> = {
  communication_approval: 'Communication approvals',
  lesson_proposal: 'Lesson proposals',
  review_failure: 'Review failures',
  trigger_failure: 'Scheduled trigger failures',
  agent_loop_break: 'Agent message loop breaks',
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/notifications${path}`, {
    method,
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? 'Notification request failed')
  return value as T
}
export function NotificationSettings() {
  const [state, setState] = useState<NotificationSettingsResponse | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [destination, setDestination] = useState('')
  const [selected, setSelected] = useState<AttentionKind[]>([])
  const [timezone, setTimezone] = useState('UTC')
  const [quiet, setQuiet] = useState(false)
  const [start, setStart] = useState('22:00')
  const [end, setEnd] = useState('07:00')
  const [page, setPage] = useState<NotificationReceiptList>({ receipts: [], nextCursor: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<NotificationPreview | null>(null)
  const [retry, setRetry] = useState<NotificationReceipt | null>(null)
  async function refresh() {
    const [value, receipts] = await Promise.all([
      request<NotificationSettingsResponse>(''),
      request<NotificationReceiptList>('/receipts'),
    ])
    setState(value)
    setPage(receipts)
    setEnabled(value.settings.enabled)
    setDestination(value.settings.destination?.id ?? '')
    setSelected(value.settings.kinds)
    setTimezone(value.settings.timezone)
    setQuiet(value.settings.quietHours !== null)
    setStart(value.settings.quietHours?.start ?? '22:00')
    setEnd(value.settings.quietHours?.end ?? '07:00')
  }
  useEffect(() => {
    void refresh().catch((error) => setError(String(error.message)))
  }, [])
  async function action(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Notification request failed')
    } finally {
      setBusy(false)
    }
  }
  async function save(includeOpenPreview?: string) {
    if (!state) return
    await request('', 'PUT', {
      expectedRevision: state.settings.revision,
      enabled,
      destinationId: destination || undefined,
      kinds: selected,
      timezone,
      quietHours: quiet ? { start, end } : null,
      includeOpenPreview,
    })
    await refresh()
    setPreview(null)
    setNotice('Notification settings saved. Delivery does not resolve Attention items.')
  }
  return (
    <section
      className="card"
      style={{ marginTop: '1.5rem', padding: '1.25rem', minWidth: 0 }}
      aria-labelledby="notification-title"
    >
      <h2 id="notification-title">Attention notifications</h2>
      <p className="muted">
        Optional Telegram notices for items that need your attention. New enablement sends future
        items only. Agent-topic error mirrors may also report the same failure.
      </p>
      {error && <p role="alert">{error}. Refresh settings before retrying a conflicting change.</p>}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        <p>Loading notification settings…</p>
      ) : (
        <>
          {state.settings.restorePaused && (
            <p role="status">
              Paused after restore. Telegram may have newer messages than this backup. Re-enable for
              future items, or explicitly preview old open items with possible duplicates.
            </p>
          )}
          {!state.readiness.ready && (
            <p>
              Destination unavailable. Configure and pair the private Telegram forum, start the bot,
              then refresh.
            </p>
          )}
          {state.diagnostic && <p role="status">Delivery status: {state.diagnostic}</p>}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void action(() => save())
            }}
          >
            <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
              <label style={{ display: 'block', marginBlock: '.75rem' }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />{' '}
                Enable Attention notifications
              </label>
              <label style={{ display: 'grid', gap: '.35rem', marginBlock: '.75rem' }}>
                Destination
                <select
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  required={enabled}
                  style={{ maxWidth: '100%' }}
                >
                  <option value="">Choose the paired service topic</option>
                  {state.readiness.destination && (
                    <option value={state.readiness.destination.id}>
                      Chat {state.readiness.destination.chatId}, service topic{' '}
                      {state.readiness.destination.topicId}
                    </option>
                  )}
                  {state.settings.destination &&
                    state.settings.destination.id !== state.readiness.destination?.id && (
                      <option value={state.settings.destination.id}>
                        Previous destination (unavailable)
                      </option>
                    )}
                </select>
              </label>
              <fieldset style={{ marginBlock: '1rem', minWidth: 0 }}>
                <legend>Include these Attention kinds</legend>
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
              <label style={{ display: 'grid', gap: '.35rem' }}>
                Timezone (IANA)
                <input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="Europe/Warsaw"
                  required
                  style={{ maxWidth: '100%', minWidth: 0 }}
                />
              </label>
              <label style={{ display: 'block', marginBlock: '.75rem' }}>
                <input
                  type="checkbox"
                  checked={quiet}
                  onChange={(event) => setQuiet(event.target.checked)}
                />{' '}
                Use quiet hours for all selected kinds
              </label>
              {quiet && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                  <label>
                    Start{' '}
                    <input
                      type="time"
                      value={start}
                      required
                      onChange={(event) => setStart(event.target.value)}
                    />
                  </label>
                  <label>
                    End{' '}
                    <input
                      type="time"
                      value={end}
                      required
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  </label>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '1rem' }}>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    !selected.length || (enabled && (!state.readiness.ready || !destination))
                  }
                >
                  Save settings
                </Button>
                <Button
                  variant="ghost"
                  disabled={!enabled || !state.readiness.ready || !destination || !selected.length}
                  onClick={() =>
                    void action(async () =>
                      setPreview(
                        await request<NotificationPreview>('/preview', 'POST', { kinds: selected }),
                      ),
                    )
                  }
                >
                  Preview open items
                </Button>
              </div>
            </fieldset>
          </form>
          <h3 style={{ marginTop: '1.5rem' }}>Delivery receipts</h3>
          <p className="muted">
            A confirmed delivery is a Telegram receipt, not an approval or acknowledgement.
            Uncertain sends need an explicit retry that may duplicate a message.
          </p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void action(async () => setPage(await request<NotificationReceiptList>('/receipts')))
            }
          >
            Refresh receipts
          </Button>
          {page.receipts.length === 0 && <p>No notification receipts yet.</p>}
          <ul style={{ paddingLeft: '1.2rem' }}>
            {page.receipts.map((item) => (
              <li key={item.id} style={{ marginBlock: '.85rem', overflowWrap: 'anywhere' }}>
                <strong>{kinds[item.sourceKind]}</strong> — {item.state}
                <div>Source {item.sourceId}</div>
                <div>Receipt {item.id}</div>
                <div>
                  {new Date(item.updatedAt).toLocaleString()} · {item.attempts} attempts
                  {item.telegramMessageId ? ` · Telegram message ${item.telegramMessageId}` : ''}
                </div>
                {item.diagnostic && <div>{item.diagnostic}</div>}
                {['failed', 'uncertain'].includes(item.state) && (
                  <Button
                    variant="ghost"
                    disabled={busy || !state.settings.enabled || state.settings.restorePaused}
                    onClick={() => setRetry(item)}
                  >
                    Retry notice
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {page.nextCursor && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const more = await request<NotificationReceiptList>(
                    `/receipts?cursor=${encodeURIComponent(page.nextCursor!)}`,
                  )
                  setPage({
                    receipts: [...page.receipts, ...more.receipts],
                    nextCursor: more.nextCursor,
                  })
                })
              }
            >
              More receipts
            </Button>
          )}
        </>
      )}
      <Button variant="ghost" disabled={busy} onClick={() => void action(refresh)}>
        Refresh settings and destination
      </Button>
      <ConfirmDialog
        open={preview !== null}
        title="Include currently open items?"
        confirmLabel="Save and include preview"
        confirmVariant="primary"
        description={
          <p>
            {preview?.count ?? 0} currently eligible items will be considered. Resolved items are
            omitted.{' '}
            {preview?.possibleDuplicates
              ? 'This restored backup may be missing later Telegram receipts, so duplicate messages are possible.'
              : 'Confirmed deliveries will not be repeated.'}
          </p>
        }
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        onConfirm={() => save(preview?.id)}
      />
      <ConfirmDialog
        open={retry !== null}
        title="Retry this notification?"
        confirmLabel="Retry, allowing a possible duplicate"
        confirmVariant="primary"
        description="Telegram may already have received this notice. Retry only if you accept a possible duplicate. The source, destination and policy will be checked again."
        onOpenChange={(open) => {
          if (!open) setRetry(null)
        }}
        onConfirm={async () => {
          if (!retry) return
          await request(`/receipts/${encodeURIComponent(retry.id)}/retry`, 'POST', {
            expectedUpdatedAt: retry.updatedAt,
            acknowledgePossibleDuplicate: true,
          })
          setPage(await request<NotificationReceiptList>('/receipts'))
          setRetry(null)
        }}
      />
    </section>
  )
}

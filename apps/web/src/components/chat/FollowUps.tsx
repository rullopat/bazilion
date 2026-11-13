import type { UserQueueListResponse } from '@bazilion/api-types'
import { useState } from 'react'
import { type ApiInit, api, errorMessage } from '../../lib/api'
import { Button } from '../Button'

/** Follow-ups waiting for the Agent's current turn. Hidden while there are none. */
export function FollowUps({
  agentId,
  queue,
  onChanged,
  onViewConversation,
}: {
  agentId: string
  queue: UserQueueListResponse | null
  onChanged: () => void
  onViewConversation: (id: string) => void
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!queue || (queue.items.length === 0 && !queue.paused)) return null
  const base = `/api/agents/${encodeURIComponent(agentId)}/queue`

  async function act(path: string, init: ApiInit) {
    setBusy(true)
    setError('')
    try {
      await api(`${base}${path}`, init)
      setEditing(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const pending = queue.items.some((item) => item.status === 'pending')
  return (
    <section
      aria-label="Follow-up queue"
      className="max-h-[35%] min-w-0 shrink-0 space-y-3 overflow-y-auto border-t border-frost px-5 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Follow-ups{queue.paused ? ' · paused' : ''}</strong>
        {(queue.paused || pending) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act('/control', { body: { paused: !queue.paused } })}
          >
            {queue.paused ? 'Resume queue' : 'Pause queue'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 break-words text-danger">
          {error}
        </p>
      )}
      {queue.items.map((item) => (
        <article
          key={item.id}
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-frost bg-ivory p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="rounded-full bg-frost px-2 py-0.5 text-xs capitalize">
              {item.status}
            </strong>
            <span className="text-xs text-mocha">
              {item.source === 'telegram' ? 'Telegram' : 'Web / API'}
            </span>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => onViewConversation(item.conversationId)}
            >
              View conversation
            </Button>
          </div>
          {editing?.id === item.id ? (
            <form
              className="flex min-w-0 flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void act(`/${encodeURIComponent(item.id)}`, {
                  method: 'PATCH',
                  body: { message: editing.text },
                })
              }}
            >
              <textarea
                aria-label="Edit follow-up"
                rows={3}
                className="w-full resize-y"
                value={editing.text}
                onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" type="submit" disabled={busy}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <p className="m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {item.text}
            </p>
          )}
          {item.attachments.map((file, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a follow-up's attachments never change.
            <p key={index} className="m-0 break-all text-xs text-mocha">
              {file.name ?? 'Attachment'} · {file.byteLength} bytes
            </p>
          ))}
          {item.diagnostic && <p className="m-0 break-words">{item.diagnostic}</p>}
          {item.status !== 'running' && editing?.id !== item.id && (
            <div className="flex flex-wrap gap-2">
              {item.status === 'pending' && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditing({ id: item.id, text: item.text })}
                >
                  Edit
                </Button>
              )}
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void act(`/${encodeURIComponent(item.id)}`, { method: 'DELETE' })}
              >
                Remove
              </Button>
            </div>
          )}
        </article>
      ))}
    </section>
  )
}

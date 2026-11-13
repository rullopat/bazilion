import type { Conversation, ConversationListResponse, ProviderMessage } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { ReadOnlyTranscript } from './Transcript'

const PAGE = 20

/** One earlier conversation; `messages` is null when its history cannot be read. */
interface Opened {
  conversation: Conversation | null
  messages: ProviderMessage[] | null
}

/** An Agent's conversations: start a new one, read and rename earlier ones (read-only). */
export function ConversationLibrary({
  agentId,
  turnBusy,
  onCreated,
  initialConversationId,
}: {
  agentId: string
  turnBusy: boolean
  onCreated: () => Promise<void>
  initialConversationId?: string
}) {
  const base = `/api/agents/${encodeURIComponent(agentId)}/conversations`
  const [library, setLibrary] = useState<ConversationListResponse | null>(null)
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [selectedId, setSelectedId] = useState(initialConversationId ?? null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the reload signal.
  useEffect(() => {
    const controller = new AbortController()
    setLibrary(null)
    api<ConversationListResponse>(`${base}?limit=${PAGE}&offset=${offset}`, {
      signal: controller.signal,
    })
      .then(setLibrary)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [base, offset, refresh])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    setOpened(null)
    api<Required<Opened>>(`${base}/${encodeURIComponent(selectedId)}`, {
      signal: controller.signal,
    })
      .then((body) => {
        setOpened(body)
        setTitle(body.conversation?.title ?? '')
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        // An unreadable history still names its conversation, which can be renamed.
        const conversation =
          cause instanceof ApiError
            ? ((cause.body as { conversation?: Conversation }).conversation ?? null)
            : null
        setOpened({ conversation, messages: null })
        setTitle(conversation?.title ?? '')
      })
    return () => controller.abort()
  }, [base, selectedId])

  async function run<T>(request: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    setError('')
    try {
      return await request()
    } catch (cause) {
      setError(errorMessage(cause))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if ((await run(() => api(base, { body: {} }))) === null) return
    setSelectedId(null)
    setOffset(0)
    setRefresh((value) => value + 1)
    await onCreated()
  }

  async function rename() {
    if (!selectedId) return
    const body = await run(() =>
      api<{ conversation: Conversation }>(`${base}/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        body: { title },
      }),
    )
    if (!body) return
    setOpened((current) => current && { ...current, conversation: body.conversation })
    setRefresh((value) => value + 1)
  }

  return (
    <section
      aria-live="off"
      className="mx-5 mt-2 max-h-[45%] min-w-0 shrink-0 space-y-4 overflow-y-auto rounded-lg border border-fawn bg-ivory p-4"
      aria-label="Conversation library"
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="m-0 text-lg">Conversations</h2>
        <Button
          variant="primary"
          disabled={!library || busy || turnBusy}
          onClick={() => void create()}
        >
          New conversation
        </Button>
      </div>
      <p className="m-0 text-sm">
        A new conversation starts with an empty history. Earlier ones and their saved files stay
        here to read; messages always go to the active conversation.
      </p>
      {turnBusy && (
        <p role="status">Wait for the current turn to finish before starting a new conversation.</p>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError('')
              setRefresh((value) => value + 1)
            }}
          >
            Refresh
          </Button>
        </p>
      )}
      {!library ? (
        <p role="status">Loading conversations…</p>
      ) : (
        <>
          {library.total === 0 && <p>No conversations yet.</p>}
          <ul className="mt-4 grid list-none gap-2 p-0">
            {library.conversations.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-col items-start gap-3 rounded border border-fawn p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.title}</span>
                  {item.id === library.selectedId && (
                    <strong className="shrink-0 rounded-full bg-frost px-2 py-0.5 text-xs">
                      Active
                    </strong>
                  )}
                </span>
                <Button
                  variant="ghost"
                  className="max-w-full whitespace-normal break-words text-left sm:max-w-[50%]"
                  disabled={busy}
                  aria-pressed={selectedId === item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  View {item.title}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              disabled={busy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              disabled={busy || offset + library.conversations.length >= library.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Next
            </Button>
            <span className="text-sm">{library.total} conversations</span>
          </div>
        </>
      )}
      {selectedId && (
        <section className="space-y-4 border-t border-fawn pt-4" aria-label="Earlier conversation">
          {opened === null ? (
            <p role="status">Loading history…</p>
          ) : (
            <>
              <div className="grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <label className="col-span-2 m-0 grid min-w-0 gap-2 sm:col-span-1">
                  Conversation title
                  <input
                    className="h-11"
                    value={title}
                    maxLength={200}
                    disabled={!opened.conversation}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <Button
                  variant="ghost"
                  className="h-11"
                  disabled={busy || !opened.conversation || !title.trim()}
                  onClick={() => void rename()}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  className="h-11"
                  disabled={busy}
                  onClick={() => setSelectedId(null)}
                >
                  Close history
                </Button>
              </div>
              {opened.messages === null ? (
                <p role="alert">
                  This conversation history is unavailable. You can still start a new conversation.
                </p>
              ) : opened.messages.length > 0 ? (
                <ReadOnlyTranscript messages={opened.messages} />
              ) : (
                <p>This conversation is empty.</p>
              )}
            </>
          )}
        </section>
      )}
    </section>
  )
}

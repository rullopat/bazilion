// An earlier conversation of the Agent, to read. Messages still go to the active one until the
// operator continues this one.

import type { Conversation, ProviderMessage } from '@bazilion/api-types'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { type ReactNode, useRef, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { useFindInTranscript } from '../../lib/find-in-transcript'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { CHAT_FRAME } from '../chat/ChatPane'
import { ReadOnlyTranscript } from '../chat/Transcript'
import { useWorkspace } from './context'

interface Opened {
  conversation: Conversation | null
  /** Null when the history cannot be read. */
  messages: ProviderMessage[] | null
}

export function EarlierConversation({
  agentId,
  agentName,
  conversationId,
  header,
}: {
  agentId: string
  agentName: string
  conversationId: string
  header: ReactNode
}) {
  const { search, to } = useWorkspace()
  const router = useRouter()
  const navigate = useNavigate()
  const logRef = useRef<HTMLDivElement | null>(null)
  useFindInTranscript(logRef, search.find, () => {
    void navigate({ to: '/', search: to({ find: undefined }), replace: true })
  })
  const path = `/api/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationId)}`
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const opened = useResource<Opened>(
    async (signal) => {
      try {
        return await api<Opened>(path, { signal })
      } catch (cause) {
        // An unreadable history still names its conversation.
        if (cause instanceof ApiError && cause.status === 409) {
          const body = cause.body as { conversation?: Conversation }
          return { conversation: body.conversation ?? null, messages: null }
        }
        throw cause
      }
    },
    [path],
  )

  async function continueHere() {
    setBusy(true)
    setError('')
    try {
      await api(`${path}/select`, { method: 'POST' })
      // Load the page's data again first, and wait for it: the chat that opens next starts from
      // it, and it must start from this conversation, now the active one.
      await router.invalidate({ sync: true })
      await router.navigate({ to: '/', search: to({ conversation: undefined }) })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  const title = opened.data?.conversation?.title
  return (
    <section aria-label={`An earlier conversation with ${agentName}`} className={CHAT_FRAME}>
      {header}
      <div className="flex flex-wrap items-center gap-2 border-b border-frost bg-muted px-4 py-2 text-sm">
        <span className="min-w-0 flex-1 basis-56 text-mocha">
          You are reading{' '}
          {title ? <strong className="text-foreground">{title}</strong> : 'an earlier conversation'}
          . New messages go to the active conversation.
        </span>
        <Button
          variant="primary"
          className="min-h-9"
          disabled={busy || !opened.data?.messages}
          onClick={() => void continueHere()}
        >
          {busy ? 'Switching…' : 'Continue this conversation'}
        </Button>
        <Link to="/" search={to({ conversation: undefined })} className="ghost-btn min-h-9">
          Back to the active one
        </Link>
      </div>
      {error && (
        <p role="alert" className="m-0 px-5 pt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[50rem]">
          {opened.error && (
            <p role="alert" className="text-sm text-danger">
              {opened.error}
            </p>
          )}
          {!opened.data && !opened.error && (
            <p role="status" className="text-sm text-mocha">
              Loading the conversation…
            </p>
          )}
          {opened.data &&
            (opened.data.messages === null ? (
              <p role="alert" className="text-sm">
                This conversation's history is unavailable, so it cannot be read or continued.
              </p>
            ) : opened.data.messages.length > 0 ? (
              <ReadOnlyTranscript messages={opened.data.messages} />
            ) : (
              <p className="py-12 text-center italic text-mocha-light">
                This conversation is empty.
              </p>
            ))}
        </div>
      </div>
    </section>
  )
}

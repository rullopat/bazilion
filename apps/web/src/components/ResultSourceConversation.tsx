import type { ResultSourceResponse } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { ResultTranscript } from './ChatPane'
import { Button } from './Button'

export function ResultSourceConversation({
  resultId,
  agentId,
}: {
  resultId: string
  agentId: string
}) {
  const [source, setSource] = useState<ResultSourceResponse | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setSource(null)
    fetch(`/api/results/${encodeURIComponent(resultId)}/source`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Unavailable')
        const value = await r.json()
        if (!controller.signal.aborted) setSource(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource({ available: false })
      })
    return () => controller.abort()
  }, [resultId])
  return (
    <section>
      <h2>Source conversation</h2>
      {!source ? (
        <p role="status">Loading source conversation…</p>
      ) : source.available && source.agentId === agentId ? (
        <ResultTranscript messages={source.messages} />
      ) : (
        <p role="status">
          The originating conversation is unavailable. This Agent may have started a new
          conversation.
        </p>
      )}
      <a className="ghost-btn" href={`/agents/${encodeURIComponent(agentId)}`}>
        Open current conversation
      </a>
    </section>
  )
}

export function ResultSourceLink({ resultId, agentId }: { resultId: string; agentId: string }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <span>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setMessage('')
          try {
            const response = await fetch(`/api/results/${encodeURIComponent(resultId)}/source`)
            if (!response.ok) throw new Error('Source conversation is unavailable.')
            const source = (await response.json()) as ResultSourceResponse
            if (!source.available) throw new Error('Source conversation is unavailable.')
            window.location.assign(
              `/agents/${encodeURIComponent(agentId)}?resultSource=${encodeURIComponent(resultId)}`,
            )
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : 'Source conversation is unavailable.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        Source conversation
      </Button>
      {message && (
        <span role="status" className="block text-sm">
          {message}
        </span>
      )}
    </span>
  )
}

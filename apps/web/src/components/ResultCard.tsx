import type { AgentResult } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { ApiError, api, apiFetch, errorMessage } from '../lib/api'
import { Button } from './Button'

const PREVIEW_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const PREVIEW_TEXT = ['text/plain', 'text/markdown']

/** A saved result: name, size, download and, for images and text, a preview. */
export function ResultCard({
  resultId,
  result: preloaded,
  showPreview = false,
}: {
  resultId: string
  /** Pass the result when it is already loaded, e.g. from a results list. */
  result?: AgentResult
  showPreview?: boolean
}) {
  const [result, setResult] = useState<AgentResult | null>(preloaded ?? null)
  const [error, setError] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [imageOpen, setImageOpen] = useState(false)
  const path = `/api/results/${encodeURIComponent(resultId)}`

  useEffect(() => {
    if (preloaded) return
    const controller = new AbortController()
    api<{ result: AgentResult }>(path, { signal: controller.signal })
      .then((body) => setResult(body.result))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(
          cause instanceof ApiError && cause.status === 404
            ? 'This saved file is unavailable (it may have been deleted).'
            : errorMessage(cause),
        )
      })
    return () => controller.abort()
  }, [path, preloaded])

  async function toggleText() {
    if (text !== null) return setText(null)
    setError('')
    try {
      setText(await (await apiFetch(`${path}/preview`)).text())
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const image =
    result && PREVIEW_IMAGE.includes(result.mimeType) && result.byteLength <= 10 * 1024 * 1024
  const textual =
    result && PREVIEW_TEXT.includes(result.mimeType) && result.byteLength <= 256 * 1024
  return (
    <section
      className="my-3 rounded-lg border border-fawn bg-ivory p-3 text-chocolate"
      aria-label="Saved result"
    >
      {result ? (
        <>
          <p className="m-0 break-all font-semibold">{result.name}</p>
          <p className="my-1 text-sm text-mocha-light">
            {result.byteLength < 1024
              ? `${result.byteLength} B`
              : `${(result.byteLength / 1024).toFixed(1)} KiB`}
            {' · '}
            {result.mimeType}
            {result.imageModel && ` · generated with ${result.imageModel}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="ghost-btn" href={`${path}/download`} download={result.name}>
              Download
            </a>
            {image && !showPreview && result.imageModel === null && (
              <Button variant="ghost" onClick={() => setImageOpen((open) => !open)}>
                {imageOpen ? 'Close preview' : 'Preview'}
              </Button>
            )}
            {textual && (
              <Button variant="ghost" onClick={() => void toggleText()}>
                {text !== null ? 'Close preview' : 'Preview'}
              </Button>
            )}
          </div>
          {image && (showPreview || result.imageModel !== null || imageOpen) && (
            <img
              src={`${path}/preview`}
              alt={result.name}
              className="mt-3 max-h-80 max-w-full object-contain"
            />
          )}
          {text !== null && (
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
              {text}
            </pre>
          )}
        </>
      ) : !error ? (
        <p role="status">Loading saved result…</p>
      ) : null}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

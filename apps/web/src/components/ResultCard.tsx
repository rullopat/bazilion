import type { AgentResult } from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

export function ResultCard({
  resultId,
  showPreview = false,
}: {
  resultId: string
  showPreview?: boolean
}) {
  const [result, setResult] = useState<AgentResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'download' | 'preview' | null>(null)
  const [preview, setPreview] = useState<{ text?: string; image?: string } | null>(null)
  const requests = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    requests.current = controller
    setLoading(true)
    setResult(null)
    setPreview(null)
    setError('')
    setBusy(null)
    fetch(`/api/results/${encodeURIComponent(resultId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('This result is unavailable or has not been released.')
        const data = (await response.json()) as { result: AgentResult }
        if (!controller.signal.aborted) setResult(data.result)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [resultId])

  async function loadPreview() {
    const controller = requests.current
    if (!controller || controller.signal.aborted) return
    setBusy('preview')
    setError('')
    try {
      const response = await fetch(`/api/results/${encodeURIComponent(resultId)}/preview`, {
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error ?? 'Preview unavailable.')
      }
      if (response.headers.get('content-type')?.startsWith('image/')) {
        const blob = await response.blob()
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('Could not read the image preview.'))
          reader.readAsDataURL(blob)
        })
        if (!controller.signal.aborted) setPreview({ image })
      } else {
        const text = await response.text()
        if (!controller.signal.aborted) setPreview({ text })
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : 'Preview unavailable.')
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  async function download() {
    const controller = requests.current
    if (!result || !controller || controller.signal.aborted) return
    setBusy('download')
    setError('')
    try {
      const response = await fetch(`/api/results/${encodeURIComponent(resultId)}/download`, {
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Download failed. Try again.')
      }
      const blob = await response.blob()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  return (
    <section
      className="my-3 rounded-lg border border-fawn bg-ivory p-3 text-chocolate"
      aria-label="Saved result"
      aria-busy={loading || busy !== null}
    >
      {loading ? (
        <p role="status">Loading saved result…</p>
      ) : result ? (
        <>
          <p className="m-0 break-all font-semibold">{result.name}</p>
          <p className="my-1 text-sm text-mocha-light">
            {result.byteLength < 1024
              ? `${result.byteLength} B`
              : `${(result.byteLength / 1024).toFixed(1)} KiB`}
            {' · '}
            {result.mimeType}
          </p>
          {result.deletedAt !== null ? (
            <p role="status">This result was deleted.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={download} disabled={busy !== null}>
                {busy === 'download' ? 'Downloading…' : 'Download'}
              </Button>
              {showPreview && (
                <Button
                  variant="ghost"
                  onClick={() => (preview ? setPreview(null) : void loadPreview())}
                  disabled={busy !== null}
                >
                  {busy === 'preview' ? 'Loading preview…' : preview ? 'Close preview' : 'Preview'}
                </Button>
              )}
            </div>
          )}
          {showPreview && result.deletedAt === null && (
            <>
              {preview?.text !== undefined && (
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
                  {preview.text}
                </pre>
              )}
              {preview?.image && (
                <img
                  src={preview.image}
                  alt={result.name}
                  className="mt-3 max-h-80 max-w-full object-contain"
                  onError={() => {
                    setPreview(null)
                    setError('Could not display this image. Use Download.')
                  }}
                />
              )}
            </>
          )}
        </>
      ) : null}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

import type { AgentResult } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { Download, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, api, apiFetch, errorMessage } from '../../lib/api'
import type { WorkspaceSearch } from '../../lib/workspace'
import { Button } from '../Button'
import {
  formatBytes,
  isPreviewImage,
  isPreviewText,
  kindLabel,
  resultPath,
  tileTextPath,
} from './result-utils'

/**
 * A saved file where it was delivered: a picture shows as a picture, anything else as a row with
 * its name, a preview for text and a download.
 */
export function ResultTile({
  resultId,
  result: preloaded,
  detail,
  open,
  selected = false,
  compact = false,
  onPick,
}: {
  resultId: string
  /** Pass the result when a list already loaded it. */
  result?: AgentResult
  /** A second line under the name, e.g. who delivered it and when. */
  detail?: string
  /** Where clicking the picture leads (the Files view); a plain picture without it. */
  open?: WorkspaceSearch
  selected?: boolean
  /** A tile of a grid: every file the same shape, cropped pictures, the start of a text file. */
  compact?: boolean
  /** In a grid, choose the tile instead of following `open`. */
  onPick?: () => void
}) {
  const [result, setResult] = useState<AgentResult | null>(preloaded ?? null)
  const [error, setError] = useState('')
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (preloaded) {
      setResult(preloaded)
      return
    }
    const controller = new AbortController()
    api<{ result: AgentResult }>(resultPath(resultId), { signal: controller.signal })
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
  }, [resultId, preloaded])

  async function toggleText() {
    if (text !== null) return setText(null)
    setError('')
    try {
      setText(await (await apiFetch(resultPath(resultId, 'preview'))).text())
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  if (!result) {
    return (
      <div className="rounded-[10px] border border-border bg-muted p-3 text-sm text-muted-foreground">
        {error ? <span role="alert">{error}</span> : <span role="status">Loading saved file…</span>}
      </div>
    )
  }

  const meta = [
    formatBytes(result.byteLength),
    kindLabel(result.mimeType, result.name),
    result.imageModel ? `made with ${result.imageModel}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const download = (
    <a
      href={resultPath(result.id, 'download')}
      download={result.name}
      aria-label={`Download ${result.name}`}
      title="Download"
      className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:border-sapphire-light hover:text-sapphire"
    >
      <Download className="size-[15px]" aria-hidden="true" />
    </a>
  )
  const frame = `min-w-0 overflow-hidden rounded-[10px] border bg-muted ${
    selected ? 'border-primary ring-1 ring-primary' : 'border-border'
  }`

  if (compact) {
    const face = isPreviewImage(result) ? (
      <img
        src={resultPath(result.id, 'preview')}
        alt={result.name}
        loading="lazy"
        className="block aspect-[4/3] w-full bg-card object-contain p-1.5"
      />
    ) : isPreviewText(result) ? (
      <TextFace result={result} />
    ) : (
      <KindFace result={result} />
    )
    return (
      <figure className={`m-0 ${frame}`}>
        {onPick ? (
          <button
            type="button"
            onClick={onPick}
            aria-label={`Choose ${result.name}`}
            aria-pressed={selected}
            className="unstyled block w-full"
          >
            {face}
          </button>
        ) : open ? (
          <Link
            to="/"
            search={open}
            aria-label={`Open ${result.name}`}
            aria-current={selected ? 'true' : undefined}
            className="block"
          >
            {face}
          </Link>
        ) : (
          face
        )}
        <figcaption className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1.5">
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-semibold text-foreground"
              title={result.name}
            >
              {result.name}
            </span>
            <span className="block truncate text-xs text-mocha">{detail ?? meta}</span>
          </span>
          {download}
        </figcaption>
      </figure>
    )
  }

  if (isPreviewImage(result)) {
    const picture = (
      <img
        src={resultPath(result.id, 'preview')}
        alt={result.name}
        loading="lazy"
        className="block max-h-80 w-full bg-card object-contain"
      />
    )
    return (
      <figure className={`m-0 ${frame}`}>
        {open ? (
          <Link to="/" search={open} aria-label={`Open ${result.name} in Files`} className="block">
            {picture}
          </Link>
        ) : (
          picture
        )}
        <figcaption className="flex items-center gap-2 py-1.5 pl-2.5 pr-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">
              {result.name}
            </span>
            <span className="block truncate text-xs text-mocha">{detail ?? meta}</span>
          </span>
          {download}
        </figcaption>
      </figure>
    )
  }

  return (
    <div className={frame}>
      <div className="flex items-center gap-2.5 py-2 pl-2.5 pr-1.5">
        <FileText className="size-[18px] shrink-0 text-mocha" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {open ? (
            <Link
              to="/"
              search={open}
              className="block truncate text-sm font-semibold text-foreground hover:text-sapphire"
            >
              {result.name}
            </Link>
          ) : (
            <span className="block truncate text-sm font-semibold text-foreground">
              {result.name}
            </span>
          )}
          <span className="block truncate text-xs text-mocha">{detail ?? meta}</span>
        </span>
        {isPreviewText(result) && (
          <Button
            variant="ghost"
            className="min-h-8 px-2.5 py-1 text-xs"
            onClick={() => void toggleText()}
          >
            {text !== null ? 'Hide' : 'Preview'}
          </Button>
        )}
        {download}
      </div>
      {text !== null && (
        <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-card p-3 text-xs">
          {text}
        </pre>
      )}
      {error && (
        <p role="alert" className="m-0 border-t border-border px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** A file shown by its kind: an icon and "PDF", "ZIP". */
function KindFace({ result }: { result: AgentResult }) {
  return (
    <span className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 bg-card text-mocha">
      <FileText className="size-7" aria-hidden="true" />
      <span className="max-w-full truncate px-2 font-mono text-xs font-medium uppercase tracking-wide">
        {kindLabel(result.mimeType, result.name)}
      </span>
    </span>
  )
}

/** A text file shown by its first lines, fading out; by its kind until they arrive or if not. */
function TextFace({ result }: { result: AgentResult }) {
  const [start, setStart] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    apiFetch(tileTextPath(result.id), { signal: controller.signal })
      .then((response) => response.text())
      .then((text) => setStart(text.trim() ? text : null))
      .catch(() => setStart(null))
    return () => controller.abort()
  }, [result.id])
  if (start === null) return <KindFace result={result} />
  return (
    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-card text-left">
      <pre
        aria-hidden="true"
        className="m-0 h-full overflow-hidden whitespace-pre-wrap break-words p-2.5 font-mono text-[10px] leading-[1.45] text-mocha"
      >
        {start}
      </pre>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
      />
      <span className="absolute bottom-1.5 right-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-mocha">
        {kindLabel(result.mimeType, result.name)}
      </span>
    </span>
  )
}

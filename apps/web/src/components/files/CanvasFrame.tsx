// An HTML page or SVG drawing an Agent made (`canvas`, or a delivered .html/.svg file), shown in
// the chat in a sealed frame (BAZ-097): its own opaque origin (a sandbox without
// allow-same-origin), scripts allowed, no network, no forms, no pop-ups, and no way to reach the
// page around it or Bazilion. The page's own policy already keeps a srcdoc frame off other sites;
// the frame adds a stricter one of its own that leaves it no network at all.

import type { AgentResult } from '@bazilion/api-types'
import { Maximize2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, errorMessage } from '../../lib/api'
import { Dialog } from '../Dialog'

/** What the frame may do: run its own inline scripts and styles, show inline pictures and media. */
const FRAME_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

/** The tallest the frame grows to in the chat; the full-size view shows the rest. Layout only. */
const MAX_HEIGHT_PX = 640
const START_HEIGHT_PX = 320

export const isCanvas = (result: Pick<AgentResult, 'mimeType'>) =>
  result.mimeType === 'text/html' || result.mimeType === 'image/svg+xml'

/**
 * The document the frame shows: our policy first, before anything the Agent wrote, then a line
 * that tells the chat how tall the page is.
 */
export function canvasDocument(text: string, svg: boolean): string {
  const head = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`,
    svg ? '<style>html,body{margin:0}svg{display:block;max-width:100%;height:auto}</style>' : '',
    '<script>(function(){function post(){parent.postMessage({bazilionCanvasHeight:document.documentElement.scrollHeight},"*")}addEventListener("load",post);new ResizeObserver(post).observe(document.documentElement)})()</script>',
  ].join('')
  return head + text
}

function Frame({
  doc,
  title,
  fill = false,
}: {
  doc: string
  title: string
  /** Fill the space it is given (the full-size view) instead of growing to its page. */
  fill?: boolean
}) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(START_HEIGHT_PX)
  useEffect(() => {
    if (fill) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return
      const asked = (event.data as { bazilionCanvasHeight?: unknown } | null)?.bazilionCanvasHeight
      if (typeof asked === 'number' && Number.isFinite(asked) && asked > 0)
        setHeight(Math.min(MAX_HEIGHT_PX, Math.ceil(asked)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [fill])
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      style={fill ? undefined : { height }}
      className={`block w-full border-0 bg-white ${fill ? 'h-[75vh]' : ''}`}
    />
  )
}

/** The frame under a saved page's row, with a way to see it full size. */
export function CanvasFrame({ result }: { result: AgentResult }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [full, setFull] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/results/${encodeURIComponent(result.id)}/canvas`, { signal: controller.signal })
      .then((response) => response.text())
      .then(setText)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [result.id])
  if (error)
    return (
      <p role="alert" className="m-0 border-t border-border px-3 py-2 text-xs text-danger">
        {error}
      </p>
    )
  if (text === null)
    return (
      <p role="status" className="m-0 border-t border-border px-3 py-2 text-xs text-mocha">
        Loading {result.name}…
      </p>
    )
  const doc = canvasDocument(text, result.mimeType === 'image/svg+xml')
  return (
    <div className="relative border-t border-border">
      <Frame doc={doc} title={result.name} />
      <button
        type="button"
        onClick={() => setFull(true)}
        aria-label={`Show ${result.name} full size`}
        title="Full size"
        className="unstyled absolute right-2 top-2 flex size-8 items-center justify-center rounded-[10px] border border-border bg-card text-foreground shadow-baziu-sm hover:border-sapphire-light hover:text-sapphire"
      >
        <Maximize2 className="size-[15px]" aria-hidden="true" />
      </button>
      {full && (
        <Dialog title={result.name} onClose={() => setFull(false)} className="w-[min(72rem,96vw)]">
          <Frame doc={doc} title={result.name} fill />
        </Dialog>
      )}
    </div>
  )
}

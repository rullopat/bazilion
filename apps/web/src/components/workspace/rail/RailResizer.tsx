// The handle on the right edge of the list on the left (BAZ-098): drag it, or move it with the
// arrow keys, to make the list wider or narrower; a double-click puts the usual width back. The
// width is kept per browser in a cookie, so the next page renders at it.

import { useRef } from 'react'
import { clampRailWidth, RAIL_WIDTH, writeRailWidthCookie } from '../../../lib/workspace'

/** One arrow key's step, in rem. */
const STEP = 1

export function RailResizer({ width, onWidth }: { width: number; onWidth: (rem: number) => void }) {
  const start = useRef<{ x: number; width: number; rem: number } | null>(null)

  function set(rem: number, keep: boolean) {
    const next = clampRailWidth(rem)
    onWidth(next)
    if (keep) writeRailWidthCookie(next)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take the focus or be dragged.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of the list of Teams"
      aria-valuemin={RAIL_WIDTH.least}
      aria-valuemax={RAIL_WIDTH.most}
      aria-valuenow={width}
      aria-valuetext={`${width} rem`}
      tabIndex={0}
      title="Drag to resize; double-click for the usual width"
      className="group/resize absolute inset-y-0 -right-[0.6rem] z-10 hidden w-3 cursor-col-resize touch-none justify-center outline-none lg:flex"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        start.current = { x: event.clientX, width, rem }
      }}
      onPointerMove={(event) => {
        const from = start.current
        if (!from) return
        set(from.width + (event.clientX - from.x) / from.rem, false)
      }}
      onPointerUp={(event) => {
        if (!start.current) return
        start.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        writeRailWidthCookie(width)
      }}
      onPointerCancel={() => {
        start.current = null
      }}
      onDoubleClick={() => set(RAIL_WIDTH.usual, true)}
      onKeyDown={(event) => {
        const by = event.key === 'ArrowLeft' ? -STEP : event.key === 'ArrowRight' ? STEP : undefined
        if (by !== undefined) {
          event.preventDefault()
          set(width + by, true)
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          set(event.key === 'Home' ? RAIL_WIDTH.least : RAIL_WIDTH.most, true)
        }
      }}
    >
      {/* Always there, faint: a line along the edge and a grip at its middle, stronger on hover. */}
      <span
        aria-hidden="true"
        className="my-3 w-px rounded-full bg-border transition-colors group-hover/resize:w-0.5 group-hover/resize:bg-ring group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-ring"
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 h-8 w-1.5 -translate-y-1/2 rounded-full border border-border bg-card transition-colors group-hover/resize:border-ring group-focus-visible/resize:border-ring"
      />
    </div>
  )
}

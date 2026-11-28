// Read aloud (BAZ-096): a button on each Agent message that plays it in the voice chosen under
// Setup → Models. The daemon reads only the message's prose (no code blocks or tables); the audio
// is made when asked and not saved. One message plays at a time: the latest one pressed.

import type { SpeakRequest } from '@bazilion/api-types'
import { LoaderCircle, Square, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, errorMessage } from '../../lib/api'

/** The latest message asked to play; a reading that is not the latest does not start. */
let latest = 0
/** The one message playing, and how to stop it. */
let playing: { token: number; stop: () => void } | null = null

export function ReadAloud({ text }: { text: string }) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [error, setError] = useState<string | null>(null)
  /** This message's reading, while it loads or plays. */
  const mine = useRef(0)
  const alive = useRef(true)
  // A message that leaves the page stops speaking, and one still loading never starts.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (playing && playing.token === mine.current) playing.stop()
    }
  }, [])

  async function read() {
    playing?.stop()
    const token = ++latest
    mine.current = token
    setError(null)
    setPhase('loading')
    try {
      const body: SpeakRequest = { text, markdown: true }
      const response = await apiFetch('/api/speech', { body })
      const blob = await response.blob()
      // Another message was pressed meanwhile, or this one left the page.
      if (token !== latest || !alive.current) {
        if (alive.current) setPhase('idle')
        return
      }
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      const stop = () => {
        audio.pause()
        URL.revokeObjectURL(url)
        if (playing?.token === token) playing = null
        if (alive.current) setPhase('idle')
      }
      audio.onended = stop
      playing = { token, stop }
      await audio.play()
      setPhase('playing')
    } catch (cause) {
      if (!alive.current) return
      setError(errorMessage(cause))
      setPhase('idle')
    }
  }

  function stopMine() {
    if (playing?.token === mine.current) playing.stop()
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (phase === 'playing' ? stopMine() : void read())}
        disabled={phase === 'loading'}
        aria-label={phase === 'playing' ? 'Stop reading aloud' : 'Read aloud'}
        title={phase === 'playing' ? 'Stop' : 'Read aloud'}
        className="unstyled flex size-7 items-center justify-center rounded-md text-mocha opacity-0 transition-opacity hover:bg-frost hover:text-sapphire focus-visible:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100 data-[active=true]:opacity-100"
        data-active={phase !== 'idle' || error !== null}
      >
        {phase === 'loading' ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : phase === 'playing' ? (
          <Square className="size-3.5" aria-hidden="true" />
        ) : (
          <Volume2 className="size-4" aria-hidden="true" />
        )}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          Not read aloud: {error}
        </span>
      )}
    </span>
  )
}

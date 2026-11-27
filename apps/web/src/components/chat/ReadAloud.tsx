// Read aloud (BAZ-096): a button on each Agent message that plays it in the voice chosen under
// Setup → Models. The daemon reads only the message's prose (no code blocks or tables); the audio
// is made when asked and not saved. One message plays at a time.

import type { SpeakRequest } from '@bazilion/api-types'
import { LoaderCircle, Square, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, errorMessage } from '../../lib/api'

/** The one message playing, so that starting another stops it. */
let playing: { audio: HTMLAudioElement; stop: () => void } | null = null

export function ReadAloud({ text }: { text: string }) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const mine = useRef<HTMLAudioElement | null>(null)
  // A message that leaves the page stops speaking.
  useEffect(
    () => () => {
      if (playing && playing.audio === mine.current) playing.stop()
    },
    [],
  )

  async function read() {
    playing?.stop()
    setError(null)
    setPhase('loading')
    try {
      const body: SpeakRequest = { text, markdown: true }
      const response = await apiFetch('/api/speech', { body })
      const url = URL.createObjectURL(await response.blob())
      const audio = new Audio(url)
      mine.current = audio
      const stop = () => {
        audio.pause()
        URL.revokeObjectURL(url)
        if (playing?.audio === audio) playing = null
        setPhase('idle')
      }
      audio.onended = stop
      playing = { audio, stop }
      await audio.play()
      setPhase('playing')
    } catch (cause) {
      setError(errorMessage(cause))
      setPhase('idle')
    }
  }

  return (
    <span className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={() => (phase === 'playing' ? playing?.stop() : void read())}
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

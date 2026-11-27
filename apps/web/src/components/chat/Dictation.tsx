// Dictation in the message field (BAZ-096): press the microphone to record, press it again to stop;
// the transcription model chosen under Setup turns the recording into words, which land in the
// field to edit before sending. Browsers give the microphone only to https:// pages and to this
// computer (127.0.0.1, localhost).

import type { TranscribeRequest, TranscribeResponse } from '@bazilion/api-types'
import { LoaderCircle, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'

/** The recording types to ask the browser for, the most widely transcribed first. */
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'] as const

type Phase = 'idle' | 'recording' | 'transcribing'

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Why this page cannot record, or null when it can. */
function unavailable(): string | null {
  if (typeof window === 'undefined') return null
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    return 'Dictation needs the microphone, which browsers give only to https:// addresses and to this computer (127.0.0.1).'
  if (typeof MediaRecorder === 'undefined') return 'This browser cannot record.'
  return null
}

export function DictationButton({
  agentName,
  onText,
  onError,
}: {
  agentName: string
  /** The words heard, to add to the message. */
  onText: (text: string) => void
  onError: (message: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [blocked, setBlocked] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  // Checked once on the client: the server cannot know the browser.
  useEffect(() => setBlocked(unavailable()), [])
  // Leaving the conversation stops a recording and lets go of the microphone.
  useEffect(
    () => () => {
      recorder.current?.stop()
      for (const track of stream.current?.getTracks() ?? []) track.stop()
    },
    [],
  )

  async function transcribe(blob: Blob, mimeType: string) {
    setPhase('transcribing')
    try {
      const body: TranscribeRequest = { mimeType, data: await base64(blob) }
      const { text } = await api<TranscribeResponse>('/api/transcription', { body })
      if (text.trim()) onText(text.trim())
      else onError('No words were heard in the recording.')
    } catch (error) {
      onError(`The recording was not transcribed: ${errorMessage(error)}`)
    } finally {
      setPhase('idle')
    }
  }

  async function start() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = media
      const type = RECORDING_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      rec.onstop = () => {
        for (const track of media.getTracks()) track.stop()
        stream.current = null
        recorder.current = null
        const mimeType = rec.mimeType || type || 'audio/webm'
        if (chunks.length > 0) void transcribe(new Blob(chunks, { type: mimeType }), mimeType)
        else setPhase('idle')
      }
      recorder.current = rec
      rec.start()
      setPhase('recording')
    } catch (error) {
      setPhase('idle')
      onError(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'The browser was not allowed to use the microphone. Allow it for this page to dictate.'
          : `The microphone could not be opened: ${errorMessage(error)}`,
      )
    }
  }

  const label =
    phase === 'recording'
      ? 'Stop recording'
      : phase === 'transcribing'
        ? 'Transcribing the recording'
        : `Dictate a message to ${agentName}`
  return (
    <button
      type="button"
      onClick={() => (phase === 'recording' ? recorder.current?.stop() : void start())}
      disabled={phase === 'transcribing' || blocked !== null}
      aria-pressed={phase === 'recording'}
      aria-label={label}
      title={blocked ?? label}
      className={`flex h-11 items-center justify-center rounded-md border-[1.5px] px-3 py-2 text-[1em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        phase === 'recording'
          ? 'border-danger bg-danger/10 text-danger'
          : 'border-frost bg-snow text-mocha hover:border-sapphire hover:text-sapphire'
      }`}
    >
      {phase === 'recording' ? (
        <Square className="size-[16px]" aria-hidden="true" />
      ) : phase === 'transcribing' ? (
        <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" />
      ) : (
        <Mic className="size-[18px]" aria-hidden="true" />
      )}
    </button>
  )
}

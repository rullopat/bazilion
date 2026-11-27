// `bazilion speech` (BAZ-096): the voices of the speech model chosen under Setup → Models (choose
// one with `bazilion config set BAZILION_SPEECH_VOICE <id>`), and text read out into a file.

import { existsSync, writeFileSync } from 'node:fs'
import type { SpeakRequest, SpeechVoicesResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { jsonFlag, printJson, printRows } from '../command-helpers.ts'
import { UsageError } from '../errors.ts'

const voicesCmd = defineCommand({
  meta: { name: 'voices', description: "List the speech model's voices" },
  args: { json: jsonFlag },
  async run({ args }) {
    const body = await createClient().get<SpeechVoicesResponse>('/api/speech/voices')
    if (args.json) return printJson(body)
    console.log(`${body.model}:`)
    printRows(
      body.voices.map((voice) => [voice.id, voice.name, voice.detail ?? '']),
      '(no voices listed)',
    )
  },
})

/** The file ending the audio's first bytes say. */
function ending(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 12)).toString('latin1')
  if (head.startsWith('RIFF')) return 'wav'
  if (head.startsWith('OggS')) return 'ogg'
  if (head.slice(4, 8) === 'ftyp') return 'm4a'
  return 'mp3'
}

const sayCmd = defineCommand({
  meta: { name: 'say', description: 'Read text out with the speech model into an audio file' },
  args: {
    text: { type: 'positional', description: 'What to say', required: true },
    voice: { type: 'string', description: 'A voice id (default: the one chosen under Setup)' },
    output: { type: 'string', description: 'Where to save it (default: speech.<ending> here)' },
  },
  async run({ args }) {
    const body: SpeakRequest = { text: args.text, ...(args.voice ? { voice: args.voice } : {}) }
    const audio = await createClient().binary('/api/speech', body)
    const path = args.output ?? `speech.${ending(audio)}`
    if (!args.output && existsSync(path))
      throw new UsageError(`${path} exists; name another file with --output`)
    writeFileSync(path, audio)
    console.log(`saved ${path} (${audio.byteLength} bytes)`)
  },
})

export const speechCommand = defineCommand({
  meta: { name: 'speech', description: 'Voices of the speech model, and text read out' },
  subCommands: { voices: voicesCmd, say: sayCmd },
})

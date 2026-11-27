// What an Agent makes and hears besides text and pictures: videos and sound (BAZ-095), speech and
// transcripts (BAZ-096). The daemon calls the chosen model and saves what it makes as a result; a
// tool is offered only while its model is chosen and ready.

import type {
  AudioHost,
  MediaOutput,
  SpeechHost,
  TranscriptionHost,
  VideoHost,
} from '../worker/ipc-protocol.ts'
import type { ToolHandler, ToolOutput } from './types.ts'

const NAME = {
  type: 'string',
  description: 'Optional file name without a path (letters, digits, space, _ . -).',
} as const

function saved(output: MediaOutput, verb: string): ToolOutput {
  return {
    content: [
      {
        type: 'text',
        text: [
          `${verb} with ${output.model}: saved ${output.files.map((file) => `"${file.name}" as result ${file.result.resultId}`).join(', ')}. The user sees it in the conversation.`,
          output.words ? `What the model wrote with it:\n${output.words}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
    details: { results: output.files.map((file) => file.result) },
  }
}

export function videoGenerateTool(host: VideoHost): ToolHandler {
  return {
    def: {
      name: 'video_generate',
      description:
        'Make a short video, with sound, from a prompt, or from a picture as its first frame, with the video model the user chose. It runs in the background: the call answers at once, and you are woken in this conversation when the video is saved, to show it with deliver_file. Lengths are whole seconds (most models take about 4 to 15; a length the model does not take is refused with the ones it does). Each call is a new paid generation.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'What happens, the look, the camera, the sound. At most 8 KiB.',
          },
          seconds: { type: 'integer', description: 'How long the video is.' },
          shape: { type: 'string', enum: ['landscape', 'portrait', 'square'] },
          image: {
            type: 'string',
            description: 'A PNG, JPEG or WebP picture in your workspace or uploads to start from.',
          },
          name: NAME,
        },
        required: ['prompt', 'seconds'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      if (!context?.toolCallId) throw new Error('video_generate: missing tool call id')
      const shape = args.shape === 'portrait' || args.shape === 'square' ? args.shape : 'landscape'
      const output = await host.generate({
        toolCallId: context.toolCallId,
        prompt: String(args.prompt ?? ''),
        seconds: Number(args.seconds),
        shape,
        ...(typeof args.image === 'string' && args.image ? { image: args.image } : {}),
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
      })
      return `${output.model} is making the video in the background. Go on with the turn; you are woken in this conversation when it is ready, to show it with deliver_file.`
    },
  }
}

export function audioGenerateTool(host: AudioHost): ToolHandler {
  return {
    def: {
      name: 'audio_generate',
      description:
        'Make music (a song, a jingle, background music) or a sound effect with the model the user chose for music and sound. For music give a prompt with the genre, mood and instruments, and optionally lyrics to sing; for a sound, describe it. The sound is saved and shown to the user. With `background: true` the call answers at once and you are woken when it is ready. Each call is a new paid generation.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['music', 'sound'] },
          prompt: { type: 'string', description: 'What it should sound like. At most 8 KiB.' },
          lyrics: { type: 'string', description: 'Words to sing, for music.' },
          instrumental: { type: 'boolean', description: 'Music without voices.' },
          seconds: { type: 'number', description: 'How long, when the model takes a length.' },
          loop: { type: 'boolean', description: 'A sound effect that loops seamlessly.' },
          name: NAME,
          background: {
            type: 'boolean',
            description: 'Answer at once; you are woken when the sound is ready.',
          },
        },
        required: ['kind', 'prompt'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      if (!context?.toolCallId) throw new Error('audio_generate: missing tool call id')
      const output = await host.generate(
        {
          toolCallId: context.toolCallId,
          kind: args.kind === 'sound' ? 'sound' : 'music',
          prompt: String(args.prompt ?? ''),
          ...(typeof args.lyrics === 'string' && args.lyrics.trim() ? { lyrics: args.lyrics } : {}),
          ...(args.instrumental === true ? { instrumental: true } : {}),
          ...(typeof args.seconds === 'number' ? { seconds: args.seconds } : {}),
          ...(args.loop === true ? { loop: true } : {}),
          ...(typeof args.name === 'string' ? { name: args.name } : {}),
          ...(args.background === true ? { background: true } : {}),
        },
        context.signal,
      )
      if (output.pending)
        return `${output.model} is making it in the background. Go on with the turn; you are woken in this conversation when it is ready, to show it with deliver_file.`
      return saved(output, 'Made')
    },
  }
}

export function speakTool(host: SpeechHost): ToolHandler {
  return {
    def: {
      name: 'speak',
      description:
        "Read text out in a voice, with the speech model the user chose: an audio message, a greeting, a narration. The audio is saved, played in the conversation, and sent to your Telegram topic as a voice note. Without `voice`, the user's chosen voice is used. Write the text as it should be said: no Markdown, no code.",
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to say.' },
          voice: { type: 'string', description: "A voice id of the speech model's provider." },
          name: NAME,
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      if (!context?.toolCallId) throw new Error('speak: missing tool call id')
      const output = await host.speak(
        {
          toolCallId: context.toolCallId,
          text: String(args.text ?? ''),
          ...(typeof args.voice === 'string' && args.voice.trim() ? { voice: args.voice } : {}),
          ...(typeof args.name === 'string' ? { name: args.name } : {}),
        },
        context.signal,
      )
      return saved(output, 'Spoken')
    },
  }
}

export function transcribeTool(host: TranscriptionHost): ToolHandler {
  return {
    def: {
      name: 'transcribe',
      description:
        'Turn an audio or video file in your workspace or uploads into text, with the transcription model the user chose: a recording, a meeting, a podcast, a video. You get the words, and the times of each line when the model gives them. Files the user sends in chat or on Telegram are transcribed for you already.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The audio or video file.' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      if (!path) throw new Error('transcribe: path is required')
      const output = await host.transcribe({ path }, context?.signal)
      if (!output.text.trim()) return `${output.model} heard no words in ${path}.`
      return `Transcribed ${path} with ${output.model}:\n\n${output.timed ?? output.text}`
    },
  }
}

/** The media tools whose hosts are present. */
export function mediaTools(hosts: {
  videoHost?: VideoHost
  audioHost?: AudioHost
  speechHost?: SpeechHost
  transcriptionHost?: TranscriptionHost
}): ToolHandler[] {
  return [
    ...(hosts.videoHost ? [videoGenerateTool(hosts.videoHost)] : []),
    ...(hosts.audioHost ? [audioGenerateTool(hosts.audioHost)] : []),
    ...(hosts.speechHost ? [speakTool(hosts.speechHost)] : []),
    ...(hosts.transcriptionHost ? [transcribeTool(hosts.transcriptionHost)] : []),
  ]
}

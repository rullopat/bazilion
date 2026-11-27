// Voice replies (BAZ-096): when you send a voice note on Telegram, the Agent's answer comes back as
// a voice note too, read by the chosen speech model, after the text. Without a speech model, or
// when Telegram or the model refuses, the text alone stays. Never throws.

import { InputFile } from 'grammy'
import { agentRepo, mergeSecretsIntoEnv } from '../../core/index.ts'
import { speechRoute } from '../../core/media-routes.ts'
import { getCtx } from '../ctx.ts'
import { speakableText, synthesize } from '../media/speech.ts'
import { telegramLive } from './live.ts'
import { enqueueOutbound } from './outbound-queue.ts'

/** What Telegram shows as a voice note: OGG with Opus, MP3 or M4A; anything else is a file. */
const VOICE_TYPES = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4'])

export async function sendVoiceReply(agentId: string, answer: string): Promise<void> {
  const live = telegramLive()
  if (!live) return
  const topicId = agentRepo.getTelegramTopicId(live.db, agentId)
  if (topicId === null) return
  const env = mergeSecretsIntoEnv(live.db, getCtx().authToken)
  const chosen = speechRoute(env)
  if (!chosen.ready) return
  const words = speakableText(answer)
  if (!words) return
  try {
    const spoken = await synthesize(chosen, words, env.BAZILION_SPEECH_VOICE)
    const file = new InputFile(spoken.bytes, `reply.${spoken.extension}`)
    await enqueueOutbound<unknown>(live.chatId, () =>
      VOICE_TYPES.has(spoken.mimeType)
        ? live.api.sendVoice(live.chatId, file, { message_thread_id: topicId })
        : live.api.sendDocument(live.chatId, file, { message_thread_id: topicId }),
    )
  } catch {
    // Metadata only: an adapter error can carry the bot token or the model's key.
    console.warn(JSON.stringify({ event: 'telegram_voice_reply_failed', agentId }))
  }
}

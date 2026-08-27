// Inbound media extraction (pure function). Download + classification are
// covered by the unified attachment path (routing → central classifier).

import type { Message } from 'grammy/types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { downloadMediaBytes, extractMedia } from '../../src/lib/telegram/media.ts'

afterEach(() => vi.unstubAllGlobals())

function msg(extra: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: -1, type: 'supergroup', title: 'T' },
    ...extra,
  } as Message
}

describe('extractMedia', () => {
  test('text-only message → null', () => {
    expect(extractMedia(msg({ text: 'hi' }))).toBeNull()
  })

  test('photo → largest size, image/jpeg', () => {
    const m = msg({
      photo: [
        { file_id: 'small', file_unique_id: 'a', width: 90, height: 90, file_size: 1000 },
        { file_id: 'big', file_unique_id: 'b', width: 1280, height: 1280, file_size: 50000 },
      ],
    })
    const ref = extractMedia(m)
    expect(ref?.kind).toBe('photo')
    expect(ref?.fileId).toBe('big')
    expect(ref?.mimeType).toBe('image/jpeg')
  })

  test('document → carries file_name + mime_type', () => {
    const m = msg({
      document: {
        file_id: 'doc1',
        file_unique_id: 'd',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        file_size: 2048,
      },
    })
    const ref = extractMedia(m)
    expect(ref?.kind).toBe('document')
    expect(ref?.fileName).toBe('report.pdf')
    expect(ref?.mimeType).toBe('application/pdf')
  })

  test('voice → audio/ogg default', () => {
    const m = msg({
      voice: { file_id: 'v1', file_unique_id: 'v', duration: 3, file_size: 4096 },
    })
    expect(extractMedia(m)?.kind).toBe('voice')
    expect(extractMedia(m)?.mimeType).toBe('audio/ogg')
  })
})

test('media adapter failures never expose the Telegram bot token', async () => {
  const token = '123456:TELEGRAM_TOKEN_SENTINEL'
  const ref = {
    kind: 'document' as const,
    fileId: 'file-1',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 12,
  }
  const lookup = await downloadMediaBytes(
    {
      getFile: async () => {
        throw new Error(`request failed: https://api.telegram.org/bot${token}/getFile`)
      },
    },
    token,
    ref,
  )
  expect(lookup).toEqual({ ok: false, reason: 'Telegram file lookup failed' })
  expect(JSON.stringify(lookup)).not.toContain(token)

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(`request failed: https://api.telegram.org/file/bot${token}/secret`)
    }),
  )
  const download = await downloadMediaBytes(
    { getFile: async () => ({ file_path: 'secret', file_size: 12 }) },
    token,
    ref,
  )
  expect(download).toEqual({ ok: false, reason: 'Telegram media download failed' })
  expect(JSON.stringify(download)).not.toContain(token)
})

// Inbound media extraction + attachment-note rendering (pure functions).

import type { Message } from 'grammy/types'
import { describe, expect, test } from 'vitest'
import { attachmentNote, extractMedia, type MediaRef } from '../../src/lib/telegram/media.ts'

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

describe('attachmentNote', () => {
  const ref: MediaRef = {
    kind: 'document',
    fileId: 'doc1',
    fileName: 'r.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
  }

  test('success note includes path + meta', () => {
    const note = attachmentNote(ref, {
      ok: true,
      path: '/home/agents/x/telegram-inbox/doc1-r.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    })
    expect(note).toContain('/home/agents/x/telegram-inbox/doc1-r.pdf')
    expect(note).toContain('application/pdf')
  })

  test('failure note explains the reason', () => {
    const note = attachmentNote(ref, { ok: false, reason: 'too large (30 MB > 20 MB)' })
    expect(note).toMatch(/could not be downloaded/i)
    expect(note).toContain('too large')
  })
})

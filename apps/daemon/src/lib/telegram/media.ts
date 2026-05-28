// Inbound Telegram media → generic attachment.
//
// We detect the single media object on a message, download its bytes
// (size-guarded), and hand them back as base64. The caller turns that into a
// generic `Attachment`; the daemon's central classifier then decides per
// attachment whether it's vision (image/*) or a stored-and-referenced file —
// the same path web and CLI attachments take.

import type { Message } from 'grammy/types'

/** 20 MB — Telegram's bot getFile ceiling; we don't fetch larger. */
const MAX_BYTES = 20 * 1024 * 1024

export type MediaKind = 'photo' | 'document' | 'voice' | 'audio' | 'video'

export interface MediaRef {
  kind: MediaKind
  fileId: string
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
}

/** Pull the single logical media object off a message, or null when text-only. */
export function extractMedia(m: Message): MediaRef | null {
  if (m.photo && m.photo.length > 0) {
    // PhotoSize[] is ascending by resolution — take the largest.
    const largest = m.photo[m.photo.length - 1]
    if (largest) {
      return {
        kind: 'photo',
        fileId: largest.file_id,
        fileName: null,
        mimeType: 'image/jpeg',
        fileSize: largest.file_size ?? null,
      }
    }
  }
  if (m.document) {
    return {
      kind: 'document',
      fileId: m.document.file_id,
      fileName: m.document.file_name ?? null,
      mimeType: m.document.mime_type ?? null,
      fileSize: m.document.file_size ?? null,
    }
  }
  if (m.voice) {
    return {
      kind: 'voice',
      fileId: m.voice.file_id,
      fileName: null,
      mimeType: m.voice.mime_type ?? 'audio/ogg',
      fileSize: m.voice.file_size ?? null,
    }
  }
  if (m.audio) {
    return {
      kind: 'audio',
      fileId: m.audio.file_id,
      fileName: m.audio.file_name ?? null,
      mimeType: m.audio.mime_type ?? null,
      fileSize: m.audio.file_size ?? null,
    }
  }
  if (m.video) {
    return {
      kind: 'video',
      fileId: m.video.file_id,
      fileName: m.video.file_name ?? null,
      mimeType: m.video.mime_type ?? null,
      fileSize: m.video.file_size ?? null,
    }
  }
  return null
}

/** Bot API subset media download needs. */
export interface MediaApi {
  getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }>
}

export type DownloadBytesResult =
  | { ok: true; data: string; mimeType: string; name: string | null }
  | { ok: false; reason: string }

/**
 * Download a media file and return its bytes as base64 (size-guarded both by
 * the message-declared size and the getFile-reported size). The daemon stores
 * non-image files itself; images go straight to the model — so we don't write
 * to disk here.
 */
export async function downloadMediaBytes(
  api: MediaApi,
  botToken: string,
  ref: MediaRef,
): Promise<DownloadBytesResult> {
  if (ref.fileSize && ref.fileSize > MAX_BYTES) {
    return { ok: false, reason: `too large (${formatBytes(ref.fileSize)} > 20 MB)` }
  }
  let file: { file_path?: string; file_size?: number }
  try {
    file = await api.getFile(ref.fileId)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
  if (!file.file_path) return { ok: false, reason: 'no file_path from Telegram' }
  if (file.file_size && file.file_size > MAX_BYTES) {
    return { ok: false, reason: `too large (${formatBytes(file.file_size)} > 20 MB)` }
  }

  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, reason: `download HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return { ok: false, reason: 'too large after download' }
    return {
      ok: true,
      data: buf.toString('base64'),
      mimeType: ref.mimeType ?? 'application/octet-stream',
      name: ref.fileName,
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

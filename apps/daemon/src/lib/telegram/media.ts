// Inbound media handling (Phase 11, bounded slice).
//
// Detects photo / document / voice / audio / video on a Telegram message,
// downloads it (size-guarded) into the agent's private home, and produces a
// text reference the agent receives as part of its turn. This removes the
// silent-drop of non-text inbound: an agent with file/bash tools can open the
// saved path.
//
// NOT in this slice: native provider multimodal (image content blocks fed to
// the model). That needs worker-IPC + provider-adapter changes and is the
// explicit follow-up. Here the model "sees" a reference, not raw pixels.

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Message } from 'grammy/types'

/** 20 MB — Telegram's bot getFile ceiling; we don't store larger. */
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

export type DownloadResult =
  | { ok: true; path: string; mimeType: string | null; size: number }
  | { ok: false; reason: string }

/**
 * Download a media file into `destDir` (created if needed). Size-guarded both
 * by the message-declared size and the getFile-reported size. Returns the saved
 * absolute path on success.
 */
export async function downloadMedia(
  api: MediaApi,
  botToken: string,
  ref: MediaRef,
  destDir: string,
): Promise<DownloadResult> {
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
    mkdirSync(destDir, { recursive: true })
    const name = safeFileName(ref, file.file_path)
    const path = join(destDir, name)
    writeFileSync(path, buf)
    return { ok: true, path, mimeType: ref.mimeType, size: buf.byteLength }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** The text reference the agent receives for a downloaded attachment. */
export function attachmentNote(ref: MediaRef, result: DownloadResult): string {
  if (!result.ok) {
    return `[Telegram ${ref.kind} attachment could not be downloaded: ${result.reason}]`
  }
  const meta = [result.mimeType ?? 'unknown', formatBytes(result.size)].join(', ')
  return `[Telegram ${ref.kind} attachment saved to ${result.path} (${meta})]`
}

function safeFileName(ref: MediaRef, filePath: string): string {
  const base = ref.fileName ? basename(ref.fileName) : basename(filePath)
  const cleaned = base.replace(/[^\w.-]/g, '_').slice(0, 120) || `${ref.kind}.bin`
  // Prefix with a short slice of the file id to avoid collisions.
  return `${ref.fileId.slice(0, 8)}-${cleaned}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

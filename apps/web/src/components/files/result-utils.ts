import { type AgentResult, isTextPreview } from '@bazilion/api-types'

const PREVIEW_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** The daemon previews these images up to 10 MiB. */
export function isPreviewImage(result: Pick<AgentResult, 'mimeType' | 'byteLength'>): boolean {
  return PREVIEW_IMAGE.includes(result.mimeType) && result.byteLength <= 10 * 1024 * 1024
}

/** The daemon previews text up to 256 KiB: by its type, or by its name when sent untyped. */
export function isPreviewText(
  result: Pick<AgentResult, 'mimeType' | 'name' | 'byteLength'>,
): boolean {
  return isTextPreview(result)
}

/** How much of a text file a grid tile shows. */
export const TILE_TEXT_BYTES = 1200

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "PNG image", "Markdown", "PDF": a file's kind in a word or two. */
export function kindLabel(mimeType: string, name: string): string {
  if (mimeType.startsWith('image/'))
    return `${mimeType.slice(6).split('+')[0]?.toUpperCase()} image`
  if (mimeType.startsWith('video/')) return 'Video'
  if (mimeType === 'audio/mpeg') return 'MP3 audio'
  if (mimeType.startsWith('audio/')) return `${mimeType.slice(6).toUpperCase()} audio`
  if (mimeType === 'text/html') return 'HTML page'
  if (mimeType === 'text/markdown') return 'Markdown'
  if (mimeType === 'text/plain') return 'Text'
  if (mimeType === 'application/pdf') return 'PDF'
  const extension = /\.([a-z0-9]{1,6})$/i.exec(name)?.[1]
  return extension ? extension.toUpperCase() : mimeType
}

/** A sound or a video the page plays where it was delivered. */
export const isPlayable = (result: Pick<AgentResult, 'mimeType'>) =>
  result.mimeType.startsWith('audio/') || result.mimeType.startsWith('video/')

export const resultPath = (id: string, action?: 'download' | 'preview' | 'media') =>
  `/api/results/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

/** The start of a text file, for a tile. */
export const tileTextPath = (id: string) => `${resultPath(id, 'preview')}?bytes=${TILE_TEXT_BYTES}`

/** The archive of a Team's, an Agent's or a conversation's saved files. */
export function archivePath(filter: {
  teamId?: string
  agentId?: string
  sessionId?: string
}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value)
  return `/api/results/archive?${params}`
}

import type { AgentResult } from '@bazilion/api-types'

const PREVIEW_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const PREVIEW_TEXT = ['text/plain', 'text/markdown']

/** The daemon previews these images up to 10 MiB. */
export function isPreviewImage(result: Pick<AgentResult, 'mimeType' | 'byteLength'>): boolean {
  return PREVIEW_IMAGE.includes(result.mimeType) && result.byteLength <= 10 * 1024 * 1024
}

/** The daemon previews plain text and Markdown up to 256 KiB. */
export function isPreviewText(result: Pick<AgentResult, 'mimeType' | 'byteLength'>): boolean {
  return PREVIEW_TEXT.includes(result.mimeType) && result.byteLength <= 256 * 1024
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "PNG image", "Markdown", "PDF": a file's kind in a word or two. */
export function kindLabel(mimeType: string, name: string): string {
  if (mimeType.startsWith('image/')) return `${mimeType.slice(6).toUpperCase()} image`
  if (mimeType === 'text/markdown') return 'Markdown'
  if (mimeType === 'text/plain') return 'Text'
  if (mimeType === 'application/pdf') return 'PDF'
  const extension = /\.([a-z0-9]{1,6})$/i.exec(name)?.[1]
  return extension ? extension.toUpperCase() : mimeType
}

export const resultPath = (id: string, action?: 'download' | 'preview') =>
  `/api/results/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

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

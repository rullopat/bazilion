/** A file an Agent delivered or generated, saved by the daemon. */
export interface AgentResult {
  id: string
  teamId: string
  agentId: string
  /** The conversation it was delivered in. */
  sessionId: string
  toolCallId: string
  /** Position among the images of one image_generate call; 0 otherwise. */
  sourceIndex: number
  name: string
  mimeType: string
  byteLength: number
  sha256: string
  /** The image model that generated it; null for delivered files. */
  imageModel: string | null
  createdAt: number
}

/** Kept in the tool result of the transcript; resolved through the daemon. */
export interface ResultReference {
  resultId: string
}

export interface ResultListResponse {
  results: AgentResult[]
  total: number
  offset: number
  limit: number
}

/** The most of a text file the daemon previews, in bytes. */
export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024

const TEXT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/javascript',
  'application/x-sh',
  'application/sql',
  'application/x-ndjson',
])

/** Files sent without a text type (`application/octet-stream`) that are text by their name. */
const TEXT_EXTENSIONS = new Set(
  (
    'txt md markdown csv tsv json jsonl ndjson yaml yml toml ini cfg conf log xml css scss ' +
    'js mjs cjs jsx ts tsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 ' +
    'sql r lua pl tex diff patch vue svelte graphql proto dockerfile makefile'
  ).split(' '),
)

/** Pages a browser would run are only ever downloaded, never shown, not even as text. */
const ACTIVE_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml'])

/** Whether Files can show a saved file as text: its type or its name says text, and it is small. */
export function isTextPreview(
  result: Pick<AgentResult, 'mimeType' | 'name' | 'byteLength'>,
): boolean {
  if (result.byteLength > TEXT_PREVIEW_MAX_BYTES) return false
  const type = result.mimeType.toLowerCase()
  if (ACTIVE_TYPES.has(type)) return false
  if (type.startsWith('text/') || TEXT_TYPES.has(type) || /\+(json|xml)$/.test(type)) return true
  if (type !== 'application/octet-stream') return false
  const name = result.name.toLowerCase()
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return TEXT_EXTENSIONS.has(extension)
}

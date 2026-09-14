import type {
  CodingCommandLogPage,
  CodingCommandLogView,
  CodingLogReference,
} from '@bazilion/api-types'

/**
 * Outcome of asking for a retained log.
 *
 * `not-shared` is deliberately distinct from an empty page: a held log must
 * never render as "this command produced no output". The daemon already draws
 * that line (403 vs. an empty page); this keeps it intact through the UI.
 */
export type RetainedCodingLog =
  | { status: 'available'; page: CodingCommandLogPage; view: CodingCommandLogView }
  | { status: 'not-shared' }
  | { status: 'missing' }
  | { status: 'unavailable'; message: string }

/** Bounded first page. Larger reads and search are a later iteration. */
export const CODING_LOG_PAGE_BYTES = 65_536

/**
 * Read a retained coding log through the same-origin `/api` proxy.
 *
 * The daemon stays the authority: it re-checks Team membership and disclosure
 * state on every call, so holding an opaque reference in history grants nothing
 * on its own. `fetchImpl` is injectable for tests.
 */
export async function fetchRetainedCodingLog(
  reference: CodingLogReference,
  fetchImpl: typeof fetch = fetch,
): Promise<RetainedCodingLog> {
  const base = `/api/teams/${encodeURIComponent(reference.teamId)}/coding-commands/${encodeURIComponent(reference.commandId)}/log`
  try {
    const response = await fetchImpl(`${base}?limit=${CODING_LOG_PAGE_BYTES}`, {
      headers: { accept: 'application/json' },
    })
    if (response.status === 403) return { status: 'not-shared' }
    if (response.status === 404) return { status: 'missing' }
    if (!response.ok) return { status: 'unavailable', message: `Request failed (${response.status}).` }
    const body = (await response.json()) as unknown
    const view = readView(body)
    if (!view) return { status: 'unavailable', message: 'Unexpected response from the daemon.' }
    // A null page means the audience may not disclose the bytes — a held log,
    // not an empty one.
    if (field(body, 'page') === null) return { status: 'not-shared' }
    const page = readPage(field(body, 'page'))
    if (!page) return { status: 'unavailable', message: 'Unexpected response from the daemon.' }
    return { status: 'available', page, view }
  } catch {
    return { status: 'unavailable', message: 'The daemon could not be reached.' }
  }
}

function readView(body: unknown): CodingCommandLogView | null {
  const view = field(body, 'view')
  if (!isRecord(view)) return null
  if (typeof view.commandId !== 'string' || typeof view.availability !== 'string') return null
  if (typeof view.byteLength !== 'number') return null
  return view as unknown as CodingCommandLogView
}

function readPage(page: unknown): CodingCommandLogPage | null {
  if (!isRecord(page)) return null
  if (typeof page.text !== 'string' || typeof page.availability !== 'string') return null
  if (typeof page.offset !== 'number' || typeof page.hasMore !== 'boolean') return null
  if (typeof page.byteLength !== 'number') return null
  return page as unknown as CodingCommandLogPage
}

function field(body: unknown, key: string): unknown {
  return isRecord(body) ? body[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

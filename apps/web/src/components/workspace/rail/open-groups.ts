// Which Teams the rail shows open: the user's choice, kept in a cookie so the server renders it.

import { DEFAULT_TEAM_ID } from '@bazilion/api-types'

// Read by the home loader so the first render already has the user's open/closed Teams. The value
// is URL-encoded JSON of Record<teamId, boolean>.
export const SIDEBAR_OPEN_GROUPS_COOKIE = 'bz_sidebar_open_groups'

export function writeOpenGroupsCookie(map: Record<string, boolean>): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain UI preference shared with SSR.
  document.cookie = `${SIDEBAR_OPEN_GROUPS_COOKIE}=${encodeURIComponent(JSON.stringify(map))}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/** An explicit choice wins; otherwise the Team in view and the default Team start open. */
export function isGroupOpen(
  openGroups: Record<string, boolean>,
  teamId: string,
  current: boolean,
): boolean {
  return openGroups[teamId] ?? (current || teamId === DEFAULT_TEAM_ID)
}

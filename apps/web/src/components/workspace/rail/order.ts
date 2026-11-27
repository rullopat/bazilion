// The order the rail lists things in. Teams and their Agents come in the owner's order, as the
// daemon lists them (BAZ-098); a drag or a Move shows at once, before the daemon has it.

import { type Agent, DEFAULT_PROFILE_ID, type Profile, type Team } from '@bazilion/api-types'

/** The seeded default template first: the one-click path for a new install. */
export function sortProfiles(profiles: Profile[]): Profile[] {
  return [...profiles].sort(
    (a, b) => Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID),
  )
}

/** The folded rail's Teams: only those with Agents, in the owner's order, the Team in view first. */
export function slimTeams(teams: Team[], agents: Agent[], inViewId: string | undefined): Team[] {
  const shown = teams.filter((team) => agents.some((agent) => agent.teamId === team.id))
  // The Team in view comes first: its Agents are what the view is about.
  return [...shown].sort((a, b) => Number(b.id === inViewId) - Number(a.id === inViewId))
}

/** `items` in the order `ids` gives; those it does not name keep their place after them. */
export function inOrder<T extends { id: string }>(
  items: readonly T[],
  ids?: readonly string[],
): T[] {
  if (!ids) return [...items]
  const place = new Map(ids.map((id, index) => [id, index]))
  const rank = (item: T) => place.get(item.id) ?? ids.length
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item)
}

/** `ids` with `moved` put just before (or after) `target`; unchanged when either is missing. */
export function moveNextTo(
  ids: readonly string[],
  moved: string,
  target: string,
  after: boolean,
): string[] {
  if (moved === target || !ids.includes(moved) || !ids.includes(target)) return [...ids]
  const rest = ids.filter((id) => id !== moved)
  const at = rest.indexOf(target) + (after ? 1 : 0)
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** `ids` with `moved` one place up (-1) or down (1); unchanged at either end. */
export function moveBy(ids: readonly string[], moved: string, by: -1 | 1): string[] {
  const from = ids.indexOf(moved)
  const to = from + by
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  next[from] = ids[to] as string
  next[to] = moved
  return next
}

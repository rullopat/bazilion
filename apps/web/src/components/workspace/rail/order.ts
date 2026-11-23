// The order the rail lists things in.

import {
  type Agent,
  DEFAULT_PROFILE_ID,
  DEFAULT_TEAM_ID,
  type Profile,
  type Team,
} from '@bazilion/api-types'

/** The Default Team first, then the rest as the daemon lists them. */
export function sortTeams(teams: Team[]): Team[] {
  return [...teams].sort(
    (a, b) => Number(b.id === DEFAULT_TEAM_ID) - Number(a.id === DEFAULT_TEAM_ID),
  )
}

/** The seeded default template first: the one-click path for a new install. */
export function sortProfiles(profiles: Profile[]): Profile[] {
  return [...profiles].sort(
    (a, b) => Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID),
  )
}

/** The folded rail's Teams: only those with Agents, the Team in view first. */
export function slimTeams(teams: Team[], agents: Agent[], inViewId: string | undefined): Team[] {
  const sorted = sortTeams(teams).filter((team) => agents.some((agent) => agent.teamId === team.id))
  // The Team in view comes first: its Agents are what the view is about.
  sorted.sort((a, b) => Number(b.id === inViewId) - Number(a.id === inViewId))
  return sorted
}

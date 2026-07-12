import {
  findTeamPolicyMember,
  type TeamPolicyDocument,
  type TeamPolicyEndpoint,
  type TeamPolicyMember,
  type TeamPolicyPreset,
} from './team-policy'

export const TEAM_POLICY_PRESET_META: Record<
  TeamPolicyPreset,
  { label: string; summary: string }
> = {
  open_team: {
    label: 'Open Team',
    summary: 'Every member can talk to every peer, the user, and other local teams.',
  },
  coordinator: {
    label: 'Coordinator',
    summary: 'The user talks to one coordinator; workers communicate only with that coordinator.',
  },
  review_pipeline: {
    label: 'Review Pipeline',
    summary: 'A directed user -> planner -> worker -> reviewer -> reporter -> user path.',
  },
  blank: {
    label: 'Blank',
    summary: 'No communication edges. Every member starts isolated.',
  },
}

export function teamPolicyMemberLabel(member: TeamPolicyMember): string {
  return member.name || member.agentId || member.slotId
}

export function teamPolicyEndpointLabel(
  teamPolicy: TeamPolicyDocument,
  endpoint: TeamPolicyEndpoint,
): string {
  if (endpoint.kind === 'user') return 'User'
  if (endpoint.kind === 'outside_team') return 'Other teams'
  const member = findTeamPolicyMember(teamPolicy, endpoint)
  return member
    ? teamPolicyMemberLabel(member)
    : endpoint.kind === 'agent'
      ? endpoint.agentId
      : endpoint.slotId
}

export function formatTeamPolicyTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

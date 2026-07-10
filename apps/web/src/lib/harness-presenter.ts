import {
  findHarnessMember,
  type HarnessDocument,
  type HarnessEndpoint,
  type HarnessMember,
  type HarnessPreset,
} from './harness-prototype'

export const HARNESS_PRESET_META: Record<
  HarnessPreset,
  { label: string; summary: string }
> = {
  open_team: {
    label: 'Open Team',
    summary: 'Every member can talk to every peer, the user, and other local groups.',
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

export function harnessMemberLabel(member: HarnessMember): string {
  return member.name || member.agentId || member.slotId
}

export function harnessEndpointLabel(
  harness: HarnessDocument,
  endpoint: HarnessEndpoint,
): string {
  if (endpoint.kind === 'user') return 'User'
  if (endpoint.kind === 'outside_group') return 'Other groups'
  const member = findHarnessMember(harness, endpoint)
  return member
    ? harnessMemberLabel(member)
    : endpoint.kind === 'agent'
      ? endpoint.agentId
      : endpoint.slotId
}

export function formatHarnessTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

import type { TeamTemplateDetail, Profile, ResolvedTeamPolicy } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  liveDocument,
  liveEdges,
  sameDocument,
  templateDefinition,
  templateDocument,
} from '../src/lib/canonical-team'

const profile: Profile = {
  id: 'profile',
  name: 'Profile',
  dir: '/profiles/profile',
  defaultModel: 'provider:model',
  skillsMode: 'selected',
  createdAt: 1,
  updatedAt: 1,
}

describe('canonical teamPolicy web adapter', () => {
  test('preserves stable Team slot ids and translates only their wire endpoint kind', () => {
    const detail: TeamTemplateDetail = {
      template: {
        id: 'team',
        name: 'Team',
        userMd: null,
        currentRevision: 3,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
      slots: [slot('slot-a', 'one', 0), slot('slot-b', 'two', 1)],
      edges: [
        {
          templateId: 'team',
          sourceKind: 'slot',
          sourceId: 'slot-a',
          targetKind: 'slot',
          targetId: 'slot-b',
        },
      ],
      currentSnapshot: {
        templateId: 'team',
        revision: 3,
        name: 'Team',
        userMd: null,
        slots: [slot('slot-a', 'one', 0), slot('slot-b', 'two', 1)],
        edges: [],
        createdAt: 2,
      },
    }
    const document = templateDocument(detail)
    expect(document.members.map((member) => member.slotId)).toEqual(['slot-a', 'slot-b'])
    expect(document.members.every((member) => member.agentId === undefined)).toBe(true)
    expect(templateDefinition(document, [profile])).toMatchObject({
      slots: [{ slotId: 'slot-a' }, { slotId: 'slot-b' }],
      edges: [
        {
          sourceKind: 'slot',
          sourceId: 'slot-a',
          targetKind: 'slot',
          targetId: 'slot-b',
        },
      ],
    })
  })

  test('keeps live Agent ids distinct and round-trips effective edges', () => {
    const detail: ResolvedTeamPolicy = {
      teamPolicy: {
        teamId: 'team',
        revision: 4,
        baselineInstantiationId: null,
        updatedAt: 2,
      },
      edges: [
        {
          teamId: 'team',
          sourceKind: 'user',
          sourceId: null,
          targetKind: 'agent',
          targetId: 'agent-a',
        },
      ],
      instantiations: [],
      bindings: [],
      agentState: [],
      baseline: null,
      members: [agent('agent-a', 'one'), agent('agent-b', 'two')],
    }
    const document = liveDocument('team', detail)
    expect(document.members.map((member) => member.agentId)).toEqual(['agent-a', 'agent-b'])
    expect(document.members.map((member) => member.slotId)).toEqual([
      'agent:agent-a',
      'agent:agent-b',
    ])
    expect(liveEdges(document)).toEqual([
      {
        sourceKind: 'user',
        sourceId: null,
        targetKind: 'agent',
        targetId: 'agent-a',
        posture: 'allow',
      },
    ])
  })

  test('uses request-local keys for new slots and infers a persisted Open Team preset', () => {
    const detail: TeamTemplateDetail = {
      template: {
        id: 'team',
        name: 'Team',
        userMd: null,
        currentRevision: 2,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
      slots: [slot('slot-a', 'one', 0)],
      edges: [
        templateEdge('user', null, 'slot', 'slot-a'),
        templateEdge('slot', 'slot-a', 'user', null),
        templateEdge('outside_team', null, 'slot', 'slot-a'),
        templateEdge('slot', 'slot-a', 'outside_team', null),
      ],
      currentSnapshot: {
        templateId: 'team',
        revision: 2,
        name: 'Team',
        userMd: null,
        slots: [slot('slot-a', 'one', 0)],
        edges: [],
        createdAt: 2,
      },
    }
    const document = templateDocument(detail)
    expect(document.preset).toBe('open_team')
    document.members.push({
      slotId: 'draft:new-slot',
      profileId: 'profile',
      name: 'two',
      position: { x: 1, y: 2 },
    })
    expect(templateDefinition(document, [profile]).slots[1]).toMatchObject({
      clientKey: 'draft:new-slot',
    })
    expect(templateDefinition(document, [profile]).slots[1]).not.toHaveProperty('slotId')
  })

  test('draft comparison includes layout and directed policy changes', () => {
    const detail = {
      teamPolicy: {
        teamId: 'team',
        revision: 1,
        baselineInstantiationId: null,
        updatedAt: 2,
      },
      edges: [],
      instantiations: [],
      bindings: [],
      agentState: [],
      baseline: null,
      members: [agent('agent-a', 'one')],
    }
    const effective = liveDocument('team', detail)
    expect(sameDocument(effective, effective)).toBe(true)
    expect(
      sameDocument(effective, {
        ...effective,
        members: effective.members.map((member) => ({
          ...member,
          position: { x: member.position.x + 1, y: member.position.y },
        })),
      }),
    ).toBe(false)
  })
})

function slot(slotId: string, name: string, position: number) {
  return {
    templateId: 'team',
    slotId,
    position,
    profileId: 'profile',
    agentName: name,
    modelOverride: null,
    reasoningLevel: null,
    layoutPosition: null,
    display: null,
    tombstonedAt: null,
  }
}

function agent(id: string, name: string) {
  return {
    id,
    name,
    profileId: 'profile',
    teamId: 'team',
    modelOverride: null,
    reasoningLevel: 'medium' as const,
    telegramMirrorMode: 'minimal' as const,
    status: 'idle' as const,
    createdAt: 1,
    updatedAt: 1,
  }
}

function templateEdge(
  sourceKind: 'user' | 'outside_team' | 'slot',
  sourceId: string | null,
  targetKind: 'user' | 'outside_team' | 'slot',
  targetId: string | null,
) {
  return { templateId: 'team', sourceKind, sourceId, targetKind, targetId, posture: 'allow' as const }
}

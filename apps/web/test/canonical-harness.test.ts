import type { HarnessTemplateDetail, Profile, ResolvedGroupHarness } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  liveDocument,
  liveEdges,
  sameDocument,
  templateDefinition,
  templateDocument,
} from '../src/lib/canonical-harness'

const profile: Profile = {
  id: 'profile',
  name: 'Profile',
  dir: '/profiles/profile',
  defaultModel: 'provider:model',
  skillsMode: 'selected',
  createdAt: 1,
  updatedAt: 1,
}

describe('canonical harness web adapter', () => {
  test('preserves stable Team slot ids and translates only their wire endpoint kind', () => {
    const detail: HarnessTemplateDetail = {
      template: {
        id: 'team',
        name: 'Team',
        userMd: null,
        currentRevision: 3,
        compatibilityManaged: false,
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
    const detail: ResolvedGroupHarness = {
      harness: {
        groupId: 'group',
        revision: 4,
        membershipMode: 'explicit',
        baselineInstantiationId: null,
        updatedAt: 2,
      },
      edges: [
        {
          groupId: 'group',
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
    const document = liveDocument('group', detail)
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
      },
    ])
  })

  test('draft comparison includes layout and directed policy changes', () => {
    const detail = {
      harness: {
        groupId: 'group',
        revision: 1,
        membershipMode: 'explicit' as const,
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
    const effective = liveDocument('group', detail)
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
    groupId: 'group',
    modelOverride: null,
    reasoningLevel: 'medium' as const,
    telegramMirrorMode: 'minimal' as const,
    status: 'idle' as const,
    createdAt: 1,
    updatedAt: 1,
  }
}

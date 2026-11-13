import type { Agent, Profile, TeamPolicy, TeamTemplate } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  liveDocument,
  liveEdges,
  sameDocument,
  setEdge,
  templateDocument,
  templateInput,
} from '../src/lib/team-policy'

const profile: Profile = {
  id: 'profile',
  name: 'Profile',
  dir: '/profiles/profile',
  defaultModel: 'provider:model',
  skillsMode: 'selected',
  createdAt: 1,
  updatedAt: 1,
}

describe('team policy editor document', () => {
  test('a template round-trips its slots by position and its edges, outside included', () => {
    const document = templateDocument(template())
    expect(document.members.map((member) => member.name)).toEqual(['one', 'two'])
    expect(document.edges).toEqual([
      { from: 'slot:0', to: 'slot:1' },
      { from: 'slot:1', to: 'outside' },
    ])
    expect(templateInput(document, [profile])).toMatchObject({
      name: 'Team',
      policyMode: 'restricted',
      slots: [{ agentName: 'one' }, { agentName: 'two' }],
      edges: [
        { from: 0, to: 1 },
        { from: 1, to: 'outside' },
      ],
    })
  })

  test('removing a template slot renumbers the edges of the slots after it', () => {
    const document = templateDocument(template())
    const withoutFirst = {
      ...document,
      members: document.members.slice(1),
      edges: document.edges.filter((edge) => edge.from !== 'slot:0' && edge.to !== 'slot:0'),
    }
    expect(templateInput(withoutFirst, [profile]).edges).toEqual([{ from: 0, to: 'outside' }])
  })

  test('a template slot without a known Agent template cannot be saved', () => {
    expect(() => templateInput(templateDocument(template()), [])).toThrow(/Missing Agent template/)
  })

  test('a live Team keeps Agent ids as endpoints', () => {
    const document = liveDocument(livePolicy())
    expect(document.members.map((member) => member.key)).toEqual(['agent-a', 'agent-b'])
    expect(liveEdges(document)).toEqual([{ from: 'agent-a', to: 'outside' }])
  })

  test('dragging a live Team node is not a change, but mode and edges are', () => {
    const saved = liveDocument(livePolicy())
    const dragged = {
      ...saved,
      members: saved.members.map((member) => ({
        ...member,
        position: { x: member.position.x + 50, y: member.position.y },
      })),
    }
    expect(sameDocument(saved, dragged)).toBe(true)
    expect(sameDocument(saved, { ...saved, mode: 'restricted' })).toBe(false)
    expect(sameDocument(saved, setEdge(saved, 'agent-b', 'agent-a', true))).toBe(false)
  })

  test('moving a template node is a change because templates store their layout', () => {
    const saved = templateDocument(template())
    const moved = {
      ...saved,
      members: saved.members.map((member, index) =>
        index === 0 ? { ...member, position: { x: 999, y: 1 } } : member,
      ),
    }
    expect(sameDocument(saved, moved)).toBe(false)
  })

  test('an endpoint never gets an edge to itself', () => {
    const document = liveDocument(livePolicy())
    expect(setEdge(document, 'agent-a', 'agent-a', true)).toBe(document)
    expect(setEdge(document, 'outside', 'outside', true)).toBe(document)
    const removed = setEdge(document, 'agent-a', 'outside', false)
    expect(removed.edges).toEqual([])
  })
})

function template(): TeamTemplate {
  return {
    id: 'team',
    name: 'Team',
    userMd: null,
    policyMode: 'restricted',
    slots: [slot('one'), slot('two')],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 'outside' },
    ],
    createdAt: 1,
    updatedAt: 2,
  }
}

function slot(agentName: string) {
  return {
    profileId: 'profile',
    agentName,
    modelOverride: null,
    reasoningLevel: null,
    layoutPosition: null,
  }
}

function livePolicy(): TeamPolicy {
  return {
    teamId: 'team',
    mode: 'open',
    edges: [{ from: 'agent-a', to: 'outside' }],
    members: [agent('agent-a', 'one'), agent('agent-b', 'two')],
  }
}

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    profileId: 'profile',
    teamId: 'team',
    modelOverride: null,
    reasoningLevel: 'medium',
    reviewEnabled: false,
    reviewEveryNTurns: 10,
    reviewModel: null,
    reviewReasoningLevel: 'medium',
    reviewTurnsSinceLast: 0,
    status: 'idle',
    dir: `/agents/${id}`,
    telegramTopicId: null,
    telegramMirrorMode: 'minimal',
    telegramIconEmoji: null,
    createdAt: 1,
    archivedAt: null,
  }
}

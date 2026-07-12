import type { TeamTemplateDetail } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  exportTeamDocument,
  parseTeamDocument,
  parseTeamPolicyDocument,
  teamImportBody,
} from '../src/team-interchange.ts'

const detail: TeamTemplateDetail = {
  template: {
    id: 'pair',
    name: 'Pair',
    userMd: '# context',
    currentRevision: 2,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 2,
  },
  slots: [
    {
      templateId: 'pair',
      slotId: 'server-a',
      position: 0,
      profileId: 'same-profile',
      agentName: 'one',
      modelOverride: null,
      reasoningLevel: null,
      layoutPosition: { x: 1, y: 2 },
      display: null,
      tombstonedAt: null,
    },
    {
      templateId: 'pair',
      slotId: 'server-b',
      position: 1,
      profileId: 'same-profile',
      agentName: 'two',
      modelOverride: 'provider:model',
      reasoningLevel: 'high',
      layoutPosition: null,
      display: { color: 'blue' },
      tombstonedAt: null,
    },
  ],
  edges: [
    {
      templateId: 'pair',
      sourceKind: 'slot',
      sourceId: 'server-a',
      targetKind: 'slot',
      targetId: 'server-b',
      posture: 'allow',
    },
  ],
  currentSnapshot: {
    templateId: 'pair',
    revision: 2,
    name: 'Pair',
    userMd: '# context',
    slots: [],
    edges: [],
    createdAt: 2,
  },
}

test('Team export is portable and dry-run import is semantically lossless with repeated profiles', () => {
  const exported = exportTeamDocument(detail)
  expect(JSON.stringify(exported)).not.toContain('server-a')
  expect(exported.slots.map((slot) => slot.profileId)).toEqual(['same-profile', 'same-profile'])
  const parsed = parseTeamDocument(JSON.parse(JSON.stringify(exported)))
  const body = teamImportBody(parsed, detail)
  expect(body.slots.map((slot) => slot.slotId)).toEqual(['server-a', 'server-b'])
  expect(body.edges).toEqual([
    {
      sourceKind: 'slot',
      sourceId: 'server-a',
      targetKind: 'slot',
      targetId: 'server-b',
      posture: 'allow',
    },
  ])
})

describe.each([
  'open_team',
  'coordinator',
  'review_pipeline',
  'blank',
])('%s preset-shaped interchange', () => {
  test('round trips its resolved edge set without storing preset implementation state', () => {
    expect(parseTeamDocument(exportTeamDocument(detail))).toEqual(exportTeamDocument(detail))
  })
})

test.each([
  ['unknown version', { ...exportTeamDocument(detail), version: 2 }, /unsupported/],
  [
    'invalid kind',
    { ...exportTeamDocument(detail), kind: 'bazilion.team-policy' },
    /invalid document kind/,
  ],
  [
    'missing slot',
    {
      ...exportTeamDocument(detail),
      edges: [
        {
          sourceKind: 'slot',
          sourceKey: 'missing',
          targetKind: 'slot',
          targetKey: 'slot-1',
        },
      ],
    },
    /missing slot/,
  ],
  [
    'self edge',
    {
      ...exportTeamDocument(detail),
      edges: [
        {
          sourceKind: 'slot',
          sourceKey: 'slot-1',
          targetKind: 'slot',
          targetKey: 'slot-1',
        },
      ],
    },
    /self edge/,
  ],
  [
    'duplicate edge',
    {
      ...exportTeamDocument(detail),
      edges: [exportTeamDocument(detail).edges[0], exportTeamDocument(detail).edges[0]],
    },
    /duplicate edge/,
  ],
])('rejects %s before mutation', (_label, document, expected) => {
  expect(() => parseTeamDocument(document)).toThrow(expected)
})

test('Team policy validation rejects portable Agent self edges', () => {
  expect(() =>
    parseTeamPolicyDocument({
      version: 1,
      kind: 'bazilion.team-policy',
      teamId: 'g',
      expectedRevision: 1,
      edges: [
        {
          sourceKind: 'agent',
          sourceId: 'a',
          targetKind: 'agent',
          targetId: 'a',
        },
      ],
    }),
  ).toThrow(/self edge/)
})

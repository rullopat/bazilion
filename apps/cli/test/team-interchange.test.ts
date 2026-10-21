import type { TeamTemplateDetail } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  edgeDiff,
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

test('delimiter-shaped slot keys preserve distinct directed edges', () => {
  const doc = exportTeamDocument(detail)
  const slot = doc.slots[0]
  if (!slot) throw new Error('Missing fixture slot')
  doc.slots = ['a->slot:b', 'c', 'a', 'b->slot:c'].map((key) => ({ ...slot, key }))
  doc.edges = [
    {
      sourceKind: 'slot',
      sourceKey: 'a->slot:b',
      targetKind: 'slot',
      targetKey: 'c',
      posture: 'allow',
    },
    {
      sourceKind: 'slot',
      sourceKey: 'a',
      targetKind: 'slot',
      targetKey: 'b->slot:c',
      posture: 'allow',
    },
  ]
  expect(parseTeamDocument(doc).edges).toHaveLength(2)
})

test('delimiter-shaped identifiers cannot hide an edge diff', () => {
  const before = [
    { sourceKind: 'slot', sourceId: 'a -> slot:b', targetKind: 'slot', targetId: 'c' },
  ]
  const after = [{ sourceKind: 'slot', sourceId: 'a', targetKind: 'slot', targetId: 'b -> slot:c' }]
  expect(edgeDiff(before, after).added).toHaveLength(1)
  expect(edgeDiff(before, after).removed).toHaveLength(1)
})

test('portable slot mapping uses recorded position rather than incidental array order', () => {
  const exported = exportTeamDocument(detail)
  const reordered = { ...detail, slots: [...detail.slots].reverse() }
  expect(teamImportBody(exported, reordered).slots.map((slot) => slot.slotId)).toEqual([
    'server-a',
    'server-b',
  ])
  expect(exportTeamDocument(reordered).slots.map((slot) => slot.key)).toEqual(['slot-2', 'slot-1'])
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

const liveDocument = {
  version: 1,
  kind: 'bazilion.team-policy',
  teamId: 'g',
  expectedRevision: 1,
  edges: [{ sourceKind: 'user', sourceId: null, targetKind: 'agent', targetId: 'a' }],
}

test.each([
  'allow',
  'approval_required',
] as const)('live policy import preserves explicit %s posture rather than downgrading it', (posture) => {
  const document = { ...liveDocument, edges: [{ ...liveDocument.edges[0], posture }] }
  expect(parseTeamPolicyDocument(JSON.parse(JSON.stringify(document))).edges[0]?.posture).toBe(
    posture,
  )
})

test('only omitted live posture defaults to allow', () => {
  expect(parseTeamPolicyDocument(liveDocument).edges[0]?.posture).toBe('allow')
})

test.each(
  [null, false, true, 0, [], {}, 'deny', 'ALLOW', 'approvalRequired'].map((posture) => ({
    posture,
  })),
)('live policy import refuses invalid posture $posture before mutation', ({ posture }) => {
  const document = { ...liveDocument, edges: [{ ...liveDocument.edges[0], posture }] }
  expect(() => parseTeamPolicyDocument(document)).toThrow(/invalid posture/)
})

test('empty non-resource endpoint ids cannot bypass self-edge validation', () => {
  expect(() =>
    parseTeamPolicyDocument({
      ...liveDocument,
      edges: [{ sourceKind: 'user', sourceId: null, targetKind: 'user', targetId: '' }],
    }),
  ).toThrow()
  expect(() =>
    parseTeamDocument({
      ...exportTeamDocument(detail),
      edges: [{ sourceKind: 'user', sourceKey: null, targetKind: 'user', targetKey: '' }],
    }),
  ).toThrow()
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

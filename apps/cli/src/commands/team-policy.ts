import { readFileSync } from 'node:fs'
import type {
  CommunicationAuthorizationResult,
  CommunicationEndpoint,
  PutGroupTeamPolicyPolicyRequest,
  ResolvedTeamPolicy,
  TeamPolicyBlockPage,
  TeamPolicyDetail,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { edgeDiff, exportTeamPolicy, parseTeamPolicyDocument } from '../team-interchange.ts'

interface TeamPolicyDiff {
  liveRevision: number
  baseline: { templateId: string; templateRevision: number } | null
  currentSource: { template: { currentRevision: number } } | null
  sourceDiverged: boolean
  comparison: {
    addedSinceBaseline: unknown[]
    removedSinceBaseline: unknown[]
    currentSourceAddedSlotIds: string[]
    currentSourceRemovedSlotIds: string[]
  }
  [key: string]: unknown
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`invalid JSON: ${(error as Error).message}`)
  }
}

function endpoint(value: string, teamId: string): CommunicationEndpoint {
  if (value === 'user') return { kind: 'user', teamId }
  if (value.startsWith('agent:') && value.length > 6) return { kind: 'agent', id: value.slice(6) }
  if (value.startsWith('outside:') && value.length > 8)
    return { kind: 'outside_team', teamId: value.slice(8) }
  throw new Error('endpoint must be user, agent:<id>, or outside:<team-id>')
}

function printPolicy(detail: ResolvedTeamPolicy): void {
  console.log(`# Team ${detail.teamPolicy.teamId} policy`)
  console.log(`revision:   ${detail.teamPolicy.revision}`)
  console.log(
    `baseline:   ${detail.baseline ? `${detail.baseline.templateId}@${detail.baseline.templateRevision}` : '(none)'}`,
  )
  console.log(`members:    ${detail.members.length}`)
  console.log(`edges:      ${detail.edges.length}`)
  if (detail.edges.length) {
    console.log('')
    for (const line of columnize([
      ['source', 'target'],
      ...detail.edges.map((edge) => [
        `${edge.sourceKind}:${edge.sourceId ?? '-'}`,
        `${edge.targetKind}:${edge.targetId ?? '-'}`,
      ]),
    ]))
      console.log(line)
  }
}

const show = defineCommand({
  meta: { name: 'show', description: 'Show the one effective live policy for a Team' },
  args: {
    team: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit the canonical aggregate as JSON' },
  },
  async run({ args }) {
    const detail = await createClient().get<ResolvedTeamPolicy>(
      `/api/teams/${encodeURIComponent(args.team)}/policy`,
    )
    if (args.json) console.log(JSON.stringify(detail, null, 2))
    else printPolicy(detail)
  },
})

const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Export a revisioned Team policy document' },
  args: { team: { type: 'positional', required: true } },
  async run({ args }) {
    const detail = await createClient().get<TeamPolicyDetail>(
      `/api/teams/${encodeURIComponent(args.team)}/policy`,
    )
    console.log(
      JSON.stringify(
        exportTeamPolicy(args.team, detail.teamPolicy.revision, detail.edges),
        null,
        2,
      ),
    )
  },
})

function printEdgeDiff(
  current: TeamPolicyDetail,
  edges: ReturnType<typeof parseTeamPolicyDocument>['edges'],
): void {
  const diff = edgeDiff(current.edges, edges)
  console.log(`Team: ${current.teamPolicy.teamId}`)
  console.log(`Revision: ${current.teamPolicy.revision}`)
  console.log(`Edges: +${diff.added.length} -${diff.removed.length}`)
  for (const value of diff.added) console.log(`  + ${value}`)
  for (const value of diff.removed) console.log(`  - ${value}`)
}

const importCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Validate, diff, and explicitly replace a Team policy',
  },
  args: {
    team: { type: 'positional', required: true },
    file: { type: 'positional', required: true },
    'dry-run': { type: 'boolean', description: 'Validate and print the diff only' },
    apply: { type: 'boolean', description: 'Apply non-interactively after printing the diff' },
    'expected-revision': {
      type: 'string',
      description: 'Expected current Team revision (defaults to document revision)',
    },
    force: {
      type: 'boolean',
      description: 'Refetch current revision; requires --apply and still uses optimistic locking',
    },
    'confirm-current-revision': {
      type: 'string',
      description: 'Second force confirmation: the freshly displayed current revision',
    },
  },
  async run({ args }) {
    if (args.force && !args.apply)
      throw new Error('--force requires --apply (interactive force is intentionally unsupported)')
    const document = parseTeamPolicyDocument(readJson(args.file))
    if (document.teamId !== args.team)
      throw new Error(`document belongs to Team ${document.teamId}, not ${args.team}`)
    const client = createClient()
    const current = await client.get<TeamPolicyDetail>(
      `/api/teams/${encodeURIComponent(args.team)}/policy`,
    )
    printEdgeDiff(current, document.edges)
    if (args['dry-run']) return console.log('valid: no changes applied')
    if (!args.apply) throw new Error('refusing mutation: review the diff, then pass --apply')
    const supplied = args['expected-revision']
      ? Number.parseInt(args['expected-revision'], 10)
      : document.expectedRevision
    const expectedRevision = args.force ? current.teamPolicy.revision : supplied
    if (
      args.force &&
      Number.parseInt(args['confirm-current-revision'] ?? '', 10) !== current.teamPolicy.revision
    )
      throw new Error(
        `--force requires --confirm-current-revision ${current.teamPolicy.revision} after reviewing the fresh diff`,
      )
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('expected revision must be a positive integer')
    const body: PutGroupTeamPolicyPolicyRequest = {
      expectedRevision,
      edges: document.edges,
    }
    const updated = await client.put<TeamPolicyDetail>(
      `/api/teams/${encodeURIComponent(args.team)}/policy`,
      body,
    )
    console.log(`updated Team ${args.team} policy to revision ${updated.teamPolicy.revision}`)
  },
})

const diff = defineCommand({
  meta: { name: 'diff', description: 'Compare live policy with its retained baseline source' },
  args: {
    team: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit canonical diff JSON' },
  },
  async run({ args }) {
    const result = await createClient().get<TeamPolicyDiff>(
      `/api/teams/${encodeURIComponent(args.team)}/policy/diff`,
    )
    if (args.json) return console.log(JSON.stringify(result, null, 2))
    console.log(`# Team ${args.team} source diff`)
    console.log(
      `status:   ${result.baseline ? (result.sourceDiverged ? 'source diverged' : 'source current') : 'no baseline'}`,
    )
    console.log(`revision: ${result.liveRevision}`)
    console.log(
      `edges:    +${result.comparison.addedSinceBaseline.length} -${result.comparison.removedSinceBaseline.length}`,
    )
    console.log(
      `slots:    +${result.comparison.currentSourceAddedSlotIds.length} -${result.comparison.currentSourceRemovedSlotIds.length}`,
    )
  },
})

const evaluate = defineCommand({
  meta: {
    name: 'evaluate',
    description: 'Evaluate a communication path without sending or recording a block',
  },
  args: {
    team: { type: 'positional', required: true, description: 'Owning Team for context' },
    source: { type: 'string', required: true, description: 'user | agent:<id> | outside:<team>' },
    target: { type: 'string', required: true, description: 'user | agent:<id> | outside:<team>' },
    origin: { type: 'string', default: 'cli-diagnostic' },
    json: { type: 'boolean', description: 'Emit decision JSON' },
  },
  async run({ args }) {
    const result = await createClient().post<CommunicationAuthorizationResult>(
      '/api/communication/evaluate',
      {
        source: endpoint(args.source, args.team),
        target: endpoint(args.target, args.team),
        origin: args.origin,
        attemptKind: 'cli_evaluate',
        attemptId: `diagnostic:${args.team}`,
      },
    )
    if (args.json) return console.log(JSON.stringify(result, null, 2))
    console.log(`${result.decision.toUpperCase()} ${result.channel}: ${result.reasonCode}`)
    console.log(result.reason)
    console.log(
      `policy revisions: ${result.policyRefs.map((ref) => `${ref.teamId}@${ref.revision}`).join(', ') || '-'}`,
    )
  },
})

const blocks = defineCommand({
  meta: { name: 'blocks', description: 'List paginated durable communication denials' },
  args: {
    team: { type: 'positional', required: true },
    limit: { type: 'string', default: '50' },
    cursor: { type: 'string' },
    source: { type: 'string' },
    target: { type: 'string' },
    channel: { type: 'string' },
    origin: { type: 'string' },
    reason: { type: 'string', description: 'Reason code' },
    from: { type: 'string', description: 'Epoch milliseconds or ISO timestamp' },
    to: { type: 'string', description: 'Epoch milliseconds or ISO timestamp' },
    json: { type: 'boolean', description: 'Emit page JSON including nextCursor' },
  },
  async run({ args }) {
    const query = new URLSearchParams({ limit: args.limit })
    for (const [key, value] of [
      ['cursor', args.cursor],
      ['source', args.source],
      ['target', args.target],
      ['channel', args.channel],
      ['origin', args.origin],
      ['reasonCode', args.reason],
      ['from', args.from],
      ['to', args.to],
    ] as const)
      if (value) query.set(key, value)
    const page = await createClient().get<TeamPolicyBlockPage>(
      `/api/teams/${encodeURIComponent(args.team)}/policy/blocks?${query}`,
    )
    if (args.json) return console.log(JSON.stringify(page, null, 2))
    if (!page.blocks.length) console.log('(no blocks)')
    else
      for (const line of columnize([
        ['time', 'source', 'target', 'channel', 'origin', 'reason'],
        ...page.blocks.map((block) => [
          new Date(block.created_at).toISOString(),
          `${block.source_kind}:${block.source_id ?? '-'}`,
          `${block.target_kind}:${block.target_id ?? '-'}`,
          block.channel,
          block.origin,
          block.reason_code,
        ]),
      ]))
        console.log(line)
    if (page.nextCursor) console.log(`next cursor: ${page.nextCursor}`)
  },
})

export const teamPolicyCommand = defineCommand({
  meta: { name: 'policy', description: 'Inspect and manage the Team-owned live policy' },
  subCommands: {
    show,
    export: exportCommand,
    import: importCommand,
    diff,
    evaluate,
    blocks,
  },
})

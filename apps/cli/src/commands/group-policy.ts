import { readFileSync } from 'node:fs'
import type {
  CommunicationAuthorizationResult,
  CommunicationEndpoint,
  HarnessBlockPage,
  LiveHarnessDetail,
  PutGroupHarnessPolicyRequest,
  ResolvedGroupHarness,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { edgeDiff, exportGroupPolicy, parseGroupPolicyDocument } from '../harness-interchange.ts'

interface HarnessDiff {
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

function endpoint(value: string, groupId: string): CommunicationEndpoint {
  if (value === 'user') return { kind: 'user', groupId }
  if (value.startsWith('agent:') && value.length > 6) return { kind: 'agent', id: value.slice(6) }
  if (value.startsWith('outside:') && value.length > 8)
    return { kind: 'outside_group', groupId: value.slice(8) }
  throw new Error('endpoint must be user, agent:<id>, or outside:<group-id>')
}

function printPolicy(detail: ResolvedGroupHarness): void {
  console.log(`# Group ${detail.harness.groupId} policy`)
  console.log(`revision:   ${detail.harness.revision}`)
  console.log(`membership: ${detail.harness.membershipMode}`)
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
  meta: { name: 'show', description: 'Show the one effective live policy for a Group' },
  args: {
    group: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit the canonical aggregate as JSON' },
  },
  async run({ args }) {
    const detail = await createClient().get<ResolvedGroupHarness>(
      `/api/groups/${encodeURIComponent(args.group)}/harness`,
    )
    if (args.json) console.log(JSON.stringify(detail, null, 2))
    else printPolicy(detail)
  },
})

const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Export a revisioned Group policy document' },
  args: { group: { type: 'positional', required: true } },
  async run({ args }) {
    const detail = await createClient().get<LiveHarnessDetail>(
      `/api/groups/${encodeURIComponent(args.group)}/harness`,
    )
    console.log(
      JSON.stringify(exportGroupPolicy(args.group, detail.harness.revision, detail.edges), null, 2),
    )
  },
})

function printEdgeDiff(
  current: LiveHarnessDetail,
  edges: ReturnType<typeof parseGroupPolicyDocument>['edges'],
): void {
  const diff = edgeDiff(current.edges, edges)
  console.log(`Group: ${current.harness.groupId}`)
  console.log(`Revision: ${current.harness.revision}`)
  console.log(`Edges: +${diff.added.length} -${diff.removed.length}`)
  for (const value of diff.added) console.log(`  + ${value}`)
  for (const value of diff.removed) console.log(`  - ${value}`)
}

const importCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Validate, diff, and explicitly replace a Group policy',
  },
  args: {
    group: { type: 'positional', required: true },
    file: { type: 'positional', required: true },
    'dry-run': { type: 'boolean', description: 'Validate and print the diff only' },
    apply: { type: 'boolean', description: 'Apply non-interactively after printing the diff' },
    'expected-revision': {
      type: 'string',
      description: 'Expected current Group revision (defaults to document revision)',
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
    const document = parseGroupPolicyDocument(readJson(args.file))
    if (document.groupId !== args.group)
      throw new Error(`document belongs to Group ${document.groupId}, not ${args.group}`)
    const client = createClient()
    const current = await client.get<LiveHarnessDetail>(
      `/api/groups/${encodeURIComponent(args.group)}/harness`,
    )
    printEdgeDiff(current, document.edges)
    if (args['dry-run']) return console.log('valid: no changes applied')
    if (!args.apply) throw new Error('refusing mutation: review the diff, then pass --apply')
    const supplied = args['expected-revision']
      ? Number.parseInt(args['expected-revision'], 10)
      : document.expectedRevision
    const expectedRevision = args.force ? current.harness.revision : supplied
    if (
      args.force &&
      Number.parseInt(args['confirm-current-revision'] ?? '', 10) !== current.harness.revision
    )
      throw new Error(
        `--force requires --confirm-current-revision ${current.harness.revision} after reviewing the fresh diff`,
      )
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('expected revision must be a positive integer')
    const body: PutGroupHarnessPolicyRequest = {
      expectedRevision,
      edges: document.edges,
    }
    const updated = await client.put<LiveHarnessDetail>(
      `/api/groups/${encodeURIComponent(args.group)}/harness/policy`,
      body,
    )
    console.log(`updated Group ${args.group} policy to revision ${updated.harness.revision}`)
  },
})

const diff = defineCommand({
  meta: { name: 'diff', description: 'Compare live policy with its retained baseline source' },
  args: {
    group: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit canonical diff JSON' },
  },
  async run({ args }) {
    const result = await createClient().get<HarnessDiff>(
      `/api/groups/${encodeURIComponent(args.group)}/harness/diff`,
    )
    if (args.json) return console.log(JSON.stringify(result, null, 2))
    console.log(`# Group ${args.group} source diff`)
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
    group: { type: 'positional', required: true, description: 'Owning Group for context' },
    source: { type: 'string', required: true, description: 'user | agent:<id> | outside:<group>' },
    target: { type: 'string', required: true, description: 'user | agent:<id> | outside:<group>' },
    origin: { type: 'string', default: 'cli-diagnostic' },
    json: { type: 'boolean', description: 'Emit decision JSON' },
  },
  async run({ args }) {
    const result = await createClient().post<CommunicationAuthorizationResult>(
      '/api/communication/evaluate',
      {
        source: endpoint(args.source, args.group),
        target: endpoint(args.target, args.group),
        origin: args.origin,
        attemptKind: 'cli_evaluate',
        attemptId: `diagnostic:${args.group}`,
      },
    )
    if (args.json) return console.log(JSON.stringify(result, null, 2))
    console.log(`${result.decision.toUpperCase()} ${result.channel}: ${result.reasonCode}`)
    console.log(result.reason)
    console.log(
      `policy revisions: ${result.policyRefs.map((ref) => `${ref.groupId}@${ref.revision}`).join(', ') || '-'}`,
    )
  },
})

const blocks = defineCommand({
  meta: { name: 'blocks', description: 'List paginated durable communication denials' },
  args: {
    group: { type: 'positional', required: true },
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
    const page = await createClient().get<HarnessBlockPage>(
      `/api/groups/${encodeURIComponent(args.group)}/harness/blocks?${query}`,
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

export const groupPolicyCommand = defineCommand({
  meta: { name: 'policy', description: 'Inspect and manage the Group-owned live policy' },
  subCommands: {
    show,
    export: exportCommand,
    import: importCommand,
    diff,
    evaluate,
    blocks,
  },
})

import type {
  AddReviewFindingRequest,
  RecordReviewConclusionRequest,
  ReviewPacketListResponse,
  ReviewPacketReport,
  ReviewPacketResponse,
  ReviewSeverity,
  SourceSnapshotListResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

// BAZ-043: revision-bound review packets from the CLI, with parity against the API.
//
// `packet` is a namespace of its own rather than more verbs on `team review`, because a packet is a
// different object from a repository change: `team review` inspects the working tree, while a packet is
// a captured revision plus findings.

const slug = { id: { type: 'positional', required: true, description: 'Team slug' } } as const
const packetId = {
  packetId: { type: 'positional', required: true, description: 'Review packet id' },
} as const

const SEVERITIES = ['blocker', 'major', 'minor', 'info'] as const

function printReport(report: ReviewPacketReport): void {
  const packet = report.packet
  const requester =
    packet.requester.kind === 'agent' ? `agent ${packet.requester.agentId}` : 'operator'
  console.log(`${packet.id}  ${packet.state}${report.applicability.stale ? '  (stale)' : ''}`)
  console.log(
    `  change:   snapshot ${packet.snapshot.id} (base ${packet.snapshot.baseOid.slice(0, 12)}${
      packet.snapshot.complete ? '' : ', INCOMPLETE COVERAGE'
    })`,
  )
  console.log(`  reviewer: ${packet.reviewerAgentId ?? '(none — nothing delegated)'}`)
  console.log(`  asked by: ${requester}`)
  console.log(
    `  applicability: ${
      report.applicability.comparison === 'identical'
        ? 'unchanged since capture'
        : `${report.applicability.comparison} (never a pass)`
    }`,
  )
  if (packet.summary) console.log(`  summary:  ${packet.summary}`)
  console.log(
    `  exported: ${
      packet.exportedAt ? `revision ${packet.exportRevision?.slice(0, 12)}` : 'not exported'
    }`,
  )

  if (report.findings.length === 0) {
    console.log('  findings: none recorded')
  } else {
    console.log('  findings:')
    for (const finding of report.findings) {
      const lines =
        finding.lineStart === null
          ? ''
          : `:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ''}`
      const resolution = finding.resolution
        ? ` resolved(${finding.resolution.kind})`
        : finding.state === 'unverified'
          ? ' UNVERIFIED — not correlated to the reviewed revision'
          : ''
      console.log(`    [${finding.severity}] ${finding.path}${lines}${resolution}  ${finding.note}`)
    }
  }
  if (report.conclusions.length === 0) {
    console.log('  conclusions: none — a packet with findings is not yet a review')
  } else {
    for (const conclusion of report.conclusions) {
      const who = conclusion.reviewer.kind === 'agent' ? conclusion.reviewer.agentId : 'operator'
      console.log(
        `  conclusion: ${conclusion.conclusion} (${who})${conclusion.note ? ` — ${conclusion.note}` : ''}`,
      )
    }
  }
  // Completion facts, each shown only when its own evidence exists.
  const { facts } = report
  const reported = Object.entries(facts.reported)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${value} (reported)`)
  console.log(
    `  facts:    change prepared=${facts.changePrepared} checks current=${facts.checksCurrent} reviewed=${facts.reviewed}`,
  )
  if (reported.length > 0) console.log(`            ${reported.join(' ')}`)
  console.log(
    '  note:     a review conclusion is not acceptance, and this command never commits, pushes, merges or deploys',
  )
}

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Capture a review packet for a retained revision' },
  args: {
    ...slug,
    snapshot: {
      type: 'string',
      required: true,
      description: 'BAZ-042 snapshot id to review (see `team review snapshots`)',
    },
    reviewer: {
      type: 'string',
      description:
        'Agent who should review. Omit for an operator-only packet (nothing is delegated)',
    },
    summary: { type: 'string', description: 'What the change is for, in the requester’s words' },
    json: { type: 'boolean', description: 'Emit the packet as JSON' },
  },
  async run({ args }) {
    const client = createClient()
    try {
      const response = await client.reviewPackets(args.id).create({
        snapshotId: args.snapshot,
        reviewerAgentId: args.reviewer ?? null,
        summary: args.summary ?? null,
      })
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      printReport(response.report)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List review packets for a Team' },
  args: { ...slug, json: { type: 'boolean', description: 'Emit JSON' } },
  async run({ args }) {
    const client = createClient()
    const response: ReviewPacketListResponse = await client.reviewPackets(args.id).list()
    if (args.json) {
      console.log(JSON.stringify(response, null, 2))
      return
    }
    if (response.packets.length === 0) {
      console.log('no review packets')
      return
    }
    const rows = [
      ['ID', 'STATE', 'REVIEWER', 'FINDINGS', 'OPEN', 'CONCLUSION', 'CHANGE'],
      ...response.packets.map((entry) => [
        entry.packet.id,
        entry.packet.state,
        entry.packet.reviewerAgentId ?? '(none)',
        String(entry.counts.findings),
        String(entry.counts.unresolved),
        entry.conclusion ?? '—',
        entry.packet.snapshot.id.slice(0, 12),
      ]),
    ]
    for (const line of columnize(rows)) console.log(line)
    console.log(
      '\nA packet of an older revision stays listed; `packet show` reports whether it is stale.',
    )
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show one review packet, its findings and its conclusions' },
  args: { ...slug, ...packetId, json: { type: 'boolean', description: 'Emit JSON' } },
  async run({ args }) {
    const client = createClient()
    try {
      const response: ReviewPacketResponse = await client.reviewPackets(args.id).show(args.packetId)
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      printReport(response.report)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const findingCmd = defineCommand({
  meta: { name: 'finding', description: 'Record a finding against the packet’s captured revision' },
  args: {
    ...slug,
    ...packetId,
    path: { type: 'string', required: true, description: 'Repository-relative path' },
    severity: { type: 'string', required: true, description: SEVERITIES.join(' | ') },
    note: { type: 'string', required: true, description: 'What is wrong, with evidence' },
    lines: {
      type: 'string',
      description: 'Line context as "start" or "start-end". Context only: never identity.',
    },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    if (!SEVERITIES.includes(args.severity as ReviewSeverity)) {
      console.error(`severity must be one of: ${SEVERITIES.join(', ')}`)
      process.exit(1)
    }
    const [start, end] = (args.lines ?? '').split('-')
    const body: AddReviewFindingRequest = {
      path: args.path,
      severity: args.severity as ReviewSeverity,
      note: args.note,
      ...(start ? { lineStart: Number(start) } : {}),
      ...(end ? { lineEnd: Number(end) } : {}),
    }
    const client = createClient()
    try {
      const response = await client.reviewPackets(args.id).addFinding(args.packetId, body)
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      console.log(
        `finding recorded against revision ${response.report.packet.snapshot.id.slice(0, 12)}`,
      )
      printReport(response.report)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const resolveCmd = defineCommand({
  meta: { name: 'resolve', description: 'Resolve a finding with explicit proof' },
  args: {
    ...slug,
    ...packetId,
    findingId: { type: 'positional', required: true, description: 'Finding id' },
    kind: {
      type: 'string',
      required: true,
      description: 'explicit (a decision) | linked_revision (a named later revision)',
    },
    note: { type: 'string', required: true, description: 'How it was resolved' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    if (args.kind !== 'explicit' && args.kind !== 'linked_revision') {
      console.error('kind must be `explicit` or `linked_revision`')
      process.exit(1)
    }
    const client = createClient()
    try {
      const response = await client
        .reviewPackets(args.id)
        .resolveFinding(args.packetId, args.findingId, {
          resolutionKind: args.kind,
          resolutionNote: args.note,
        })
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      printReport(response.report)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const concludeCmd = defineCommand({
  meta: { name: 'conclude', description: 'Record the reviewer’s conclusion for this revision' },
  args: {
    ...slug,
    ...packetId,
    conclusion: {
      type: 'string',
      required: true,
      description: 'changes_requested | commented | recommended',
    },
    note: { type: 'string', description: 'Why' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const allowed = ['changes_requested', 'commented', 'recommended']
    if (!allowed.includes(args.conclusion)) {
      console.error(`conclusion must be one of: ${allowed.join(', ')}`)
      process.exit(1)
    }
    const client = createClient()
    try {
      const response = await client.reviewPackets(args.id).recordConclusion(args.packetId, {
        conclusion: args.conclusion as RecordReviewConclusionRequest['conclusion'],
        note: args.note ?? null,
      })
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      printReport(response.report)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const snapshotCmd = defineCommand({
  meta: { name: 'snapshots', description: 'List retained revisions that could be reviewed' },
  args: { ...slug, json: { type: 'boolean', description: 'Emit JSON' } },
  async run({ args }) {
    const client = createClient()
    const list: SourceSnapshotListResponse = await client.repositoryReview(args.id).snapshots()
    if (args.json) {
      console.log(JSON.stringify(list, null, 2))
      return
    }
    if (list.snapshots.length === 0) {
      console.log('no retained revisions — capture one with `team review capture`')
      return
    }
    const rows = [
      ['SNAPSHOT', 'CAPTURED', 'ENTRIES', 'COMPLETE'],
      ...list.snapshots.map((snapshot) => [
        snapshot.snapshotId.slice(0, 16),
        new Date(snapshot.createdAt).toISOString(),
        String(snapshot.entryCount),
        snapshot.complete ? 'yes' : 'NO',
      ]),
    ]
    for (const line of columnize(rows)) console.log(line)
  },
})

const reportedCmd = defineCommand({
  meta: {
    name: 'reported',
    description: 'Record an operator-reported external state (never verified by Bazilion)',
  },
  args: {
    ...slug,
    ...packetId,
    state: {
      type: 'positional',
      required: true,
      description: 'committed | pushed | pullRequest | merged | deployed | productionAccepted',
    },
    reference: {
      type: 'string',
      description:
        'What the operator is pointing at: a commit id, a URL, a release name. Omit to clear it.',
    },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    try {
      const response = await client.reviewPackets(args.id).reportState(args.packetId, {
        state: args.state as never,
        reference: args.reference ?? null,
      })
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      const reported = Object.entries(response.report.packet.reported)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}=${value}`)
      console.log(
        `recorded (reported, not verified): ${
          reported.length > 0 ? reported.join(' ') : 'nothing reported'
        }`,
      )
      console.log(
        'Bazilion did not check this: there is no code-host integration, so it is whatever you reported.',
      )
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const linkCmd = defineCommand({
  meta: {
    name: 'link',
    description: 'Resolve where a file link points, and where it would open',
  },
  args: {
    ...slug,
    ...packetId,
    path: { type: 'string', required: true, description: 'Changed path in the reviewed revision' },
    line: { type: 'string', description: 'Line to point at' },
    open: {
      type: 'boolean',
      description: 'Actually open it on the daemon host (requires a configured editor)',
    },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    const options = {
      path: args.path,
      ...(args.line ? { line: Number(args.line) } : {}),
    }
    try {
      if (args.open) {
        const { link, result } = await client
          .reviewPackets(args.id)
          .openLink(args.packetId, options)
        console.log(result.opened ? `opened: ${result.detail}` : `not opened: ${result.detail}`)
        console.log(`host: ${link.host.daemon ?? 'unknown'} (owns the workspace)`)
        return
      }
      const { link } = await client.reviewPackets(args.id).link(args.packetId, options)
      if (args.json) {
        console.log(JSON.stringify(link, null, 2))
        return
      }
      console.log(`copy:  ${link.copyTarget}`)
      console.log(`host:  ${link.host.daemon ?? 'unknown'} (owns the workspace)`)
      console.log(`file:  ${link.hostPath ?? '(not part of the reviewed revision)'}`)
      console.log(
        `mode:  ${
          link.mode === 'live'
            ? 'the reviewed revision (the tree still matches the capture)'
            : link.mode === 'stale'
              ? 'the CURRENT file — the tree moved since the capture'
              : 'unknown'
        }`,
      )
      console.log(`open:  ${link.canOpen ? link.command : 'not configured on the daemon host'}`)
      for (const note of link.notes) console.log(`  note: ${note}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const exportCmd = defineCommand({
  meta: { name: 'export', description: 'Print the patch and handoff text for a packet’s revision' },
  args: {
    ...slug,
    ...packetId,
    patch: { type: 'boolean', description: 'Print only the unified patch' },
    deliver: {
      type: 'boolean',
      description:
        'Publish the export as a durable artifact for the requesting Agent (subject to policy)',
    },
    handoff: { type: 'boolean', description: 'Print only the handoff text' },
    json: { type: 'boolean', description: 'Emit the export as JSON' },
  },
  async run({ args }) {
    const client = createClient()
    try {
      if (args.deliver) {
        const { delivery } = await client.reviewPackets(args.id).deliverExport(args.packetId)
        if (delivery.kind === 'delivered') {
          console.log(`delivered: ${delivery.resultName} (result ${delivery.resultId})`)
          console.log(
            delivery.noticeHeld
              ? 'the requester’s notice is held for approval; the artifact itself is available'
              : 'the requester was told where to find it',
          )
        } else if (delivery.kind === 'held') {
          console.log(`held for approval: ${delivery.detail}`)
          console.log(`result ${delivery.resultId} stays unreadable until it is released`)
        } else {
          console.log(`not delivered (${delivery.kind}): ${delivery.detail}`)
        }
        return
      }
      const { export: result } = await client.reviewPackets(args.id).export(args.packetId)
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      if (args.patch || !args.handoff)
        console.log(result.patch || '(no patch: see the handoff limitations)')
      if (!args.patch) {
        if (!args.handoff) console.log('')
        console.log(result.handoff)
      }
      if (!args.patch && result.limitations.length > 0) {
        console.error(
          `\nhandoff names ${result.limitations.length} limitation(s), and a conclusion is not acceptance`,
        )
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

export const teamReviewPacketCommand = defineCommand({
  meta: {
    name: 'packet',
    description:
      'Revision-bound review packets: captured revision, findings, conclusion and handoff',
  },
  subCommands: {
    create: createCmd,
    list: listCmd,
    show: showCmd,
    finding: findingCmd,
    resolve: resolveCmd,
    conclude: concludeCmd,
    reported: reportedCmd,
    link: linkCmd,
    export: exportCmd,
    snapshots: snapshotCmd,
  },
})

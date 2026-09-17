import type {
  PublicationBlockedResponse,
  PublicationListResponse,
  PublicationReport,
  PublicationResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

// BAZ-046: publishing a reviewed revision from the CLI, with parity against the API.
//
// `publish` is a subcommand of `team verify`-style shape: `team publish <slug> --packet <id>`. There is no
// flag for a remote, a credential, a force push or a merge, because the API has nowhere to put one.

const slug = { id: { type: 'positional', required: true, description: 'Team slug' } } as const
const publicationId = {
  publicationId: { type: 'positional', required: true, description: 'Publication id' },
} as const

function printReport(report: PublicationReport): void {
  const publication = report.publication
  console.log(`${publication.id}  ${publication.state}`)
  console.log(`  packet:     ${publication.packetId}`)
  console.log(
    `  change:     snapshot ${publication.snapshotId.slice(0, 12)} (base ${publication.baseOid.slice(0, 12)})`,
  )
  console.log(`  target:     ${publication.host} ${publication.repository}`)
  console.log(
    `  branch:     ${publication.headBranch} (base ${publication.baseBranch})${publication.commitOid ? `\n  commit:     ${publication.commitOid}${publication.signed ? '' : ' (unsigned)'}` : ''}`,
  )
  if (publication.pullRequestUrl) {
    console.log(`  pull request: ${publication.pullRequestUrl}`)
  } else if (publication.state === 'published') {
    console.log('  pull request: none was opened')
  }
  if (publication.refusalReason) {
    console.log(`  refused:    ${publication.refusalReason} — ${publication.refusalDetail ?? ''}`)
  }
  if (publication.error) console.log(`  note:       ${publication.error}`)
  console.log(`  ${report.guidance}`)
}

function printList(list: PublicationListResponse): void {
  if (list.publications.length === 0) {
    console.log('no publications')
    return
  }
  const rows = list.publications.map((publication) => [
    publication.id,
    publication.state,
    publication.headBranch,
    publication.commitOid ? publication.commitOid.slice(0, 10) : '-',
    publication.pullRequestNumber ? `#${publication.pullRequestNumber}` : '-',
    publication.refusalReason ?? '',
  ])
  for (const line of columnize(rows)) console.log(line)
}

const createCmd = defineCommand({
  meta: {
    name: 'create',
    description: 'Publish a reviewed revision to a new branch (and open a pull request)',
  },
  args: {
    ...slug,
    packet: { type: 'string', required: true, description: 'Review packet id to publish' },
    branch: {
      type: 'string',
      description: 'Branch to publish to (default: bazilion/review-<packet prefix>)',
    },
    message: { type: 'string', description: 'Commit message (default: derived from the packet)' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    try {
      const response = await client.publications(args.id).create({
        teamId: args.id,
        packetId: args.packet,
        ...(args.branch ? { headBranch: args.branch } : {}),
        ...(args.message ? { commitMessage: args.message } : {}),
      })
      if (args.json) {
        console.log(JSON.stringify(response, null, 2))
        return
      }
      if ('blocked' in response) {
        // A refusal is an answer with a reason, and it means nothing was sent.
        console.error(`refused: ${response.blocked.reason} — ${response.blocked.detail}`)
        process.exit(1)
      }
      printReport((response as PublicationResponse).report)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List publications for a Team' },
  args: { ...slug, json: { type: 'boolean', description: 'Emit JSON' } },
  async run({ args }) {
    const client = createClient()
    const response = await client.publications(args.id).list()
    if (args.json) {
      console.log(JSON.stringify(response, null, 2))
      return
    }
    printList(response)
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show one publication and its outcome' },
  args: { ...slug, ...publicationId, json: { type: 'boolean', description: 'Emit JSON' } },
  async run({ args }) {
    const client = createClient()
    try {
      const response = await client.publications(args.id).show(args.publicationId)
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

export const teamPublishCommand = defineCommand({
  meta: {
    name: 'publish',
    description: 'Publish a reviewed revision to a code host (BAZ-046)',
  },
  subCommands: { create: createCmd, list: listCmd, show: showCmd },
})

export type { PublicationBlockedResponse }

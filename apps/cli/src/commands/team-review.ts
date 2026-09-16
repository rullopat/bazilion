import type {
  RepositoryChanges,
  SourceSnapshot,
  SourceSnapshotListResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { collectFlagValues } from '../repeatable-args.ts'

// `bazilion team review` — read-only Git change review and bounded source snapshots (BAZ-042).
//
// This command never mutates the repository: it lists changes, prints a diff, or captures a
// snapshot manifest. No staging, checkout, commit or push exists here on purpose.

const slug = {
  id: { type: 'positional', required: true, description: 'Team slug' },
} as const

function printIssues(changes: RepositoryChanges): void {
  for (const issue of changes.issues) console.log(`note: ${issue.code}: ${issue.message}`)
}

// Subcommand-first, matching `team policy` and the rest of the CLI: citty resolves the first
// positional as a subcommand, so a bare `team review <slug>` would be read as an unknown command.
const showCmd = defineCommand({
  meta: {
    name: 'show',
    description: 'List changes since a baseline (read-only)',
  },
  args: {
    ...slug,
    base: {
      type: 'string',
      description: 'Comparison base: branch, tag or commit id (default HEAD)',
    },
    patch: {
      type: 'string',
      description: 'Print the unified diff for one changed path instead of the list',
    },
    json: { type: 'boolean', description: 'Emit the complete review as JSON' },
  },
  async run({ args }) {
    const client = createClient()
    const review = await client.repositoryReview(args.id).changes({
      ...(args.base ? { base: args.base } : {}),
      patches: true,
    })
    if (args.json) {
      console.log(JSON.stringify(review, null, 2))
      return
    }
    const changes = review.changes
    if (args.patch) {
      const entry = changes.changes.find((change) => change.path === args.patch)
      if (!entry) {
        console.error(`no change for path: ${args.patch}`)
        process.exit(1)
      }
      if (!entry.patch) {
        console.log(
          `${entry.path}: ${entry.status}${entry.contentOmitted ? ` (${entry.contentOmitted})` : ' (no content)'}`,
        )
        return
      }
      console.log(entry.patch)
      if (entry.patchTruncated) console.log('(diff truncated at the configured patch cap)')
      return
    }
    console.log(
      `# ${changes.identity.branch ?? `detached ${changes.identity.head ?? 'unborn'}`}` +
        ` · base ${changes.base.requestedRef} (${changes.base.resolvedOid.slice(0, 12)})`,
    )
    if (changes.changes.length === 0) console.log('(no changes since baseline)')
    const rows = changes.changes.map((change) => [
      change.status,
      change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path,
      change.binary ? 'binary' : `${change.addedLines ?? 0}+ ${change.deletedLines ?? 0}-`,
      change.contentOmitted ?? '',
    ])
    for (const line of columnize(rows)) console.log(line)
    if (changes.truncated) console.log('note: the change list is incomplete (file limit)')
    const withheld = changes.withheld
    if (withheld.excluded + withheld.untracked > 0) {
      console.log(
        `note: ${withheld.excluded} excluded and ${withheld.untracked} untracked path(s) withheld`,
      )
    }
    printIssues(changes)
  },
})

const captureCmd = defineCommand({
  meta: {
    name: 'capture',
    description: 'Capture a bounded source snapshot for a Team (read-only)',
  },
  args: {
    ...slug,
    base: { type: 'string', description: 'Comparison base (default HEAD)' },
    include: {
      type: 'string',
      // Read from raw arguments: citty keeps only the last value of a repeated flag.
      description: 'Untracked path to include by content (repeat the flag for more)',
    },
    json: { type: 'boolean', description: 'Emit the complete snapshot as JSON' },
  },
  async run({ args, rawArgs }) {
    const client = createClient()
    const includeUntracked = collectFlagValues(rawArgs, 'include')
    if (includeUntracked.length > 1000) {
      console.error('team review capture: too many paths to include')
      process.exit(1)
    }
    const captured = await client.repositoryReview(args.id).capture({
      ...(args.base ? { base: args.base } : {}),
      ...(includeUntracked.length > 0 ? { includeUntracked } : {}),
    })
    if (args.json) {
      console.log(JSON.stringify(captured, null, 2))
      return
    }
    const { snapshot, reference } = captured
    console.log(`snapshot ${reference.id}`)
    console.log(`  complete: ${reference.complete ? 'yes' : 'no (applicability is unknown)'}`)
    console.log(`  head: ${snapshot.head ?? '(unborn)'}`)
    console.log(
      `  entries: ${snapshot.entries.length} · included untracked: ${snapshot.untrackedIncluded.length}`,
    )
    if (snapshot.exclusions.length > 0) {
      console.log(`  excluded: ${snapshot.exclusions.map((item) => item.path).join(', ')}`)
    }
    for (const issue of snapshot.issues) console.log(`  note: ${issue.code}: ${issue.message}`)
  },
})

const snapshotsCmd = defineCommand({
  meta: { name: 'snapshots', description: 'List retained source snapshots for a Team' },
  args: { ...slug, json: { type: 'boolean', description: 'Emit JSON' } },
  async run({ args }) {
    const client = createClient()
    const list: SourceSnapshotListResponse = await client.repositoryReview(args.id).snapshots()
    if (args.json) {
      console.log(JSON.stringify(list, null, 2))
      return
    }
    if (list.snapshots.length === 0) {
      console.log('(no retained snapshots)')
      return
    }
    const rows = list.snapshots.map((snapshot) => [
      snapshot.snapshotId.slice(0, 12),
      snapshot.complete ? 'complete' : 'incomplete',
      snapshot.capturedBy,
      new Date(snapshot.createdAt).toISOString(),
      `${snapshot.entryCount} entries`,
    ])
    for (const line of columnize(rows)) console.log(line)
  },
})

const snapshotCmd = defineCommand({
  meta: { name: 'snapshot', description: 'Show one retained source snapshot' },
  args: {
    ...slug,
    snapshot: { type: 'positional', required: true, description: 'Snapshot id' },
    json: { type: 'boolean', description: 'Emit JSON' },
  },
  async run({ args }) {
    const client = createClient()
    const { snapshot }: { snapshot: SourceSnapshot } = await client
      .repositoryReview(args.id)
      .snapshot(args.snapshot)
    if (args.json) {
      console.log(JSON.stringify(snapshot, null, 2))
      return
    }
    console.log(`snapshot ${snapshot.id} · ${snapshot.complete ? 'complete' : 'incomplete'}`)
    console.log(`  head: ${snapshot.head ?? '(unborn)'} · base: ${snapshot.base.resolvedOid}`)
    const rows = snapshot.entries.map((entry) => [
      entry.layer,
      entry.kind,
      entry.path,
      entry.bytes === null ? '-' : `${entry.bytes}B`,
      entry.digest === null ? '' : entry.digest.slice(0, 12),
    ])
    for (const line of columnize(rows)) console.log(line)
  },
})

export const teamReviewCommand = defineCommand({
  meta: {
    name: 'review',
    description: 'Read-only Git change review and bounded source snapshots',
  },
  subCommands: {
    show: showCmd,
    capture: captureCmd,
    snapshots: snapshotsCmd,
    snapshot: snapshotCmd,
  },
})

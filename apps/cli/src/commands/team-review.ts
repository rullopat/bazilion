import type { RepositoryChanges } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { jsonFlag, printJson, printRows, teamArg } from '../command-helpers.ts'

// `bazilion team review`: `show` lists the changes since a base, with the Agent that wrote each
// file, or prints one file's diff; `feedback` queues a comment about a changed file or one of its
// lines for an Agent.

const base = {
  type: 'string',
  description: 'Comparison base: branch, tag, commit id or revision such as HEAD~1 (default HEAD)',
} as const

function printIssues(changes: RepositoryChanges): void {
  for (const issue of changes.issues) console.log(`note: ${issue.code}: ${issue.message}`)
}

const showCmd = defineCommand({
  meta: {
    name: 'show',
    description: 'List changes since a baseline, or print one file diff (read-only)',
  },
  args: {
    id: teamArg,
    base,
    patch: {
      type: 'string',
      description: 'Print the unified diff for one changed path instead of the list',
    },
    json: { ...jsonFlag, description: 'Emit the complete review, with diffs, as JSON' },
  },
  async run({ args }) {
    const client = createClient()
    // Diffs are read only when asked for: one for --patch, all of them for --json.
    const review = await client.repositoryReview(args.id).changes({
      ...(args.base ? { base: args.base } : {}),
      ...(args.patch ? { patches: true, path: args.patch } : args.json ? { patches: true } : {}),
      authors: !args.patch,
    })
    if (args.json) return printJson(review)
    const changes = review.changes
    if (args.patch) {
      const entry = changes.changes.find((change) => change.path === args.patch)
      if (!entry) throw new Error(`no change for path: ${args.patch}`)
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
    printRows(
      changes.changes.map((change) => [
        change.status,
        change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path,
        change.binary
          ? 'binary'
          : change.addedLines === null
            ? ''
            : `${change.addedLines}+ ${change.deletedLines ?? 0}-`,
        change.contentOmitted ?? '',
        review.authors?.[change.path] ? `by ${review.authors[change.path]?.agentName}` : '',
      ]),
      '(no changes since baseline)',
    )
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

const feedbackCmd = defineCommand({
  meta: {
    name: 'feedback',
    description:
      'Queue a comment about a changed file, or one of its lines, for an Agent (diff excerpt, note)',
  },
  args: {
    id: teamArg,
    path: { type: 'string', required: true, description: 'Changed path the feedback is about' },
    agent: { type: 'string', required: true, description: 'Team member to send it to' },
    note: { type: 'string', description: 'Your comment' },
    line: {
      type: 'string',
      description: 'Line of the file as it is now; the diff around it is sent instead of the top',
    },
    base,
  },
  async run({ args }) {
    const client = createClient()
    const line = args.line === undefined ? undefined : Number(args.line)
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) {
      throw new Error('--line must be a line number starting at 1')
    }
    const queued = await client.repositoryReview(args.id).feedback({
      agentId: args.agent,
      comments: [
        {
          path: args.path,
          ...(line === undefined ? {} : { line }),
          ...(args.note ? { note: args.note } : {}),
        },
      ],
      ...(args.base ? { base: args.base } : {}),
    })
    console.log(`queued ${queued.item.id} for ${args.agent} (${queued.item.status})`)
    console.log(queued.message)
  },
})

export const teamReviewCommand = defineCommand({
  meta: {
    name: 'review',
    description: 'Git change review: changes since a base, diffs, and file feedback',
  },
  subCommands: {
    show: showCmd,
    feedback: feedbackCmd,
  },
})

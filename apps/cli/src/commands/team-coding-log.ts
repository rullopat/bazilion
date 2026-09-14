import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

/**
 * Operator access to a BAZ-041 retained diagnostic log. We address a command by its
 * opaque id (never a host path) and page over UTF-8 byte offsets. A log that has not
 * been shared is reported as withheld rather than silently rendered empty.
 */
export const teamCodingLogCommand = defineCommand({
  meta: {
    name: 'log',
    description: 'Read retained diagnostics for a shared coding command receipt',
  },
  args: {
    team: { type: 'positional', required: true, description: 'Team slug' },
    commandId: { type: 'positional', required: true, description: 'Coding command id' },
    offset: { type: 'string', description: 'UTF-8 byte offset into the retained tail' },
    limit: { type: 'string', description: 'Maximum bytes to read (default 64 KiB)' },
    search: { type: 'string', description: 'Literal search instead of a page read' },
  },
  async run({ args }) {
    const client = createClient().codingLogs(args.team)
    if (args.search !== undefined) {
      const { view, result } = await client.search(args.commandId, args.search)
      if (!result) {
        console.log(`Coding log withheld (${view.availability}); not shared for disclosure.`)
        return
      }
      console.log(
        `${view.availability}${result.bounded ? ' · bounded scan' : ''} · ${result.matches.length} match(es)`,
      )
      for (const match of result.matches) {
        console.log(`${match.line}:${match.offset}  ${match.excerpt.replace(/\n/g, '\\n')}`)
      }
      return
    }
    const offset = args.offset === undefined ? undefined : Number(args.offset)
    const limit = args.limit === undefined ? undefined : Number(args.limit)
    if (
      (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) ||
      (limit !== undefined && !Number.isSafeInteger(limit))
    ) {
      console.error('offset and limit must be non-negative integers')
      process.exitCode = 1
      return
    }
    const { view, page } = await client.page(args.commandId, {
      ...(offset !== undefined ? { offset } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    if (!page) {
      console.log(`Coding log withheld (${view.availability}); not shared for disclosure.`)
      return
    }
    console.log(
      `${view.availability} · ${view.byteLength} retained byte(s) of ${view.observedBytes} observed` +
        (view.redacted ? ' · redacted' : '') +
        ` · expires ${new Date(view.expiresAt).toISOString()}`,
    )
    process.stdout.write(page.text)
    if (page.hasMore)
      console.log(
        `\n… truncated; continue with --offset ${page.offset + Buffer.byteLength(page.text)}`,
      )
  },
})

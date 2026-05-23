// Group-shared USER.md read/write surface for agents.
//
// USER.md is inlined into every agent's system prompt every turn (capped at
// 12 KB on the daemon-side host). Agents previously could only read it; now
// they can also update it via read-modify-write so they can correct stale
// facts, not just stack new ones. Concurrency between multiple agents in
// the same group is handled via optimistic etag checks — see
// `lib/user-md-host.ts` for the full rationale.
//
// Two tools:
//   - `user_md_get`   — returns current content + an etag.
//   - `user_md_write` — replaces content; requires `if_match` to equal the
//                       most recent etag, else returns a conflict.
//
// Project knowledge (codebase notes, decisions) still goes to `memory_write`.
// Personal notes about the agent itself go to `home_write` on IDENTITY.md.

import type { UserMdHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

export function userMdTools(host: UserMdHost, groupId: string): ToolHandler[] {
  return [
    {
      def: {
        name: 'user_md_get',
        description:
          "Read the group-shared USER.md (facts every agent in the group knows about the human). Returns the current content followed by an `etag:` line — you MUST pass that etag back as `if_match` on the next `user_md_write` so the daemon can detect concurrent edits by other agents in the group. Always call this immediately before any `user_md_write`.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      async invoke() {
        const { content, etag } = await host.get(groupId)
        const body = content.length > 0 ? content : '(USER.md is empty)'
        return `${body}\n\n---\netag: ${etag}`
      },
    },
    {
      def: {
        name: 'user_md_write',
        description:
          "Replace the group-shared USER.md with new content. Use this for STABLE user-specific facts (preferences, role, working hours, how the human likes to be addressed). MANDATORY workflow: (1) call `user_md_get` first, (2) integrate your change into the full content preserving everything unrelated, (3) call `user_md_write` with the merged content and the etag you got from `user_md_get`. If another agent in the group wrote to USER.md between your get and write, this returns an etag-mismatch error — just call `user_md_get` again and retry the merge. The full result must fit under 12 KB. For project knowledge use `memory_write`; for notes about yourself use `home_write` on IDENTITY.md.",
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description:
                'Full new contents of USER.md (this is a complete replacement, NOT an append). Include everything you want to keep.',
            },
            if_match: {
              type: 'string',
              description:
                'The etag returned by your most recent `user_md_get`. The write fails if USER.md changed in the meantime.',
            },
          },
          required: ['content', 'if_match'],
        },
      },
      async invoke(args) {
        const content = String(args.content ?? '')
        const ifMatch = String(args.if_match ?? '')
        if (!ifMatch) {
          throw new Error(
            'user_md_write: "if_match" is required — call user_md_get first to obtain the current etag.',
          )
        }
        const { etag, totalBytes } = await host.write(groupId, content, ifMatch)
        return `wrote USER.md (${totalBytes} bytes, new etag: ${etag})`
      },
    },
  ]
}

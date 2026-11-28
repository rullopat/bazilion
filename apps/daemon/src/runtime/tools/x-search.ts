// x_search (BAZ-107): posts on X, searched and read by xAI in the daemon, which holds the key.

import type { XSearchHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

export function xSearchTool(host: XSearchHost): ToolHandler {
  return {
    def: {
      name: 'x_search',
      description:
        'Search posts on X (Twitter): xAI reads them and answers from what they say, with links to the posts it used. Use it for what people are saying now, an account’s posts or reactions to news; use web_search for everything else. Narrow it with handles (only these accounts) or exclude_handles, and from/to dates. Cite the post links you rely on. xAI bills by the posts it reads, so ask for what you need.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            maxLength: 512,
            description: 'What to find, as you would ask a person.',
          },
          handles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only posts from these accounts, without @, e.g. ["NASA"].',
          },
          exclude_handles: {
            type: 'array',
            items: { type: 'string' },
            description: 'No posts from these accounts. Not with handles.',
          },
          from: { type: 'string', description: 'Posted on or after this day, YYYY-MM-DD.' },
          to: { type: 'string', description: 'Posted before this day, YYYY-MM-DD.' },
        },
        required: ['query'],
      },
    },
    async invoke(args) {
      const list = (value: unknown) =>
        Array.isArray(value) ? value.map((item) => String(item)) : undefined
      const output = await host.search({
        query: String(args.query ?? ''),
        ...(list(args.handles) ? { handles: list(args.handles) } : {}),
        ...(list(args.exclude_handles) ? { excludeHandles: list(args.exclude_handles) } : {}),
        ...(typeof args.from === 'string' ? { from: args.from } : {}),
        ...(typeof args.to === 'string' ? { to: args.to } : {}),
      })
      const posts = output.posts.map(
        (post, index) => `${index + 1}. ${post.url}${post.title ? ` (${post.title})` : ''}`,
      )
      return [
        output.answer.trim() || '(xAI found nothing to say.)',
        posts.length > 0 ? `Posts:\n${posts.join('\n')}` : 'No posts were cited.',
        ...(output.postsRead !== undefined ? [`xAI read ${output.postsRead} posts.`] : []),
      ].join('\n\n')
    },
  }
}

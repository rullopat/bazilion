import type { MemoryBackend } from '../memory/types.ts'
import type { ToolHandler } from './types.ts'

export function memoryTools(memory: MemoryBackend): ToolHandler[] {
  return [
    {
      def: {
        name: 'memory_write',
        description:
          'Write or update a memory note in the GROUP-SHARED memory. All agents in this group can read what you write. Use it for project knowledge, codebase notes, decisions, and findings — anything other agents in the group should benefit from. For personal notes about yourself (preferences, persona) use `home_write` on IDENTITY.md. For STABLE facts about the human you\'re working with (their preferences, role, working hours, how they like to be addressed) use `user_md_get` then `user_md_write` — those land in every agent\'s system prompt directly. Key is a path-like string with a markdown extension, e.g. "auth-flow.md" or "decisions/2026-05-migration.md".',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'memory key (relative path)' },
            content: { type: 'string', description: 'note content (plain text or markdown)' },
          },
          required: ['key', 'content'],
        },
      },
      async invoke(args) {
        const key = String(args.key ?? '')
        const content = String(args.content ?? '')
        if (!key) throw new Error('memory_write: "key" is required')
        const entry = await memory.write(key, content)
        return `wrote ${entry.key} (${entry.content.length} bytes)`
      },
    },
    {
      def: {
        name: 'memory_search',
        description:
          'Search the group-shared memory by substring. Returns matching entry keys with short snippets around the match.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', description: 'max results (default 10)' },
          },
          required: ['query'],
        },
      },
      async invoke(args) {
        const query = String(args.query ?? '')
        if (!query) throw new Error('memory_search: "query" is required')
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const hits = await memory.search(query, { limit })
        if (hits.length === 0) return 'no matches'
        return hits.map((h) => `${h.key}: ${h.snippet.replaceAll('\n', ' ')}`).join('\n')
      },
    },
    {
      def: {
        name: 'memory_read',
        description: 'Read a single entry from the group-shared memory by key.',
        parameters: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
        },
      },
      async invoke(args) {
        const key = String(args.key ?? '')
        if (!key) throw new Error('memory_read: "key" is required')
        const entry = await memory.read(key)
        return entry.content
      },
    },
    {
      def: {
        name: 'memory_list',
        description: 'List every entry in the group-shared memory with its byte size.',
        parameters: { type: 'object', properties: {} },
      },
      async invoke() {
        const all = await memory.list()
        if (all.length === 0) return '(empty)'
        return all.map((e) => `${e.key} (${e.content.length}b)`).join('\n')
      },
    },
  ]
}

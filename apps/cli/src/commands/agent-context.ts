import type {
  ChatCompactRequest,
  ChatCompactResponse,
  ChatContextResponse,
  TruncateChatRequest,
  TruncateChatResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, confirm, printJson } from '../command-helpers.ts'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

const chatTrimCmd = defineCommand({
  meta: {
    name: 'chat-trim',
    description: "Keep the first N messages of an agent's chat history; drop the rest",
  },
  args: {
    id: agentArg,
    keep: { type: 'string', required: true, description: 'Number of leading messages to keep' },
  },
  async run({ args }) {
    const keepCount = Number(args.keep)
    if (!Number.isInteger(keepCount) || keepCount < 0) {
      throw new Error('--keep must be a non-negative integer')
    }
    const body: TruncateChatRequest = { keepCount }
    const res = await createClient().post<TruncateChatResponse>(
      apiPath('agents', args.id, 'chat', 'truncate'),
      body,
    )
    console.log(
      `trimmed: ${res.before} → ${res.after} messages (${res.before - res.after} dropped)`,
    )
  },
})

const chatContextCmd = defineCommand({
  meta: {
    name: 'chat-context',
    description: "Break down what consumes the agent's context window",
  },
  args: {
    id: agentArg,
    detail: {
      type: 'boolean',
      description: 'Include every tool/skill entry instead of the top 30',
    },
    json: { type: 'boolean', description: 'Emit raw JSON instead of a human report' },
  },
  async run({ args }) {
    const query = args.detail || args.json ? '?detail=1' : ''
    const ctx = await createClient().get<ChatContextResponse>(
      `${apiPath('agents', args.id, 'chat', 'context')}${query}`,
    )
    if (args.json) return printJson(ctx)

    const fmt = (chars: number, tokens: number): string =>
      `${chars.toLocaleString()} chars (~${tokens.toLocaleString()} tok)`
    const { systemPrompt, tools, skills, team, history } = ctx

    console.log(`🧠 context for ${ctx.agentId}`)
    console.log(`model: ${ctx.model}`)
    console.log('')
    console.log('## system prompt')
    console.log(`  total: ${fmt(systemPrompt.chars, systemPrompt.tokens)}`)
    if (systemPrompt.files.length > 0) {
      console.log('  profile files:')
      for (const f of systemPrompt.files) console.log(`    - ${f.name}: ${fmt(f.chars, f.tokens)}`)
    }
    if (systemPrompt.skillsListChars > 0) {
      console.log(`  skills line: ${systemPrompt.skillsListChars.toLocaleString()} chars`)
    }
    if (systemPrompt.teamListChars > 0) {
      console.log(`  team block: ${systemPrompt.teamListChars.toLocaleString()} chars`)
    }
    if (systemPrompt.userMdChars > 0) {
      console.log(`  user_md block: ${systemPrompt.userMdChars.toLocaleString()} chars`)
    }
    console.log(`  memory hint: ${systemPrompt.memoryHintChars.toLocaleString()} chars`)
    console.log('')
    console.log('## tools')
    console.log(`  count: ${tools.count}`)
    console.log(
      `  schemas (JSON): ${tools.schemaChars.toLocaleString()} chars (~${estimateTokens(tools.schemaChars).toLocaleString()} tok)`,
    )
    console.log(`  list text: ${tools.listChars.toLocaleString()} chars`)
    if (tools.entries.length > 0) {
      console.log('  top tools by schema size:')
      for (const t of tools.entries) {
        const params = t.paramCount != null ? ` (${t.paramCount} params)` : ''
        console.log(`    - ${t.name}: ${t.schemaChars.toLocaleString()} chars${params}`)
      }
    }
    console.log('')
    if (skills.count > 0) {
      console.log('## skills')
      console.log(`  count: ${skills.count}`)
      for (const s of skills.entries) {
        console.log(`    - ${s.name}: ${s.blockChars.toLocaleString()} chars`)
      }
      console.log('')
    }
    console.log('## team')
    console.log(`    - ${team.id} (${team.name}): ${team.path}`)
    if (team.userMdChars > 0) console.log(`    user_md: ${team.userMdChars.toLocaleString()} chars`)
    console.log('')
    console.log('## history')
    console.log(`  messages:    ${history.messageEntries}`)
    console.log(`  compactions: ${history.compactionEntries}`)
    console.log(`  total:       ${fmt(history.chars, history.tokensEstimate)}`)
    console.log(`  bytes:       ${formatBytes(history.bytes)}`)
    console.log('')
    console.log(`TOTAL: ${fmt(ctx.totals.chars, ctx.totals.tokens)}`)
  },
})

const chatCompactCmd = defineCommand({
  meta: {
    name: 'chat-compact',
    description: "Summarize the head of an agent's chat log, preserving the tail verbatim",
  },
  args: {
    id: agentArg,
    instructions: {
      type: 'string',
      description: 'Optional extra guidance prepended to the summarizer prompt',
    },
    force: { type: 'boolean', description: 'Skip the y/N prompt' },
  },
  async run({ args }) {
    const body: ChatCompactRequest = args.instructions
      ? { customInstructions: args.instructions }
      : {}
    const question = `compact chat history for ${args.id}? head turns become a summary; tail is preserved.`
    if (!args.force && !(await confirm(question))) return console.log('aborted')
    const res = await createClient().post<ChatCompactResponse>(
      apiPath('agents', args.id, 'chat', 'compact'),
      body,
    )
    console.log(
      `compacted: ${res.before} → ${res.after} entries (${res.summarized} summarized, ${res.keptTail} tail kept verbatim)`,
    )
    console.log(
      `tokens: ~${res.tokensBefore.toLocaleString()} → ~${res.tokensAfter.toLocaleString()}`,
    )
    console.log('')
    console.log('summary:')
    console.log(res.summary)
  },
})

export const contextCommands = {
  'chat-trim': chatTrimCmd,
  'chat-context': chatContextCmd,
  'chat-compact': chatCompactCmd,
}

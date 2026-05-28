import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import type {
  Agent,
  AttachSkillRequest,
  ChatCompactRequest,
  ChatCompactResponse,
  ChatContextResponse,
  ChatFrame,
  ImageAttachment,
  MoveAgentRequest,
  ResolvedAgent,
  SessionEvent,
  SessionHeadResponse,
  SpawnAgentRequest,
  TruncateChatRequest,
  TruncateChatResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Read image file paths into base64 ImageAttachments. */
function loadImages(paths: string[]): ImageAttachment[] {
  return paths.map((p) => {
    const mimeType = IMAGE_MIME[extname(p).toLowerCase()]
    if (!mimeType) throw new Error(`unsupported image type: ${p} (png/jpg/gif/webp only)`)
    return { data: readFileSync(p).toString('base64'), mimeType }
  })
}

const spawnCmd = defineCommand({
  meta: { name: 'spawn', description: 'Spawn an agent from a profile into a group' },
  args: {
    profile: { type: 'string', required: true, description: 'Profile id' },
    name: { type: 'string', description: 'Agent name (defaults to profile name)' },
    group: {
      type: 'string',
      description: "Group to join (defaults to 'default')",
    },
    model: { type: 'string', description: 'Override profile default model' },
    reasoning: {
      type: 'string',
      description: 'Reasoning level: off|minimal|low|medium|high|xhigh (default: medium)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: SpawnAgentRequest = {
      profileId: args.profile,
      name: args.name,
      model: args.model,
      reasoningLevel: args.reasoning as SpawnAgentRequest['reasoningLevel'],
      groupId: args.group,
    }
    const agent = await client.post<Agent>('/api/agents', body)
    console.log(`spawned agent ${agent.id} (${agent.name})`)
    console.log(`dir: ${agent.dir}`)
  },
})

const editCmd = defineCommand({
  meta: {
    name: 'edit',
    description: 'Edit agent settings (name, model override, reasoning level, telegram mirror)',
  },
  args: {
    id: { type: 'positional', required: true, description: 'Agent id or prefix' },
    name: { type: 'string', description: 'Rename the agent' },
    model: { type: 'string', description: 'Set model override (use --model "" to clear)' },
    reasoning: {
      type: 'string',
      description: 'Reasoning level: off|minimal|low|medium|high|xhigh',
    },
    mirror: {
      type: 'string',
      description: 'Telegram mirror verbosity: minimal|verbose',
    },
    'topic-icon': {
      type: 'string',
      description: 'Telegram topic emoji (e.g. 📚). Use --topic-icon "" to clear.',
    },
  },
  async run({ args }) {
    if (
      args.name === undefined &&
      args.model === undefined &&
      args.reasoning === undefined &&
      args.mirror === undefined &&
      args['topic-icon'] === undefined
    ) {
      console.error(
        'agent edit: specify at least one of --name, --model, --reasoning, --mirror, --topic-icon',
      )
      process.exit(2)
    }
    const client = createClient()
    const body: Record<string, unknown> = {}
    if (args.name !== undefined) body.name = args.name
    if (args.model !== undefined) {
      body.modelOverride = args.model === '' ? null : args.model
    }
    if (args.reasoning !== undefined) body.reasoningLevel = args.reasoning
    if (args.mirror !== undefined) {
      if (args.mirror !== 'minimal' && args.mirror !== 'verbose') {
        console.error(`agent edit: --mirror must be 'minimal' or 'verbose'`)
        process.exit(2)
      }
      body.telegramMirrorMode = args.mirror
    }
    if (args['topic-icon'] !== undefined) {
      body.telegramIconEmoji = args['topic-icon'] === '' ? null : args['topic-icon']
    }
    const agent = await client.patch<Agent>(`/api/agents/${args.id}`, body)
    console.log(`updated agent ${agent.id} (${agent.name})`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List agents' },
  args: {
    all: { type: 'boolean', description: 'Include archived agents' },
    long: { type: 'boolean', alias: 'l', description: 'Show profile + full UUID columns' },
  },
  async run({ args }) {
    const client = createClient()
    const q = args.all ? '?includeArchived=true' : ''
    const list = await client.get<Agent[]>(`/api/agents${q}`)
    if (list.length === 0) {
      console.log('(no agents)')
      return
    }
    const rows = list.map((a) =>
      args.long
        ? [a.id, a.status, a.name, a.profileId]
        : // Short UUID prefix — all CLI commands accept 4+ char prefixes now.
          [a.id.slice(0, 8), a.status, a.name],
    )
    for (const line of columnize(rows)) console.log(line)
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show agent details' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const r = await client.get<ResolvedAgent>(`/api/agents/${args.id}`)
    console.log(`# ${r.agent.id}`)
    console.log(`name:    ${r.agent.name}`)
    console.log(`status:  ${r.agent.status}`)
    console.log(`profile: ${r.profile.id}`)
    console.log(`model:   ${r.model}`)
    console.log(`dir:     ${r.agent.dir}`)
    console.log(`group:   ${r.group.id} ${r.group.path}`)
    console.log('skills:')
    if (r.skills.length === 0) {
      console.log('  (none)')
    } else {
      for (const s of r.skills) console.log(`  ${s}`)
    }
  },
})

const archiveCmd = defineCommand({
  meta: { name: 'archive', description: 'Archive an agent' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.post(`/api/agents/${args.id}/archive`)
    console.log(`archived agent ${args.id}`)
  },
})

const unarchiveCmd = defineCommand({
  meta: { name: 'unarchive', description: 'Restore an archived agent to idle' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.post(`/api/agents/${args.id}/unarchive`)
    console.log(`unarchived agent ${args.id}`)
  },
})

const deleteCmd = defineCommand({
  meta: { name: 'delete', description: 'Permanently delete an agent and its data' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/agents/${args.id}`)
    console.log(`deleted agent ${args.id}`)
  },
})

// --- chat ---

interface PrintState {
  inDeltaStream: boolean
}

function printEvent(e: SessionEvent, state: PrintState): void {
  switch (e.type) {
    case 'assistant_delta':
      process.stdout.write(e.delta)
      state.inDeltaStream = true
      break
    case 'assistant_message':
      if (state.inDeltaStream) {
        // Deltas already rendered the text; just close the line.
        process.stdout.write('\n')
        state.inDeltaStream = false
      } else {
        console.log(e.text)
      }
      break
    case 'tool_call':
      if (state.inDeltaStream) {
        process.stdout.write('\n')
        state.inDeltaStream = false
      }
      console.log(`  [tool: ${e.name} ${e.arguments}]`)
      break
    case 'tool_result':
      console.log(`  [result: ${e.result.split('\n')[0]?.slice(0, 100)}]`)
      break
    case 'tool_error':
      console.log(`  [tool error: ${e.name} — ${e.error}]`)
      break
    case 'error':
      if (state.inDeltaStream) {
        process.stdout.write('\n')
        state.inDeltaStream = false
      }
      console.log(`  [error: ${e.error}]`)
      break
  }
}

async function streamTurn(
  client: ReturnType<typeof createClient>,
  agentId: string,
  message: string,
  images?: ImageAttachment[],
): Promise<void> {
  const state: PrintState = { inDeltaStream: false }
  for await (const frame of client.stream<ChatFrame>('POST', `/api/agents/${agentId}/chat`, {
    message,
    ...(images && images.length > 0 ? { images } : {}),
  })) {
    if (frame.kind === 'event') {
      if (frame.event.type !== 'user_message') printEvent(frame.event, state)
    } else if (frame.kind === 'fatal') {
      if (state.inDeltaStream) process.stdout.write('\n')
      throw new Error(frame.error)
    }
  }
}

const chatCmd = defineCommand({
  meta: { name: 'chat', description: 'Chat with an agent' },
  args: {
    id: { type: 'positional', required: true },
    message: {
      type: 'string',
      description: 'Send a single message and exit (one-shot mode)',
    },
    image: {
      type: 'string',
      description: 'Attach an image file (png/jpg/gif/webp; repeatable). One-shot mode.',
    },
  },
  async run({ args }) {
    const client = createClient()
    const resolved = await client.get<ResolvedAgent>(`/api/agents/${args.id}`)

    // citty gives a string for one --image, an array for several.
    const imagePaths = args.image
      ? Array.isArray(args.image)
        ? (args.image as string[])
        : [args.image]
      : []
    const images = loadImages(imagePaths)

    if (args.message || images.length > 0) {
      await streamTurn(client, resolved.agent.id, args.message ?? '', images)
      return
    }

    console.log(`chatting with ${resolved.agent.name} (${resolved.model})`)
    console.log('(type /exit to quit)')

    const rl = createInterface({ input: stdin, output: stdout })
    rl.setPrompt('> ')
    rl.prompt()

    for await (const line of rl) {
      const trimmed = line.trim()
      if (trimmed === '/exit' || trimmed === '/quit') break
      if (!trimmed) {
        rl.prompt()
        continue
      }
      try {
        await streamTurn(client, resolved.agent.id, trimmed)
      } catch (err) {
        console.error(`error: ${(err as Error).message}`)
      }
      rl.prompt()
    }
    rl.close()
  },
})

const chatResetCmd = defineCommand({
  meta: { name: 'chat-reset', description: "Reset an agent's chat history to empty" },
  args: {
    id: { type: 'positional', required: true },
    force: { type: 'boolean', description: 'Skip the y/N prompt' },
  },
  async run({ args }) {
    if (!args.force) {
      process.stdout.write(`reset all chat history for ${args.id}? [y/N] `)
      const answer = await new Promise<string>((resolve) => {
        process.stdin.once('data', (d) => resolve(String(d).trim().toLowerCase()))
      })
      if (answer !== 'y' && answer !== 'yes') {
        console.log('aborted')
        return
      }
    }
    const client = createClient()
    await client.post(`/api/agents/${args.id}/chat/reset`)
    console.log(`reset chat history for ${args.id}`)
  },
})

const chatTrimCmd = defineCommand({
  meta: {
    name: 'chat-trim',
    description: "Keep the first N messages of an agent's chat history; drop the rest",
  },
  args: {
    id: { type: 'positional', required: true },
    keep: { type: 'string', required: true, description: 'Number of leading messages to keep' },
  },
  async run({ args }) {
    const n = Number(args.keep)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error('--keep must be a non-negative integer')
    }
    const client = createClient()
    const body: TruncateChatRequest = { keepCount: n }
    const res = await client.post<TruncateChatResponse>(
      `/api/agents/${args.id}/chat/truncate`,
      body,
    )
    console.log(
      `trimmed: ${res.before} → ${res.after} messages (${res.before - res.after} dropped)`,
    )
  },
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

const chatContextCmd = defineCommand({
  meta: {
    name: 'chat-context',
    description: "Break down what consumes the agent's context window",
  },
  args: {
    id: { type: 'positional', required: true },
    detail: {
      type: 'boolean',
      description: 'Include every tool/skill entry instead of the top 30',
    },
    json: { type: 'boolean', description: 'Emit raw JSON instead of a human report' },
  },
  async run({ args }) {
    const client = createClient()
    const query = args.detail || args.json ? '?detail=1' : ''
    const ctx = await client.get<ChatContextResponse>(`/api/agents/${args.id}/chat/context${query}`)
    if (args.json) {
      console.log(JSON.stringify(ctx, null, 2))
      return
    }

    const fmt = (chars: number, tokens: number): string =>
      `${chars.toLocaleString()} chars (~${tokens.toLocaleString()} tok)`

    console.log(`🧠 context for ${ctx.agentId}`)
    console.log(`model: ${ctx.model}`)
    console.log('')
    console.log('## system prompt')
    console.log(`  total: ${fmt(ctx.systemPrompt.chars, ctx.systemPrompt.tokens)}`)
    if (ctx.systemPrompt.files.length > 0) {
      console.log('  profile files:')
      for (const f of ctx.systemPrompt.files) {
        console.log(`    - ${f.name}: ${fmt(f.chars, f.tokens)}`)
      }
    }
    if (ctx.systemPrompt.skillsListChars > 0) {
      console.log(`  skills line: ${ctx.systemPrompt.skillsListChars.toLocaleString()} chars`)
    }
    if (ctx.systemPrompt.groupListChars > 0) {
      console.log(`  group block: ${ctx.systemPrompt.groupListChars.toLocaleString()} chars`)
    }
    if (ctx.systemPrompt.userMdChars > 0) {
      console.log(`  user_md block: ${ctx.systemPrompt.userMdChars.toLocaleString()} chars`)
    }
    console.log(`  memory hint: ${ctx.systemPrompt.memoryHintChars.toLocaleString()} chars`)
    console.log('')
    console.log('## tools')
    console.log(`  count: ${ctx.tools.count}`)
    console.log(
      `  schemas (JSON): ${ctx.tools.schemaChars.toLocaleString()} chars (~${estimate(ctx.tools.schemaChars).toLocaleString()} tok)`,
    )
    console.log(`  list text: ${ctx.tools.listChars.toLocaleString()} chars`)
    if (ctx.tools.entries.length > 0) {
      console.log('  top tools by schema size:')
      for (const t of ctx.tools.entries) {
        const params = t.paramCount != null ? ` (${t.paramCount} params)` : ''
        console.log(`    - ${t.name}: ${t.schemaChars.toLocaleString()} chars${params}`)
      }
    }
    console.log('')
    if (ctx.skills.count > 0) {
      console.log('## skills')
      console.log(`  count: ${ctx.skills.count}`)
      for (const s of ctx.skills.entries) {
        console.log(`    - ${s.name}: ${s.blockChars.toLocaleString()} chars`)
      }
      console.log('')
    }
    console.log('## group')
    console.log(`    - ${ctx.group.id} (${ctx.group.name}): ${ctx.group.path}`)
    if (ctx.group.userMdChars > 0) {
      console.log(`    user_md: ${ctx.group.userMdChars.toLocaleString()} chars`)
    }
    console.log('')
    console.log('## history')
    console.log(`  messages:    ${ctx.history.messageEntries}`)
    console.log(`  compactions: ${ctx.history.compactionEntries}`)
    console.log(`  total:       ${fmt(ctx.history.chars, ctx.history.tokensEstimate)}`)
    console.log(`  bytes:       ${formatBytes(ctx.history.bytes)}`)
    console.log('')
    console.log(`TOTAL: ${fmt(ctx.totals.chars, ctx.totals.tokens)}`)
  },
})

function estimate(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4)
}

const chatCompactCmd = defineCommand({
  meta: {
    name: 'chat-compact',
    description: "Summarize the head of an agent's chat log, preserving the tail verbatim",
  },
  args: {
    id: { type: 'positional', required: true },
    'keep-tail': {
      type: 'string',
      description: 'Message entries to keep verbatim after the summary (default 10)',
    },
    instructions: {
      type: 'string',
      description: 'Optional extra guidance prepended to the summarizer prompt',
    },
    force: { type: 'boolean', description: 'Skip the y/N prompt' },
  },
  async run({ args }) {
    if (!args.force) {
      process.stdout.write(
        `compact chat history for ${args.id}? head turns become a summary; tail is preserved. [y/N] `,
      )
      const answer = await new Promise<string>((resolve) => {
        process.stdin.once('data', (d) => resolve(String(d).trim().toLowerCase()))
      })
      if (answer !== 'y' && answer !== 'yes') {
        console.log('aborted')
        return
      }
    }
    const keepTailNum = args['keep-tail'] ? Number(args['keep-tail']) : undefined
    if (keepTailNum !== undefined && (!Number.isFinite(keepTailNum) || keepTailNum < 0)) {
      console.error('--keep-tail must be a non-negative integer')
      process.exitCode = 1
      return
    }
    const body: ChatCompactRequest = {}
    if (keepTailNum !== undefined) body.keepTail = Math.floor(keepTailNum)
    if (args.instructions) body.customInstructions = args.instructions
    const client = createClient()
    const res = await client.post<ChatCompactResponse>(`/api/agents/${args.id}/chat/compact`, body)
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

// --- skill subcommand ---

const skillAddCmd = defineCommand({
  meta: { name: 'add', description: 'Attach a skill to an agent' },
  args: {
    agent: { type: 'positional', required: true },
    skill: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const body: AttachSkillRequest = { skill: args.skill }
    await client.post(`/api/agents/${args.agent}/skills`, body)
    console.log(`attached skill ${args.skill} to ${args.agent}`)
  },
})

const skillRmCmd = defineCommand({
  meta: { name: 'rm', description: 'Detach a skill from an agent' },
  args: {
    agent: { type: 'positional', required: true },
    skill: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/agents/${args.agent}/skills/${encodeURIComponent(args.skill)}`)
    console.log(`detached skill ${args.skill} from ${args.agent}`)
  },
})

const skillCmd = defineCommand({
  meta: { name: 'skill', description: 'Attach/detach skills on an agent' },
  subCommands: {
    add: skillAddCmd,
    rm: skillRmCmd,
  },
})

// --- group membership ---

const moveCmd = defineCommand({
  meta: { name: 'move', description: 'Move an agent to a different group' },
  args: {
    agent: { type: 'positional', required: true },
    group: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const body: MoveAgentRequest = { groupId: args.group }
    await client.patch(`/api/agents/${args.agent}/group`, body)
    console.log(`moved ${args.agent} to group ${args.group}`)
  },
})

const sessionHeadCmd = defineCommand({
  meta: {
    name: 'session-head',
    description: "Print the agent's current session file head (for stale-tab checks)",
  },
  args: {
    id: { type: 'positional', required: true },
    json: { type: 'boolean', description: 'Emit raw JSON instead of a human line' },
  },
  async run({ args }) {
    const client = createClient()
    const head = await client.get<SessionHeadResponse>(`/api/agents/${args.id}/sessions/head`)
    if (args.json) {
      console.log(JSON.stringify(head))
      return
    }
    console.log(head.file ? `${head.file} (${head.size} bytes)` : '(no session yet)')
  },
})

const cancelCmd = defineCommand({
  meta: { name: 'cancel', description: "Abort the agent's currently-running turn" },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.post(`/api/agents/${args.id}/cancel`)
    console.log(`cancelled active turn for ${args.id}`)
  },
})

export const agentCommand = defineCommand({
  meta: { name: 'agent', description: 'Manage agent instances' },
  subCommands: {
    spawn: spawnCmd,
    list: listCmd,
    show: showCmd,
    edit: editCmd,
    archive: archiveCmd,
    unarchive: unarchiveCmd,
    delete: deleteCmd,
    chat: chatCmd,
    'chat-reset': chatResetCmd,
    'chat-trim': chatTrimCmd,
    'chat-context': chatContextCmd,
    'chat-compact': chatCompactCmd,
    cancel: cancelCmd,
    skill: skillCmd,
    move: moveCmd,
    'session-head': sessionHeadCmd,
  },
})

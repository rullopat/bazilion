import { readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import type {
  Agent,
  AgentLessonProposal,
  AgentLessonProposalResponse,
  AgentLessonStatus,
  AgentReviewConfig,
  Attachment,
  AttachSkillRequest,
  BashApprovalMode,
  ChatCompactRequest,
  ChatCompactResponse,
  ChatContextResponse,
  ChatFrame,
  ChatRequest,
  CommandApproval,
  CommandApprovalDecisionRequest,
  EnqueueAgentReviewResponse,
  ListAgentLessonProposalsResponse,
  ListAgentReviewsResponse,
  MoveAgentRequest,
  ResolvedAgent,
  ResolvedTeamPolicy,
  SessionEvent,
  SessionHeadResponse,
  SkillScanFinding,
  SpawnAgentRequest,
  TruncateChatRequest,
  TruncateChatResponse,
  UpdateAgentReviewConfigRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { ApiClientError, createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Read image file paths into base64 attachments (image mime → routed to vision). */
function loadImages(paths: string[]): Attachment[] {
  return paths.map((p) => {
    const mimeType = IMAGE_MIME[extname(p).toLowerCase()]
    if (!mimeType) throw new Error(`unsupported image type: ${p} (png/jpg/gif/webp only)`)
    return { name: basename(p), mimeType, data: readFileSync(p).toString('base64') }
  })
}

const FILE_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
}

/** Read arbitrary file paths into base64 attachments (non-image → stored + referenced). */
function loadFiles(paths: string[]): Attachment[] {
  return paths.map((p) => ({
    name: basename(p),
    mimeType: FILE_MIME[extname(p).toLowerCase()] ?? 'application/octet-stream',
    data: readFileSync(p).toString('base64'),
  }))
}

/** citty gives a string for one flag, an array for several — normalize. */
function asPaths(v: string | string[] | undefined): string[] {
  return v ? (Array.isArray(v) ? v : [v]) : []
}

const spawnCmd = defineCommand({
  meta: { name: 'spawn', description: 'Spawn an agent from a profile into a team' },
  args: {
    profile: { type: 'string', required: true, description: 'Profile id' },
    name: { type: 'string', description: 'Agent name (defaults to profile name)' },
    team: {
      type: 'string',
      description: "Team to join (defaults to 'default')",
    },
    model: { type: 'string', description: 'Override profile default model' },
    reasoning: {
      type: 'string',
      description: 'Reasoning level: off|minimal|low|medium|high|xhigh (default: medium)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const teamId = args.team ?? 'default'
    const policy = await client.get<ResolvedTeamPolicy>(
      `/api/teams/${encodeURIComponent(teamId)}/policy`,
    )
    const body: SpawnAgentRequest = {
      profileId: args.profile,
      name: args.name,
      model: args.model,
      reasoningLevel: args.reasoning as SpawnAgentRequest['reasoningLevel'],
      teamId,
      teamExpectedRevision: policy.teamPolicy.revision,
      placement: 'profile_defaults',
    }
    const response = await client.post<{ agent: Agent }>('/api/agents', body)
    const agent = response.agent
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
    console.log(`team:   ${r.team.id} ${r.team.path}`)
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
    const agent = await client.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(args.id)}`)
    const policy = await client.get<ResolvedTeamPolicy>(
      `/api/teams/${encodeURIComponent(agent.team.id)}/policy`,
    )
    await client.del(
      `/api/agents/${encodeURIComponent(args.id)}?expectedTeamRevision=${policy.teamPolicy.revision}`,
    )
    console.log(`deleted agent ${args.id}`)
  },
})

// --- chat ---

interface PrintState {
  inDeltaStream: boolean
}

type CommandApprovalDecision = CommandApprovalDecisionRequest['decision']

interface CommandApprovalClient {
  post(path: string, body?: unknown): Promise<unknown>
}

export interface CommandApprovalPrompt {
  question(prompt: string): Promise<string>
  write(line: string): void
}

/** Only a real terminal can answer while the chat response stream remains open. */
export function bashApprovalModeForTty(
  inputIsTty: boolean | undefined,
  outputIsTty: boolean | undefined,
): BashApprovalMode {
  return inputIsTty && outputIsTty ? 'interactive' : 'auto_deny'
}

/** Build every CLI chat request with an explicit approval capability. */
export function buildChatRequest(
  message: string,
  attachments: Attachment[] | undefined,
  bashApprovalMode: BashApprovalMode,
): ChatRequest {
  return {
    message,
    bashApprovalMode,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  }
}

function terminalSafe(value: string): string {
  let safe = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    const isControl = code <= 9 || (code >= 11 && code <= 31) || (code >= 127 && code <= 159)
    safe += isControl ? `\\x${code.toString(16).padStart(2, '0')}` : character
  }
  return safe
}

/** Render one pending command and default safely to denial for every answer except y/yes. */
export async function promptForCommandApproval(
  approval: CommandApproval,
  prompt: CommandApprovalPrompt,
): Promise<CommandApprovalDecision> {
  prompt.write('  [shell command approval required]')
  prompt.write('  command:')
  for (const line of approval.command.split('\n')) prompt.write(`    ${terminalSafe(line)}`)
  prompt.write('  risks:')
  for (const risk of approval.risks) {
    prompt.write(
      `    - ${terminalSafe(risk.code)} (${terminalSafe(risk.severity)}): ${terminalSafe(risk.message)}`,
    )
  }

  try {
    const answer = (await prompt.question('  Allow this command once? [y/N] ')).trim().toLowerCase()
    return answer === 'y' || answer === 'yes' ? 'allow' : 'deny'
  } catch {
    prompt.write('  [approval input unavailable; denying]')
    return 'deny'
  }
}

/** Post exactly one response for a pending approval; callers without a prompt deny immediately. */
export async function respondToCommandApproval(
  client: CommandApprovalClient,
  approval: CommandApproval,
  prompt?: CommandApprovalPrompt,
): Promise<CommandApprovalDecision> {
  const decision = prompt ? await promptForCommandApproval(approval, prompt) : 'deny'
  await client.post(`/api/shell-approvals/${encodeURIComponent(approval.id)}`, { decision })
  return decision
}

function closeDeltaLine(state: PrintState): void {
  if (!state.inDeltaStream) return
  process.stdout.write('\n')
  state.inDeltaStream = false
}

function printCommandApprovalStatus(approval: CommandApproval): void {
  switch (approval.status) {
    case 'allowed':
      console.log('  [shell command allowed]')
      break
    case 'denied':
      console.log('  [shell command denied]')
      break
    case 'auto_denied':
      console.log('  [shell command auto-denied: non-interactive turn]')
      break
    case 'expired':
      console.log('  [shell command approval expired]')
      break
    case 'cancelled':
      console.log('  [shell command approval cancelled]')
      break
    case 'pending':
      break
  }
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
    case 'file': {
      if (state.inDeltaStream) {
        process.stdout.write('\n')
        state.inDeltaStream = false
      }
      const out = basename(e.name).replace(/[^\w.-]/g, '_') || 'file'
      writeFileSync(out, Buffer.from(e.data, 'base64'))
      console.log(`  [file received: saved to ./${out} (${e.mimeType})]`)
      break
    }
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
  attachments?: Attachment[],
  options: {
    bashApprovalMode: BashApprovalMode
    approvalPrompt?: CommandApprovalPrompt
  } = { bashApprovalMode: 'auto_deny' },
): Promise<void> {
  const state: PrintState = { inDeltaStream: false }
  const respondedApprovalIds = new Set<string>()
  for await (const frame of client.stream<ChatFrame>(
    'POST',
    `/api/agents/${agentId}/chat`,
    buildChatRequest(message, attachments, options.bashApprovalMode),
  )) {
    if (frame.kind === 'event') {
      // A pending approval pauses rendering while we post a response on a
      // separate authenticated request; other events remain synchronous.
      const event = frame.event
      if (event.type === 'command_approval') {
        closeDeltaLine(state)
        const approval = event.approval
        if (approval.status === 'pending') {
          if (!respondedApprovalIds.has(approval.id)) {
            respondedApprovalIds.add(approval.id)
            await respondToCommandApproval(client, approval, options.approvalPrompt)
          }
        } else {
          printCommandApprovalStatus(approval)
        }
      } else if (event.type !== 'user_message') {
        printEvent(event, state)
      }
    } else if (frame.kind === 'fatal') {
      closeDeltaLine(state)
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
    file: {
      type: 'string',
      description: 'Attach any file — the agent gets a path reference (repeatable). One-shot mode.',
    },
  },
  async run({ args }) {
    const client = createClient()
    const resolved = await client.get<ResolvedAgent>(`/api/agents/${args.id}`)
    const bashApprovalMode = bashApprovalModeForTty(stdin.isTTY, stdout.isTTY)

    const attachments = [
      ...loadImages(asPaths(args.image as string | string[] | undefined)),
      ...loadFiles(asPaths(args.file as string | string[] | undefined)),
    ]

    if (args.message || attachments.length > 0) {
      const rl =
        bashApprovalMode === 'interactive'
          ? createInterface({ input: stdin, output: stdout })
          : null
      try {
        await streamTurn(client, resolved.agent.id, args.message ?? '', attachments, {
          bashApprovalMode,
          ...(rl
            ? {
                approvalPrompt: {
                  question: (question) => rl.question(question),
                  write: (line) => console.log(line),
                },
              }
            : {}),
        })
      } finally {
        rl?.close()
      }
      return
    }

    console.log(`chatting with ${resolved.agent.name} (${resolved.model})`)
    console.log('(type /exit to quit)')

    const rl = createInterface({ input: stdin, output: stdout })
    try {
      if (bashApprovalMode === 'interactive') {
        // Sequential questions keep one readline instance as the sole stdin
        // owner. A command-approval question can safely run after the chat
        // question resolves; no async iterator is consuming lines in parallel.
        while (true) {
          let line: string
          try {
            line = await rl.question('> ')
          } catch {
            break
          }
          const trimmed = line.trim()
          if (trimmed === '/exit' || trimmed === '/quit') break
          if (!trimmed) continue
          try {
            await streamTurn(client, resolved.agent.id, trimmed, undefined, {
              bashApprovalMode,
              approvalPrompt: {
                question: (question) => rl.question(question),
                write: (output) => console.log(output),
              },
            })
          } catch (err) {
            console.error(`error: ${(err as Error).message}`)
          }
        }
      } else {
        // Preserve piped multi-line chat input, but never claim that this
        // caller can answer an approval request.
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
            await streamTurn(client, resolved.agent.id, trimmed, undefined, {
              bashApprovalMode,
            })
          } catch (err) {
            console.error(`error: ${(err as Error).message}`)
          }
          rl.prompt()
        }
      }
    } finally {
      rl.close()
    }
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
    if (ctx.systemPrompt.teamListChars > 0) {
      console.log(`  team block: ${ctx.systemPrompt.teamListChars.toLocaleString()} chars`)
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
    console.log('## team')
    console.log(`    - ${ctx.team.id} (${ctx.team.name}): ${ctx.team.path}`)
    if (ctx.team.userMdChars > 0) {
      console.log(`    user_md: ${ctx.team.userMdChars.toLocaleString()} chars`)
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
    'allow-warnings': {
      type: 'boolean',
      description: 'Attach even when the static skill scan reports findings',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: AttachSkillRequest = { skill: args.skill, allowFindings: args['allow-warnings'] }
    try {
      await client.post(`/api/agents/${args.agent}/skills`, body)
    } catch (err) {
      if (err instanceof ApiClientError && err.body.code === 'skill_scan_blocked') {
        console.error(`error: ${err.body.error}`)
        printSkillFindings(err.body.findings ?? [])
        console.error('  hint: inspect the skill, then rerun with --allow-warnings to confirm')
        process.exitCode = 1
        return
      }
      throw err
    }
    console.log(`attached skill ${args.skill} to ${args.agent}`)
  },
})

function printSkillFindings(findings: SkillScanFinding[]): void {
  if (findings.length === 0) return
  console.error('scan findings:')
  for (const f of findings) {
    const line = f.line ? ` line ${f.line}` : ''
    console.error(`  ${f.severity}: ${f.code}${line} - ${f.message}`)
  }
}

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

// --- team membership ---

const moveCmd = defineCommand({
  meta: { name: 'move', description: 'Move an agent to a different team' },
  args: {
    agent: { type: 'positional', required: true },
    team: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const [agent, destination] = await Promise.all([
      client.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(args.agent)}`),
      client.get<ResolvedTeamPolicy>(`/api/teams/${encodeURIComponent(args.team)}/policy`),
    ])
    const source = await client.get<ResolvedTeamPolicy>(
      `/api/teams/${encodeURIComponent(agent.team.id)}/policy`,
    )
    const body: MoveAgentRequest = {
      teamId: args.team,
      sourceExpectedRevision: source.teamPolicy.revision,
      destinationExpectedRevision: destination.teamPolicy.revision,
      placement: 'profile_defaults',
    }
    await client.patch(`/api/agents/${args.agent}/team`, body)
    console.log(`moved ${args.agent} to team ${args.team}`)
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

const reviewConfigCmd = defineCommand({
  meta: { name: 'review-config', description: 'Inspect or configure reviewed learning' },
  args: {
    id: { type: 'positional', required: true, description: 'Agent id or prefix' },
    enable: { type: 'boolean', description: 'Enable periodic reviews' },
    disable: { type: 'boolean', description: 'Disable periodic reviews' },
    every: { type: 'string', description: 'Successful user turns between reviews (1-100)' },
    model: { type: 'string', description: "Review model, or 'agent' to use the Agent model" },
    reasoning: { type: 'string', description: 'Review reasoning level' },
  },
  async run({ args }) {
    if (args.enable && args.disable) throw new Error('choose either --enable or --disable')
    const client = createClient()
    const body: UpdateAgentReviewConfigRequest = {}
    if (args.enable || args.disable) body.enabled = Boolean(args.enable)
    if (args.every !== undefined) {
      const value = Number(args.every)
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error('--every must be an integer from 1 to 100')
      }
      body.everyNTurns = value
    }
    if (args.model !== undefined) body.model = args.model === 'agent' ? null : args.model
    if (args.reasoning !== undefined) {
      body.reasoningLevel = args.reasoning as UpdateAgentReviewConfigRequest['reasoningLevel']
    }
    const hasChanges = Object.keys(body).length > 0
    const config = hasChanges
      ? await client.patch<AgentReviewConfig>(`/api/agents/${args.id}/review-config`, body)
      : await client.get<AgentReviewConfig>(`/api/agents/${args.id}/review-config`)
    console.log(`review: ${config.enabled ? 'enabled' : 'disabled'}`)
    console.log(`cadence: every ${config.everyNTurns} successful user turns`)
    console.log(`model: ${config.model ?? 'agent model'}`)
    console.log(`reasoning: ${config.reasoningLevel}`)
    console.log(`turns since last review: ${config.turnsSinceLast}`)
  },
})

const reviewCmd = defineCommand({
  meta: { name: 'review', description: 'Enqueue a reviewed-learning pass' },
  args: { id: { type: 'positional', required: true, description: 'Agent id or prefix' } },
  async run({ args }) {
    const response = await createClient().post<EnqueueAgentReviewResponse>(
      `/api/agents/${args.id}/reviews`,
    )
    console.log(`review ${response.review.id} ${response.review.status}`)
  },
})

const reviewsCmd = defineCommand({
  meta: { name: 'reviews', description: 'List reviewed-learning history' },
  args: { id: { type: 'positional', required: true, description: 'Agent id or prefix' } },
  async run({ args }) {
    const response = await createClient().get<ListAgentReviewsResponse>(
      `/api/agents/${args.id}/reviews`,
    )
    if (response.reviews.length === 0) return console.log('(no reviews)')
    console.log(
      columnize(
        response.reviews.map((review) => [
          review.id,
          review.status,
          review.trigger,
          `${review.proposalCount} proposal(s)`,
          new Date(review.createdAt).toISOString(),
        ]),
      ),
    )
  },
})

const lessonsCmd = defineCommand({
  meta: { name: 'lessons', description: 'List reviewed lesson proposals' },
  args: {
    id: { type: 'positional', required: true, description: 'Agent id or prefix' },
    status: { type: 'string', description: 'pending|approved|rejected|revoked' },
  },
  async run({ args }) {
    const status = args.status as AgentLessonStatus | undefined
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    const response = await createClient().get<ListAgentLessonProposalsResponse>(
      `/api/agents/${args.id}/lesson-proposals${query}`,
    )
    if (response.proposals.length === 0) return console.log('(no lesson proposals)')
    console.log(
      columnize(
        response.proposals.map((proposal) => [
          proposal.id,
          proposal.status,
          proposal.scope,
          proposal.text,
        ]),
      ),
    )
  },
})

async function locateProposal(
  id: string,
): Promise<{ agent: Agent; proposal: AgentLessonProposal }> {
  const client = createClient()
  const agents = await client.get<Agent[]>('/api/agents?includeArchived=true')
  for (const agent of agents) {
    const response = await client.get<ListAgentLessonProposalsResponse>(
      `/api/agents/${agent.id}/lesson-proposals`,
    )
    const proposal = response.proposals.find((item) => item.id === id || item.id.startsWith(id))
    if (proposal) return { agent, proposal }
  }
  throw new Error(`lesson proposal not found: ${id}`)
}

function lessonDecisionCmd(decision: 'approve' | 'reject' | 'revoke') {
  return defineCommand({
    meta: { name: decision, description: `${decision} a reviewed lesson proposal` },
    args: {
      id: { type: 'positional', required: true, description: 'Proposal id or prefix' },
      yes: { type: 'boolean', description: `Confirm ${decision}` },
    },
    async run({ args }) {
      if (!args.yes) throw new Error(`${decision} requires --yes`)
      const { agent, proposal } = await locateProposal(args.id)
      const response = await createClient().post<AgentLessonProposalResponse>(
        `/api/agents/${agent.id}/lesson-proposals/${proposal.id}/${decision}`,
        { version: proposal.version },
      )
      console.log(`${response.proposal.status} ${response.proposal.id}`)
    },
  })
}

const lessonEditCmd = defineCommand({
  meta: { name: 'edit', description: 'Edit a pending reviewed lesson proposal' },
  args: {
    id: { type: 'positional', required: true, description: 'Proposal id or prefix' },
    text: { type: 'string', description: 'Replacement lesson text' },
    scope: { type: 'string', description: 'private|shared' },
  },
  async run({ args }) {
    if (args.text === undefined && args.scope === undefined) {
      throw new Error('lesson edit requires --text or --scope')
    }
    const { agent, proposal } = await locateProposal(args.id)
    const response = await createClient().patch<AgentLessonProposalResponse>(
      `/api/agents/${agent.id}/lesson-proposals/${proposal.id}`,
      { version: proposal.version, text: args.text, scope: args.scope },
    )
    console.log(`updated ${response.proposal.id} v${response.proposal.version}`)
  },
})

const lessonCmd = defineCommand({
  meta: { name: 'lesson', description: 'Edit or decide a reviewed lesson proposal' },
  subCommands: {
    edit: lessonEditCmd,
    approve: lessonDecisionCmd('approve'),
    reject: lessonDecisionCmd('reject'),
    revoke: lessonDecisionCmd('revoke'),
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
    'review-config': reviewConfigCmd,
    review: reviewCmd,
    reviews: reviewsCmd,
    lessons: lessonsCmd,
    lesson: lessonCmd,
    skill: skillCmd,
    move: moveCmd,
    'session-head': sessionHeadCmd,
  },
})

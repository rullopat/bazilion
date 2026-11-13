import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface, type Interface } from 'node:readline/promises'
import type {
  Attachment,
  BashApprovalMode,
  ChatFrame,
  ChatRequest,
  CommandApproval,
  CommandApprovalDecisionRequest,
  ResolvedAgent,
  SessionEvent,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { type BazilionClient, createClient } from '../client.ts'
import { agentArg, apiPath, loadAttachments, terminalSafe } from '../command-helpers.ts'
import { printError } from '../errors.ts'
import { promptForQuestion, type QuestionPrompt } from '../question-prompt.ts'

export interface PrintState {
  inDeltaStream: boolean
  /** Per running tool call: the complete lines of its live output already printed. */
  progress: Map<string, string>
}

/**
 * The complete lines of a cumulative live-output tail that were not printed yet. The tail may have
 * slid forward since the last update (the daemon starts a cut tail on a line boundary), so what was
 * printed is matched against its start at each line boundary.
 */
export function unprintedProgress(
  printed: string,
  output: string,
): { complete: string; fresh: string } {
  const complete = output.slice(0, output.lastIndexOf('\n') + 1)
  for (let start = 0; start < printed.length; ) {
    const rest = printed.slice(start)
    if (complete.startsWith(rest)) return { complete, fresh: complete.slice(rest.length) }
    start = printed.indexOf('\n', start) + 1
    if (start === 0) break
  }
  return { complete, fresh: complete }
}

type CommandApprovalDecision = CommandApprovalDecisionRequest['decision']

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

/** Every CLI chat request states whether the caller can answer shell approvals. */
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

/** Render one pending command; every answer except y/yes denies it. */
export async function promptForCommandApproval(
  approval: CommandApproval,
  prompt: CommandApprovalPrompt,
): Promise<CommandApprovalDecision> {
  prompt.write('  [shell command approval required]')
  prompt.write('  command:')
  for (const line of approval.command.split('\n')) prompt.write(`    ${terminalSafe(line)}`)
  prompt.write('  risks:')
  for (const risk of approval.risks) {
    prompt.write(`    - ${terminalSafe(risk.code)}: ${terminalSafe(risk.message)}`)
  }
  try {
    const answer = (await prompt.question('  Allow this command once? [y/N] ')).trim().toLowerCase()
    return answer === 'y' || answer === 'yes' ? 'allow' : 'deny'
  } catch {
    prompt.write('  [approval input unavailable; denying]')
    return 'deny'
  }
}

/** Post one decision for a pending approval; without a prompt it is denied at once. */
export async function respondToCommandApproval(
  client: { post(path: string, body?: unknown): Promise<unknown> },
  approval: CommandApproval,
  prompt?: CommandApprovalPrompt,
): Promise<CommandApprovalDecision> {
  const decision = prompt ? await promptForCommandApproval(approval, prompt) : 'deny'
  await client.post(apiPath('shell-approvals', approval.id), { decision })
  return decision
}

const APPROVAL_OUTCOMES: Partial<Record<CommandApproval['status'], string>> = {
  allowed: 'shell command allowed',
  denied: 'shell command denied',
  auto_denied: 'shell command auto-denied: non-interactive turn',
  expired: 'shell command approval expired',
  cancelled: 'shell command approval cancelled',
}

function closeDeltaLine(state: PrintState): void {
  if (!state.inDeltaStream) return
  process.stdout.write('\n')
  state.inDeltaStream = false
}

/** Print one chat event. Tool output is shown terminal-safe: it may carry escape sequences. */
export function printEvent(e: SessionEvent, state: PrintState): void {
  switch (e.type) {
    case 'assistant_delta':
      process.stdout.write(e.delta)
      state.inDeltaStream = true
      break
    case 'assistant_message':
      // Streamed deltas already printed the text.
      if (state.inDeltaStream) closeDeltaLine(state)
      else console.log(e.text)
      break
    case 'tool_call':
      closeDeltaLine(state)
      console.log(`  [tool: ${e.name} ${e.arguments}]`)
      break
    case 'tool_progress': {
      closeDeltaLine(state)
      const { complete, fresh } = unprintedProgress(state.progress.get(e.id) ?? '', e.output)
      state.progress.set(e.id, complete)
      for (const line of fresh.split('\n').slice(0, -1)) {
        console.log(`  | ${terminalSafe(line, true)}`)
      }
      break
    }
    case 'tool_result':
      state.progress.delete(e.id)
      console.log(`  [result: ${terminalSafe(e.result.split('\n')[0]?.slice(0, 100) ?? '', true)}]`)
      break
    case 'tool_error':
      state.progress.delete(e.id)
      console.log(`  [tool error: ${e.name} — ${terminalSafe(e.error, true)}]`)
      break
    case 'error':
      closeDeltaLine(state)
      console.log(`  [error: ${e.error}]`)
      break
  }
}

/** Save a file the Agent delivered into the current directory, never over an existing file. */
async function saveDeliveredFile(
  client: BazilionClient,
  file: { name: string; mimeType: string; result: { resultId: string } },
): Promise<void> {
  const out = basename(file.name).replace(/[^\w.-]/g, '_') || 'file'
  try {
    const bytes = await client.binary(apiPath('results', file.result.resultId, 'download'))
    writeFileSync(out, bytes, { flag: 'wx' })
    console.log(`  [file received: saved to ./${out} (${file.mimeType})]`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    console.log(
      `  [file not written: ./${out} already exists; saved as result ${file.result.resultId} (bazilion result download)]`,
    )
  }
}

interface TurnPrompts {
  approval?: CommandApprovalPrompt
  question?: QuestionPrompt
}

function terminalPrompts(rl: Interface): TurnPrompts {
  const write = (line: string) => console.log(line)
  return {
    approval: { question: (text) => rl.question(text), write },
    question: { question: (text, signal) => rl.question(text, { signal }), write },
  }
}

/** Run one turn and print it as it streams, answering approvals and questions on the way. */
async function streamTurn(
  client: BazilionClient,
  agentId: string,
  request: ChatRequest,
  prompts: TurnPrompts = {},
): Promise<void> {
  const state: PrintState = { inDeltaStream: false, progress: new Map() }
  const answeredApprovals = new Set<string>()
  const askedQuestions = new Set<string>()
  // Only a turn started with a question prompt is offered ask_user.
  const body: ChatRequest = prompts.question ? { ...request, questionMode: 'tty' } : request
  for await (const frame of client.stream<ChatFrame>(
    'POST',
    apiPath('agents', agentId, 'chat'),
    body,
  )) {
    if (frame.kind === 'fatal') {
      closeDeltaLine(state)
      throw new Error(frame.error)
    }
    if (frame.kind !== 'event') continue
    const event = frame.event
    if (event.type === 'command_approval') {
      closeDeltaLine(state)
      const approval = event.approval
      if (approval.status !== 'pending') {
        const outcome = APPROVAL_OUTCOMES[approval.status]
        if (outcome) console.log(`  [${outcome}]`)
      } else if (!answeredApprovals.has(approval.id)) {
        answeredApprovals.add(approval.id)
        await respondToCommandApproval(client, approval, prompts.approval)
      }
    } else if (event.type === 'agent_question') {
      closeDeltaLine(state)
      const item = event.question
      if (!prompts.question || item.agentId !== agentId || askedQuestions.has(item.id)) continue
      askedQuestions.add(item.id)
      const answer = await promptForQuestion(item, prompts.question)
      if (!answer) continue
      await client
        .questions(agentId)
        .answer(item.id, answer)
        .catch((error: unknown) => {
          console.error(
            `Answer not accepted: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
    } else if (event.type === 'file') {
      closeDeltaLine(state)
      await saveDeliveredFile(client, event)
    } else if (event.type !== 'user_message') {
      printEvent(event, state)
      // A turn that failed or was cancelled exits non-zero, so a script can tell it apart.
      if (event.type === 'error') process.exitCode = 1
    }
  }
}

export const chatCommand = defineCommand({
  meta: {
    name: 'chat',
    description: 'Send one message to an agent, or one per line of piped input',
  },
  args: {
    id: agentArg,
    message: { type: 'string', description: 'Send a single message and exit (one-shot mode)' },
    image: {
      type: 'string',
      description:
        'Attach an image file (png/jpg/gif/webp; repeat the flag for more). One-shot mode.',
    },
    file: {
      type: 'string',
      description:
        'Attach any file — the agent gets a path reference (repeat the flag for more). One-shot mode.',
    },
  },
  async run({ args, rawArgs }) {
    const client = createClient()
    const resolved = await client.get<ResolvedAgent>(apiPath('agents', args.id))
    const mode = bashApprovalModeForTty(stdin.isTTY, stdout.isTTY)
    const attachments = loadAttachments(rawArgs)

    if (args.message || attachments.length > 0) {
      // A terminal answers shell approvals and questions while the turn streams.
      const rl = mode === 'interactive' ? createInterface({ input: stdin, output: stdout }) : null
      try {
        await streamTurn(
          client,
          resolved.agent.id,
          buildChatRequest(args.message ?? '', attachments, mode),
          rl ? terminalPrompts(rl) : {},
        )
      } finally {
        rl?.close()
      }
      return
    }

    // Without --message, each line of piped input is one turn; nobody can answer an approval.
    if (mode === 'interactive') {
      throw new Error(
        'pass --message "..." to send one message; for a conversation, use the web UI',
      )
    }
    console.log(`chatting with ${resolved.agent.name} (${resolved.model})`)
    console.log('(type /exit to quit; input is piped, commands run with auto_deny)')
    const rl = createInterface({ input: stdin, output: stdout })
    let inputEnded = false
    rl.once('close', () => {
      inputEnded = true
    })
    try {
      rl.setPrompt('> ')
      rl.prompt()
      for await (const line of rl) {
        const message = line.trim()
        if (message === '/exit' || message === '/quit') break
        if (message) {
          try {
            await streamTurn(client, resolved.agent.id, buildChatRequest(message, undefined, mode))
          } catch (err) {
            printError(err)
          }
        }
        // Piped input usually ends during the first turn; its remaining lines are still read.
        if (!inputEnded) rl.prompt()
      }
    } finally {
      rl.close()
    }
  },
})

// The per-turn worker process. It reads one `WorkerInput` from stdin, runs one Pi session (an
// Agent turn, whatever its origin, or a learning review), writes NDJSON frames to stdout and
// reaches every daemon-owned tool over Node IPC (`ipc-protocol.ts`). It never opens the database.

import { randomUUID } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { resolvePaths } from '../../core/index.ts'
import { qmdBackend } from '../memory/qmd.ts'
import { paceToolProgress, piMessagesToProviderView, translatePiEvent } from '../pi/events.ts'
import {
  type BazilionSessionHandle,
  createBazilionSession,
  createRestrictedReviewSession,
} from '../pi/session.ts'
import type { BashApprovalHost } from '../shell/approval.ts'
import {
  createLessonReview,
  type LessonReview,
  REVIEW_SYSTEM_PROMPT,
} from '../tools/propose-lesson.ts'
import { workerFailureMessage } from './cancellation.ts'
import { createProcessIpcClient, type WorkerIpcCall } from './ipc-client.ts'
import { WorkerOutput } from './output.ts'
import {
  parseWorkerInput,
  redactExactValues,
  reviewRuntimeSecrets,
  type WorkerFrame,
  type WorkerInput,
} from './runtime.ts'

type AgentTurnInput = Extract<WorkerInput, { kind: 'agent_turn' }>
type ReviewInput = Extract<WorkerInput, { kind: 'restricted_review' }>

const output = new WorkerOutput(process.stdout)
let exiting: Promise<never> | undefined

/** The daemon redacts the turn's credentials from every frame it reads. */
function emit(frame: WorkerFrame): void {
  output.write(`${JSON.stringify(frame)}\n`)
}

function exitWorker(code: number): Promise<never> {
  exiting ??= output.finish().then((flushed) => process.exit(flushed ? code : 1))
  return exiting
}

async function readInput(): Promise<WorkerInput> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return parseWorkerInput(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

function ipcRefresher(input: WorkerInput, call: WorkerIpcCall) {
  if (!input.hosts.includes('apiKeyRefreshHost')) return undefined
  return (providerName: string) => call('refreshApiKey', { providerName })
}

function ipcBashApproval(call: WorkerIpcCall, input: AgentTurnInput): BashApprovalHost {
  return {
    async requestApproval(request) {
      const approval = await call('bashApproval', {
        id: randomUUID(),
        turnId: input.turnId,
        toolCallId: request.toolCallId,
        agentId: input.agent.agent.id,
        teamId: input.agent.team.id,
        command: request.command,
        risks: [...request.risks],
        mode: input.bashApprovalMode,
      })
      return approval.status === 'allowed' ? 'approved' : 'denied'
    },
  }
}

/** An Agent turn's session, with an IPC proxy for each tool host the daemon serves this turn. */
async function openAgentTurn(
  input: AgentTurnInput,
  call: WorkerIpcCall,
): Promise<BazilionSessionHandle> {
  const served = new Set(input.hosts)
  const memory = qmdBackend(`${input.agent.team.path}/memory`)
  await memory.init()
  return createBazilionSession({
    agent: input.agent,
    conversation: input.conversation,
    docker: input.docker,
    repositoryInstructions: input.repositoryInstructions,
    paths: resolvePaths(),
    env: process.env,
    memory,
    apiKey: input.apiKey,
    refreshApiKey: ipcRefresher(input, call),
    mcpTools: input.mcpTools,
    messagingHost: served.has('messagingHost')
      ? {
          agentExists: (agentId) => call('agentExists', { agentId }),
          sendMessage: (args) => call('sendMessage', args),
          listInbox: (agentId, { unreadOnly }) => call('listInbox', { agentId, unreadOnly }),
          markRead: async (messageId) => {
            await call('markRead', { messageId })
          },
          findReplies: (agentId, replyTo) => call('findReplies', { agentId, replyTo }),
        }
      : undefined,
    userMdHost: served.has('userMdHost')
      ? {
          get: (teamId) => call('userMdGet', { teamId }),
          write: (teamId, content, ifMatch) => call('userMdWrite', { teamId, content, ifMatch }),
        }
      : undefined,
    browserHost: served.has('browserHost')
      ? { invoke: (agentId, action, args) => call('browserInvoke', { agentId, action, args }) }
      : undefined,
    mcpHost: served.has('mcpHost')
      ? { invoke: (serverId, toolName, args) => call('mcpInvoke', { serverId, toolName, args }) }
      : undefined,
    webSearchHost: served.has('webSearchHost')
      ? { search: (args) => call('webSearch', args) }
      : undefined,
    imageGenerationHost: served.has('imageGenerationHost')
      ? {
          generate: async (request) => {
            const generated = await call('generateImages', request)
            for (const file of generated.files) {
              emit({ kind: 'event', event: { type: 'file', ...file } })
            }
            return generated
          },
        }
      : undefined,
    askUser: served.has('questionHost') ? (question) => call('askUser', { question }) : undefined,
    fileSink: served.has('resultHost')
      ? async (file, toolCallId) => {
          const result = await call('publishResult', { ...file, toolCallId })
          emit({
            kind: 'event',
            event: { type: 'file', result, name: file.name, mimeType: file.mimeType },
          })
          return result
        }
      : undefined,
    bashApprovalHost: served.has('bashApprovalHost') ? ipcBashApproval(call, input) : undefined,
  })
}

async function openReview(
  input: ReviewInput,
  call: WorkerIpcCall,
): Promise<{ handle: BazilionSessionHandle; review: LessonReview }> {
  const review = createLessonReview(input.evidence)
  const handle = await createRestrictedReviewSession({
    runtime: input.runtime,
    scratch: input.scratch,
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    tools: [review.tool],
    refreshApiKey: ipcRefresher(input, call),
  })
  return { handle, review }
}

/** The prompt text, without the turn's own credentials, and an Agent turn's images. */
function promptOf(input: WorkerInput): {
  text: string
  images?: Array<{ type: 'image'; data: string; mimeType: string }>
} {
  if (input.kind === 'restricted_review') {
    return { text: redactExactValues(input.message, reviewRuntimeSecrets(input.runtime)) }
  }
  const images = (input.images ?? []).map((image) => ({
    type: 'image' as const,
    data: image.data,
    mimeType: image.mimeType,
  }))
  return {
    text: redactExactValues(input.message, input.apiKey ? [input.apiKey] : []),
    ...(images.length > 0 ? { images } : {}),
  }
}

async function main(): Promise<void> {
  let aborted = false
  let session: AgentSession | null = null
  const onSignal = (): void => {
    aborted = true
    if (session) void session.abort()
    else {
      emit({ kind: 'event', event: { type: 'error', error: 'cancelled' } })
      void exitWorker(0)
    }
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  // The daemon closed the IPC channel (it exited, or ended this turn): stop working, also when
  // that happened while this module was still loading.
  process.on('disconnect', onSignal)
  if (process.connected === false) onSignal()

  const input = await readInput()
  if (aborted) return exitWorker(0)
  const call = createProcessIpcClient()
  const { handle, review } =
    input.kind === 'agent_turn'
      ? { handle: await openAgentTurn(input, call), review: undefined }
      : await openReview(input, call)
  if (aborted) {
    handle.dispose()
    return exitWorker(0)
  }
  session = handle.session

  const events = paceToolProgress((event) =>
    emit({
      kind: 'event',
      event:
        event.type === 'error'
          ? { ...event, error: workerFailureMessage(event.error, aborted) }
          : event,
    }),
  )
  const unsubscribe = session.subscribe((piEvent) => {
    if (
      review &&
      piEvent.type === 'tool_execution_end' &&
      piEvent.toolName === 'propose_lesson' &&
      review.recordCall(piEvent.isError)
    ) {
      void session?.abort()
    }
    for (const event of translatePiEvent(piEvent, handle.redactionSecrets)) events.send(event)
  })

  try {
    const { text, images } = promptOf(input)
    await session.prompt(text, images ? { images } : undefined)
    await session.agent.waitForIdle()
    emit(
      review
        ? { kind: 'review_result', proposals: review.result() }
        : {
            kind: 'done',
            messages: piMessagesToProviderView(
              session.agent.state.messages,
              handle.redactionSecrets,
            ),
          },
    )
  } catch (error) {
    const message = workerFailureMessage(
      error instanceof Error ? error.message : String(error),
      aborted,
    )
    if (!aborted) emit({ kind: 'event', event: { type: 'error', error: message } })
    emit({ kind: 'fatal', error: message })
    process.exitCode = 1
  } finally {
    unsubscribe()
    events.stop()
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    process.off('disconnect', onSignal)
    handle.dispose()
    try {
      process.disconnect?.()
    } catch {}
  }
  // The turn is complete: session disposed, IPC disconnected. A native store or provider socket
  // could keep this process alive for seconds afterwards, so exit as soon as stdout (including a
  // large done frame) is flushed.
  await exitWorker(Number(process.exitCode ?? 0))
}

main().catch(async (error) => {
  emit({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })
  await exitWorker(1)
})

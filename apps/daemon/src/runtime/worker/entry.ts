// The per-turn worker process. It reads one `WorkerInput` from stdin, runs one Pi session (an
// Agent turn, whatever its origin), writes NDJSON frames to stdout and reaches every daemon-owned
// tool over Node IPC (`ipc-protocol.ts`). It never opens the database.

import { randomUUID } from 'node:crypto'
import type { ChatFrame } from '@bazilion/api-types'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { resolvePaths } from '../../core/index.ts'
import { qmdBackend } from '../memory/qmd.ts'
import { paceToolProgress, piMessagesToProviderView, translatePiEvent } from '../pi/events.ts'
import { conversationHistory } from '../pi/history.ts'
import { type BazilionSessionHandle, createBazilionSession } from '../pi/session.ts'
import type { BashApprovalHost } from '../shell/approval.ts'
import { workerFailureMessage } from './cancellation.ts'
import { createProcessIpcClient, type WorkerIpcCall } from './ipc-client.ts'
import type { MediaOutput } from './ipc-protocol.ts'
import { WorkerOutput } from './output.ts'
import {
  parseWorkerInput,
  redactExactValues,
  type WorkerFrame,
  type WorkerInput,
} from './runtime.ts'

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

function ipcBashApproval(call: WorkerIpcCall, input: WorkerInput): BashApprovalHost {
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
        ...(request.tool ? { tool: request.tool } : {}),
      })
      return approval.status === 'allowed' ? 'approved' : 'denied'
    },
  }
}

/** An Agent turn's session, with an IPC proxy for each tool host the daemon serves this turn. */
async function openAgentTurn(
  input: WorkerInput,
  call: WorkerIpcCall,
): Promise<BazilionSessionHandle> {
  const served = new Set(input.hosts)
  // What a media tool saved shows in the chat at once, as a picture's does.
  const shown = (output: MediaOutput): MediaOutput => {
    for (const file of output.files) emit({ kind: 'event', event: { type: 'file', ...file } })
    return output
  }
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
      ? {
          invoke: (agentId, action, args) => call('browserInvoke', { agentId, action, args }),
          use: (browser, options) =>
            call('browserUse', {
              browser,
              ...(options?.toolCallId ? { toolCallId: options.toolCallId } : {}),
            }),
        }
      : undefined,
    mcpHost: served.has('mcpHost')
      ? {
          invoke: (serverId, toolName, args, options) =>
            call('mcpInvoke', {
              serverId,
              toolName,
              args,
              ...(options?.toolCallId ? { toolCallId: options.toolCallId } : {}),
            }),
        }
      : undefined,
    webSearchHost: served.has('webSearchHost')
      ? { search: (args) => call('webSearch', args) }
      : undefined,
    xSearchHost: served.has('xSearchHost')
      ? { search: (args) => call('xSearch', args) }
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
    readResult: served.has('resultHost')
      ? (resultId) => call('readResult', { resultId })
      : undefined,
    showResult: served.has('resultHost')
      ? async (resultId) => {
          const shown = await call('showResult', { resultId })
          emit({ kind: 'event', event: { type: 'file', ...shown } })
          return shown
        }
      : undefined,
    bashApprovalHost: served.has('bashApprovalHost') ? ipcBashApproval(call, input) : undefined,
    teamHost: served.has('teamHost')
      ? { createAgent: (args) => call('createAgent', args) }
      : undefined,
    recallHost: served.has('recallHost')
      ? {
          search: (query) => call('recallSearch', { query }),
          read: (conversationId, from, count) =>
            call('recallRead', { conversationId, from, ...(count !== undefined ? { count } : {}) }),
        }
      : undefined,
    secretHost: served.has('secretHost')
      ? {
          list: () => call('secretList', {}),
          ...(served.has('questionHost')
            ? { request: (secret, replace) => call('secretRequest', { secret, replace }) }
            : {}),
        }
      : undefined,
    ...(input.secrets ? { secrets: input.secrets } : {}),
    helperHost: served.has('helperHost')
      ? {
          start: (args) => call('helperStart', args),
          wait: (args) => call('helperWait', args),
          stop: (args) => call('helperStop', args),
        }
      : undefined,
    workspaceHost: served.has('workspaceHost')
      ? { show: (action) => call('workspaceShow', { action }) }
      : undefined,
    videoHost: served.has('videoHost')
      ? { generate: (args) => call('generateVideo', args) }
      : undefined,
    audioHost: served.has('audioHost')
      ? { generate: async (args) => shown(await call('generateAudio', args)) }
      : undefined,
    speechHost: served.has('speechHost')
      ? { speak: async (args) => shown(await call('speak', args)) }
      : undefined,
    transcriptionHost: served.has('transcriptionHost')
      ? { transcribe: (args) => call('transcribeFile', args) }
      : undefined,
    scheduleHost: served.has('scheduleHost')
      ? {
          add: (args) => call('scheduleAdd', args),
          list: () => call('scheduleList', {}),
          remove: (id) => call('scheduleRemove', { id }),
        }
      : undefined,
    jobHost: served.has('jobHost')
      ? {
          start: (args) => call('jobStart', args),
          list: () => call('jobList', {}),
          output: (args) => call('jobOutput', args),
          input: (args) => call('jobInput', args),
          stop: (args) => call('jobStop', args),
        }
      : undefined,
    contacts: input.contacts,
    withOperator: input.withOperator,
    ...(input.telegram ? { telegram: true } : {}),
    ...(input.browser ? { browser: input.browser } : {}),
    ...(input.unreadMessages ? { unreadMessages: input.unreadMessages } : {}),
  })
}

/**
 * The prompt text, without the turn's credentials and the Agent's secrets (a wake can carry a
 * job's output), and the turn's images.
 */
function promptOf(
  input: WorkerInput,
  secrets: readonly string[],
): {
  text: string
  images?: Array<{ type: 'image'; data: string; mimeType: string }>
} {
  const images = (input.images ?? []).map((image) => ({
    type: 'image' as const,
    data: image.data,
    mimeType: image.mimeType,
  }))
  return {
    text: redactExactValues(input.message, [...secrets, ...(input.apiKey ? [input.apiKey] : [])]),
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
  const handle = await openAgentTurn(input, call)
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
    for (const event of translatePiEvent(piEvent, handle.redactionSecrets)) events.send(event)
  })

  try {
    const { text, images } = promptOf(input, handle.redactionSecrets)
    await session.prompt(text, images ? { images } : undefined)
    await session.agent.waitForIdle()
    emit(finishedFrame(session, handle.redactionSecrets))
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

/**
 * The end of a turn: the whole conversation as people read it (a compaction during the turn
 * leaves its earlier messages there, with a mark), and how full the window now is.
 */
function finishedFrame(session: AgentSession, secrets: readonly string[]): ChatFrame {
  const { messages, compactions } = conversationHistory(session.sessionManager.getBranch())
  const usage = session.getContextUsage()
  return {
    kind: 'done',
    messages: piMessagesToProviderView(messages, secrets),
    compactions,
    context: {
      tokens: usage?.tokens ?? null,
      window: usage && usage.contextWindow > 0 ? usage.contextWindow : null,
    },
  }
}

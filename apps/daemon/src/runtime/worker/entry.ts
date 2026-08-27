// One-shot worker entry. Configured operator HTTP retains its legacy runtime;
// protected normal turns and restricted reviews use closed typed inputs.

import { randomUUID } from 'node:crypto'
import type { ChatFrame } from '@bazilion/api-types'
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { resolvePaths } from '../../core/index.ts'
import { qmdBackend } from '../memory/qmd.ts'
import { piMessagesToProviderView, translatePiEvent } from '../pi/events.ts'
import {
  type BazilionSessionHandle,
  createBazilionSession,
  createProtectedBazilionSession,
  createRestrictedReviewSession,
} from '../pi/session.ts'
import type { BashApprovalHost as ShellBashApprovalHost } from '../shell/approval.ts'
import { createIpcApiKeyRefresher } from './api-key-refresh.ts'
import { createIpcClient, type WorkerIpcCall } from './ipc-client.ts'
import type {
  BashApprovalResult,
  BrowserHost,
  McpHost,
  MessagingHost,
  UserMdGetResult,
  UserMdHost,
  UserMdWriteResult,
} from './ipc-protocol.ts'
import {
  parseWorkerInput,
  protectedRuntimeSecrets,
  redactJsonValue,
  validateMinimalWorkerProcessEnv,
  type WorkerInput,
} from './runtime.ts'

interface ReviewWorkerProposal {
  scope: 'private' | 'shared'
  text: string
  evidenceEntryIds: Array<{ sessionId: string; entryOrdinal: number }>
}

type WorkerFrame = ChatFrame | { kind: 'review_result'; proposals: ReviewWorkerProposal[] }

const activeAccessTokens: string[] = []

function emit(frame: WorkerFrame): void {
  process.stdout.write(`${JSON.stringify(redactJsonValue(frame, activeAccessTokens))}\n`)
}

async function readInput(): Promise<WorkerInput> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) throw new Error('worker: empty stdin input')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('worker: stdin is not valid JSON')
  }
  return parseWorkerInput(parsed)
}

function createWorkerIpcCall(): WorkerIpcCall {
  return createIpcClient({
    send: process.send
      ? (ipcMessage, done) => {
          process.send?.(ipcMessage, undefined, undefined, done)
        }
      : undefined,
    onMessage: (listener) => process.on('message', listener),
    onDisconnect: (listener) => process.on('disconnect', listener),
  })
}

function createTrackedIpcApiKeyRefresher(
  call: WorkerIpcCall,
  context: { providerName: string; agentId: string; turnId: string },
): (providerName: string) => Promise<string> {
  const refresh = createIpcApiKeyRefresher(call, context)
  return async (providerName) => {
    const token = await refresh(providerName)
    if (token && !activeAccessTokens.includes(token)) activeAccessTokens.push(token)
    return token
  }
}

function createIpcMessagingHost(call: WorkerIpcCall): MessagingHost {
  return {
    agentExists: (agentId) => call<boolean>('agentExists', { agentId }),
    sendMessage: (input) => call<{ messageId: string }>('sendMessage', input),
    listInbox: (agentId, opts) => call('listInbox', { agentId, unreadOnly: opts.unreadOnly }),
    markRead: async (messageId) => {
      await call<null>('markRead', { messageId })
    },
    findReplies: (agentId, replyTo) => call('findReplies', { agentId, replyTo }),
    approvalStatus: (agentId, approvalId) => call('approvalStatus', { agentId, approvalId }),
  }
}

function createIpcUserMdHost(call: WorkerIpcCall): UserMdHost {
  return {
    get: (teamId) => call<UserMdGetResult>('userMdGet', { teamId }),
    write: (teamId, content, ifMatch) =>
      call<UserMdWriteResult>('userMdWrite', { teamId, content, ifMatch }),
  }
}

function createIpcBrowserHost(call: WorkerIpcCall): BrowserHost {
  return {
    invoke: (agentId, action, args) => call('browserInvoke', { agentId, action, args }),
  }
}

function createIpcMcpHost(call: WorkerIpcCall): McpHost {
  return {
    invoke: (serverId, toolName, args) => call('mcpInvoke', { serverId, toolName, args }),
  }
}

function createIpcBashApprovalHost(
  call: WorkerIpcCall,
  input: {
    agentId: string
    teamId: string
    turnId: string
    mode: 'interactive' | 'auto_deny'
  },
): ShellBashApprovalHost {
  return {
    async requestApproval(request) {
      const result = await call<BashApprovalResult>('bashApproval', {
        id: randomUUID(),
        turnId: input.turnId,
        toolCallId: request.toolCallId,
        agentId: input.agentId,
        teamId: input.teamId,
        command: request.command,
        risks: [...request.risks],
        mode: input.mode,
      })
      return result.decision === 'allow' ? 'approved' : 'denied'
    },
  }
}

interface ReviewState {
  proposals: ReviewWorkerProposal[]
  submitted(): boolean
  validationFailures(): number
  recordValidationFailure(): void
  tools: ToolDefinition[]
}

function createReviewState(
  evidenceItems: Array<{ sessionId: string; entryOrdinal: number }>,
): ReviewState {
  const proposals: ReviewWorkerProposal[] = []
  let proposalBatchSubmitted = false
  let reviewValidationFailures = 0
  const allowedEvidence = new Set(
    evidenceItems.map((item) => `${item.sessionId}:${item.entryOrdinal}`),
  )
  const tools: ToolDefinition[] = [
    {
      name: 'propose_lesson',
      label: 'propose_lesson',
      description:
        'Submit zero to five evidence-backed lesson proposals in one final batch. This is the only available action.',
      parameters: Type.Object({
        proposals: Type.Array(
          Type.Object({
            scope: Type.Union([Type.Literal('private'), Type.Literal('shared')]),
            text: Type.String({ minLength: 1, maxLength: 500 }),
            evidenceEntryIds: Type.Array(
              Type.Object({ sessionId: Type.String(), entryOrdinal: Type.Integer({ minimum: 0 }) }),
              { minItems: 1 },
            ),
          }),
          { maxItems: 5 },
        ),
      }),
      async execute(_toolCallId, params) {
        if (proposalBatchSubmitted) throw new Error('propose_lesson may be called only once')
        const input = params as { proposals: ReviewWorkerProposal[] }
        const validated: ReviewWorkerProposal[] = []
        for (const candidate of input.proposals) {
          const text = candidate.text.trim()
          if (!text || text.length > 500) throw new Error('proposal text must be 1-500 characters')
          for (const evidence of candidate.evidenceEntryIds) {
            if (!allowedEvidence.has(`${evidence.sessionId}:${evidence.entryOrdinal}`)) {
              throw new Error('proposal cites evidence outside the supplied digest')
            }
          }
          validated.push({ ...candidate, text })
        }
        proposalBatchSubmitted = true
        proposals.push(...validated)
        return {
          content: [{ type: 'text', text: `accepted ${proposals.length} proposals` }],
          details: {},
          terminate: true,
        }
      },
    },
  ]
  return {
    proposals,
    submitted: () => proposalBatchSubmitted,
    validationFailures: () => reviewValidationFailures,
    recordValidationFailure: () => {
      reviewValidationFailures += 1
    },
    tools,
  }
}

async function createSessionForInput(
  input: WorkerInput,
  ipcCall: WorkerIpcCall,
): Promise<{ handle: BazilionSessionHandle; reviewState?: ReviewState }> {
  if (input.kind === 'configured_operator_http') {
    const paths = resolvePaths()
    const memory = qmdBackend(`${input.agent.team.path}/memory`)
    await memory.init()
    const messagingHost = createIpcMessagingHost(ipcCall)
    const userMdHost = createIpcUserMdHost(ipcCall)
    const browserHost = input.browserEnabled ? createIpcBrowserHost(ipcCall) : undefined
    const mcpHost = input.mcpTools?.length ? createIpcMcpHost(ipcCall) : undefined
    const bashApprovalHost = createIpcBashApprovalHost(ipcCall, {
      agentId: input.agent.agent.id,
      teamId: input.agent.team.id,
      turnId: input.turnId,
      mode: input.bashApprovalMode,
    })
    const refreshApiKey = input.apiKeyRefreshEnabled
      ? createTrackedIpcApiKeyRefresher(ipcCall, {
          providerName: input.agent.model.split(':', 1)[0] ?? '',
          agentId: input.agent.agent.id,
          turnId: input.turnId,
        })
      : undefined
    const handle = await createBazilionSession({
      agent: input.agent,
      paths,
      env: process.env,
      memory,
      enabledProviders: new Set(input.enabledProviders),
      messagingHost,
      userMdHost,
      apiKey: input.apiKey,
      refreshApiKey,
      browserHost,
      mcpHost,
      mcpTools: input.mcpTools,
      bashApprovalHost,
      fileSink: (file) => emit({ kind: 'event', event: { type: 'file', ...file } }),
    })
    return { handle }
  }

  const refreshApiKey = createTrackedIpcApiKeyRefresher(ipcCall, {
    providerName: input.runtime.providerName,
    agentId: input.kind === 'protected' ? input.agent.agent.id : input.agentId,
    turnId: input.turnId,
  })
  if (input.kind === 'restricted_review') {
    const reviewState = createReviewState(input.review.evidence)
    const handle = await createRestrictedReviewSession({
      runtime: input.runtime,
      scratch: input.scratch,
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      tools: reviewState.tools,
      refreshApiKey,
    })
    return { handle, reviewState }
  }

  const memory = qmdBackend(input.paths.memoryDir)
  await memory.init()
  const messagingHost = createIpcMessagingHost(ipcCall)
  const userMdHost = createIpcUserMdHost(ipcCall)
  const bashApprovalHost = createIpcBashApprovalHost(ipcCall, {
    agentId: input.agent.agent.id,
    teamId: input.agent.team.id,
    turnId: input.turnId,
    mode: 'auto_deny',
  })
  const handle = await createProtectedBazilionSession({
    agent: input.agent,
    runtime: input.runtime,
    paths: input.paths,
    scratch: input.scratch,
    docker: input.docker,
    memory,
    messagingHost,
    userMdHost,
    bashApprovalHost,
    refreshApiKey,
    fileSink: (file) => emit({ kind: 'event', event: { type: 'file', ...file } }),
  })
  return { handle }
}

async function main(): Promise<void> {
  let aborted = false
  let session: AgentSession | null = null
  const onSignal = (): void => {
    aborted = true
    if (session) void session.abort()
    else {
      try {
        emit({ kind: 'event', event: { type: 'error', error: 'cancelled' } })
      } catch {}
      process.exit(0)
    }
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  const input = await readInput()
  if (input.kind !== 'configured_operator_http') {
    validateMinimalWorkerProcessEnv(process.env, input.scratch)
  }
  const initialAccessTokens =
    input.kind === 'configured_operator_http'
      ? input.apiKey
        ? [input.apiKey]
        : []
      : protectedRuntimeSecrets(input.runtime)
  activeAccessTokens.push(...initialAccessTokens.filter(Boolean))
  const ipcCall = createWorkerIpcCall()
  const { handle, reviewState } = await createSessionForInput(input, ipcCall)
  session = handle.session

  const unsubscribe = session.subscribe((piEvent) => {
    if (
      reviewState &&
      piEvent.type === 'tool_execution_end' &&
      piEvent.toolName === 'propose_lesson' &&
      piEvent.isError
    ) {
      reviewState.recordValidationFailure()
      if (reviewState.validationFailures() >= 2) void session?.abort()
    }
    for (const event of translatePiEvent(piEvent)) emit({ kind: 'event', event })
  })

  try {
    const promptMessage = redactJsonValue(input.message, activeAccessTokens)
    const sanitizedImages =
      input.kind === 'restricted_review'
        ? []
        : redactJsonValue(input.images ?? [], activeAccessTokens)
    const promptImages =
      input.kind === 'restricted_review'
        ? []
        : sanitizedImages.map((image) => ({
            type: 'image' as const,
            data: image.data,
            mimeType: image.mimeType,
          }))
    await session.prompt(
      promptMessage,
      promptImages.length > 0 ? { images: promptImages } : undefined,
    )
    await session.agent.waitForIdle()

    if (reviewState) {
      if (reviewState.validationFailures() >= 2) {
        throw new Error('review output remained invalid after one schema-repair attempt')
      }
      if (!reviewState.submitted()) throw new Error('review output did not submit a proposal batch')
      emit({ kind: 'review_result', proposals: reviewState.proposals })
    } else {
      emit({ kind: 'done', messages: piMessagesToProviderView(session.agent.state.messages) })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!aborted) emit({ kind: 'event', event: { type: 'error', error: message } })
    emit({ kind: 'fatal', error: message })
    process.exitCode = 1
  } finally {
    unsubscribe()
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    handle.dispose()
    try {
      process.disconnect?.()
    } catch {}
  }
}

main().catch((error) => {
  try {
    emit({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })
  } catch {}
  process.exit(1)
})

const REVIEW_SYSTEM_PROMPT = `You are a restricted learning reviewer. Analyze only the supplied
transcript digest and approved-lesson index. You cannot act on the world. Call propose_lesson once
with zero to five proposals, then stop.

If propose_lesson rejects malformed output, correct the schema exactly once. If that repair is also
rejected, stop; the review will fail.

Classify before proposing:
1. Stable human preference or biography belongs to USER.md: do not propose it.
2. Agent-specific verified behavior or strategy is private.
3. Reusable verified Team project knowledge, decisions, or procedures are shared.
4. Everything else produces no proposal.

Zero proposals is a successful result. Never save transient or environment-dependent failures,
unresolved attempts, guesses, contradicted claims, one-off narratives, status updates, secrets,
credentials, sensitive personal data, raw logs, copied text, or duplicates. Each proposal must cite
at least one supplied evidence entry and one observation may appear in only one proposal.`

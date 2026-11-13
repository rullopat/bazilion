// One Agent's chat: the persisted history, the streaming turn, follow-ups, shell approvals and
// slash commands. The pane remounts per Agent, so the Agent never changes under this hook.

import type {
  Attachment,
  ChatCompactResponse,
  ChatContextResponse,
  ChatFrame,
  CommandApproval,
  CommandApprovalDecisionResponse,
  ListCommandApprovalsResponse,
  ProviderMessage,
  SessionHeadResponse,
  SessionMessagesResponse,
  UserQueueListResponse,
} from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, apiFetch, errorMessage } from '../../lib/api'
import {
  applyEvent,
  cancelPendingApprovals,
  interactiveChatRequest,
  isImageMime,
  projectMessages,
  type RenderEntry,
  readFrames,
  shellApprovalsUrl,
  upsertCommandApprovalEntry,
} from './entries'
import {
  formatCompaction,
  formatContext,
  parseKeepTail,
  parseSlashCommand,
  SLASH_HELP,
} from './slash-commands'

const SESSION_POLL_MS = 10_000
const QUEUE_POLL_MS = 5_000
const EMPTY_HEAD: SessionHeadResponse = { file: null, size: 0, conversationId: null }

export interface Draft {
  text: string
  attachments: Attachment[]
}

/** Slash-command output, shown after the entry that was last when it was produced. */
export interface SystemNote {
  id: number
  content: string
  afterIndex: number
}

function openFollowUps(queue: UserQueueListResponse | null): number {
  return (
    queue?.items.filter((item) => item.status === 'pending' || item.status === 'running').length ??
    0
  )
}

export function useChatSession({
  agentId,
  initialMessages,
  initialSessionHead,
  onOpenLibrary,
}: {
  agentId: string
  initialMessages: ProviderMessage[]
  /** The SSR head of the conversation file; the stale poll compares against it. */
  initialSessionHead?: SessionHeadResponse
  onOpenLibrary: () => void
}) {
  const base = `/api/agents/${encodeURIComponent(agentId)}`
  const [messages, setMessages] = useState(initialMessages)
  const [live, setLive] = useState<RenderEntry[]>([])
  const [notes, setNotes] = useState<SystemNote[]>([])
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  // A turn this tab is not streaming but still holds a pending shell approval.
  const [recoveredTurn, setRecoveredTurn] = useState(false)
  const [editing, setEditing] = useState(false)
  const [stale, setStale] = useState(false)
  const [historyUnavailable, setHistoryUnavailable] = useState(
    initialSessionHead?.unavailable ?? false,
  )
  const [queue, setQueue] = useState<UserQueueListResponse | null>(null)
  const [questionsKey, setQuestionsKey] = useState(0)
  const [approvalBusy, setApprovalBusy] = useState<Record<string, boolean>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})

  const abortRef = useRef<AbortController | null>(null)
  const approvalTurnRef = useRef(false)
  const knownHeadRef = useRef(initialSessionHead ?? EMPTY_HEAD)
  const queueRef = useRef<UserQueueListResponse | null>(null)
  const noteIdRef = useRef(0)
  const entryCountRef = useRef(0)
  const streamingRef = useRef(false)
  streamingRef.current = streaming

  const turnBusy = streaming || recoveredTurn
  // A turn from elsewhere (a follow-up, Telegram, a schedule) can be stopped from here too.
  const agentBusy = turnBusy || Boolean(queue?.turnActive)
  const queueWorking =
    queue?.turnActive ||
    queue?.items.some(
      (item) => item.status === 'running' || (item.status === 'pending' && !queue.paused),
    )

  function pushNote(content: string) {
    const note = { id: noteIdRef.current++, content, afterIndex: entryCountRef.current }
    setNotes((current) => [...current, note])
  }

  async function refreshHistory() {
    if (streamingRef.current) return
    try {
      const body = await api<SessionMessagesResponse>(`${base}/sessions/messages`)
      setHistoryUnavailable(body.head.unavailable ?? false)
      setMessages(body.messages)
      setLive([])
      setEditing(false)
      knownHeadRef.current = body.head
      setStale(false)
    } catch {
      pushNote('Conversation history is unavailable. Your draft is preserved.')
    }
  }

  async function refreshKnownHead() {
    try {
      const head = await api<SessionHeadResponse>(`${base}/sessions/head`)
      const prior = knownHeadRef.current.conversationId
      if (prior && prior !== head.conversationId) {
        setStale(true)
        return
      }
      setHistoryUnavailable(head.unavailable ?? false)
      knownHeadRef.current = head
    } catch {
      // The next poll tries again.
    }
  }

  async function refreshQueue() {
    try {
      const next = await api<UserQueueListResponse>(`${base}/queue`)
      // A follow-up finished: its reply is in the history now.
      if (openFollowUps(next) < openFollowUps(queueRef.current) && !streamingRef.current) {
        void refreshHistory()
      }
      queueRef.current = next
      setQueue(next)
    } catch {
      // The next refresh tries again.
    }
  }

  // Abort the chat request when the pane goes away (another Agent, another page).
  useEffect(() => () => abortRef.current?.abort(), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once; refreshQueue reads refs.
  useEffect(() => {
    void refreshQueue()
  }, [])

  // The daemon has no push channel for follow-ups or turns from elsewhere: poll while one runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshQueue reads refs.
  useEffect(() => {
    if (!queueWorking) return
    const timer = setInterval(() => {
      if (!document.hidden) void refreshQueue()
    }, QUEUE_POLL_MS)
    return () => clearInterval(timer)
  }, [queueWorking])

  // Activity from another source (Telegram, a schedule, another tab) shows a reload banner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshQueue reads refs.
  useEffect(() => {
    if (!initialSessionHead || stale) return
    const timer = setInterval(async () => {
      if (document.hidden || streamingRef.current) return
      try {
        const head = await api<SessionHeadResponse>(`${base}/sessions/head`)
        const known = knownHeadRef.current
        if (
          Boolean(head.unavailable) !== Boolean(known.unavailable) ||
          head.file !== known.file ||
          head.size !== known.size
        ) {
          setStale(true)
          // Another source may be running a turn; the queue reports it, so Stop can show.
          void refreshQueue()
        }
      } catch {
        // Transient: the next tick tries again.
      }
    }, SESSION_POLL_MS)
    return () => clearInterval(timer)
  }, [base, initialSessionHead, stale])

  // A navigation cannot reopen the stream, but the daemon keeps the turn and its pending shell
  // approvals alive: show them again.
  useEffect(() => {
    const controller = new AbortController()
    api<ListCommandApprovalsResponse>(shellApprovalsUrl(agentId), { signal: controller.signal })
      .then(({ approvals }) => {
        const pending = approvals.filter(
          (approval) => approval.agentId === agentId && approval.status === 'pending',
        )
        if (pending.length === 0) return
        approvalTurnRef.current = true
        setLive((entries) => pending.reduce(upsertCommandApprovalEntry, entries))
        setRecoveredTurn(true)
      })
      .catch(() => {
        // Best effort: a live stream delivers the same approvals.
      })
    return () => controller.abort()
  }, [agentId])

  async function enqueue(draft: Draft): Promise<Draft | null> {
    try {
      await api(`${base}/queue`, {
        body: { message: draft.text, attachments: draft.attachments },
      })
      void refreshQueue()
      return null
    } catch (error) {
      pushNote(`The follow-up was not queued: ${errorMessage(error)}. Your draft is kept.`)
      return draft
    }
  }

  async function compact(rest: string) {
    if (messages.length < 2) {
      pushNote('/compact: need ≥2 messages to compact')
      return
    }
    setEditing(false)
    setStreaming(true)
    setThinking(true)
    try {
      const result = await api<ChatCompactResponse>(`${base}/chat/compact`, {
        body: { keepTail: parseKeepTail(rest) },
      })
      pushNote(formatCompaction(result))
      setTimeout(() => window.location.reload(), 400)
    } catch (error) {
      pushNote(`/compact failed: ${errorMessage(error)}`)
    } finally {
      setThinking(false)
      setStreaming(false)
    }
  }

  /** True when `command` is a slash command, which then ran. */
  async function runSlashCommand(command: string, rest: string): Promise<boolean> {
    switch (command) {
      case '/help':
        pushNote(SLASH_HELP)
        return true
      case '/context':
        try {
          pushNote(formatContext(await api<ChatContextResponse>(`${base}/chat/context`)))
        } catch (error) {
          pushNote(`/context failed: ${errorMessage(error)}`)
        }
        return true
      case '/new':
        onOpenLibrary()
        return true
      case '/compact':
        await compact(rest)
        return true
      default:
        return false
    }
  }

  function lastUserMessage(): number {
    return messages.findLastIndex((message) => message.role === 'user')
  }

  function handleFrame(frame: ChatFrame) {
    if (frame.kind === 'fatal') {
      approvalTurnRef.current = false
      setLive((entries) => [
        ...cancelPendingApprovals(entries),
        { type: 'error', content: `[fatal] ${frame.error}` },
      ])
      setRecoveredTurn(false)
      return
    }
    if (frame.kind === 'done') {
      approvalTurnRef.current = false
      setMessages(frame.messages)
      setLive([])
      setRecoveredTurn(false)
      setApprovalBusy({})
      setApprovalErrors({})
      return
    }
    const event = frame.event
    if (event.type === 'command_approval') {
      // Never offer controls for another Agent's command.
      if (event.approval.agentId !== agentId) return
      approvalTurnRef.current = true
      setThinking(event.approval.status !== 'pending' && event.approval.status !== 'cancelled')
    } else if (event.type === 'agent_question') {
      setQuestionsKey((key) => key + 1)
    } else if (
      event.type === 'assistant_delta' ||
      event.type === 'assistant_message' ||
      event.type === 'tool_call'
    ) {
      setThinking(false)
    } else if (event.type === 'tool_result' || event.type === 'tool_error') {
      setThinking(true)
    }
    setLive((entries) => applyEvent(entries, event))
  }

  /**
   * Send a message (a slash command, a follow-up while the Agent is busy, or a new turn). Returns
   * the draft to give back to the composer when it was not accepted.
   */
  async function send(draft: Draft): Promise<Draft | null> {
    const slash = parseSlashCommand(draft.text)
    if (slash && (await runSlashCommand(slash.command, slash.rest))) {
      // Commands are text-only: attachments stay in the composer.
      return draft.attachments.length > 0 ? { text: '', attachments: draft.attachments } : null
    }
    if (turnBusy) {
      if (!editing) return enqueue(draft)
      pushNote('Wait for the current turn to finish before replacing the last message.')
      return draft
    }
    if (editing) {
      const keepCount = lastUserMessage()
      try {
        await api(`${base}/chat/truncate`, {
          body: { keepCount, conversationId: knownHeadRef.current.conversationId ?? undefined },
        })
      } catch (error) {
        pushNote(`Could not replace the last turn: ${errorMessage(error)}`)
        return draft
      }
      setMessages((current) => current.slice(0, keepCount))
      setEditing(false)
    }

    // The message shows at once; the `done` frame replaces it with the saved history.
    const images = draft.attachments.filter((file) => isImageMime(file.mimeType))
    const files = draft.attachments
      .filter((file) => !isImageMime(file.mimeType))
      .map((file) => ({ name: file.name ?? 'file' }))
    setLive([
      {
        type: 'user',
        content: draft.text,
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { files } : {}),
      },
    ])
    setRecoveredTurn(false)
    setApprovalBusy({})
    setApprovalErrors({})
    approvalTurnRef.current = false
    const abort = new AbortController()
    abortRef.current = abort
    setStreaming(true)
    setThinking(true)

    let finished = false
    let restore: Draft | null = null
    try {
      const response = await apiFetch(`${base}/chat`, {
        body: interactiveChatRequest(draft.text, draft.attachments),
        signal: abort.signal,
      })
      if (!response.body) throw new Error('the chat response has no body')
      for await (const frame of readFrames(response.body)) {
        if (frame.kind !== 'event') finished = true
        handleFrame(frame)
      }
      await refreshKnownHead()
    } catch (error) {
      if (error instanceof ApiError) {
        // Refused before the turn started: nothing was sent.
        if (error.code === 'agent_turn_active') {
          // A turn from elsewhere is running: this message waits as a follow-up.
          setLive([])
          restore = await enqueue(draft)
        } else {
          setLive([{ type: 'error', content: `[error] ${error.message}` }])
          restore = draft
        }
      } else if ((error as Error).name !== 'AbortError') {
        setLive((entries) => [
          ...entries,
          { type: 'error', content: `[network error] ${errorMessage(error)}` },
        ])
      }
    } finally {
      if (abortRef.current === abort) {
        // The stream ended early (a navigation, a dropped connection) while a shell approval was
        // open: the daemon still runs that turn.
        if (!finished && approvalTurnRef.current) setRecoveredTurn(true)
        setThinking(false)
        setStreaming(false)
        abortRef.current = null
        void refreshQueue()
        setQuestionsKey((key) => key + 1)
      }
    }
    return restore
  }

  /** Stop the running turn, wherever it came from. */
  async function stop() {
    try {
      await api(`${base}/cancel`, { method: 'POST' })
    } catch (error) {
      // 409: nothing was running any more.
      if (!(error instanceof ApiError && error.status === 409)) {
        pushNote('Stop was not confirmed; the response may still be running.')
      }
    }
    void refreshQueue()
  }

  async function reconcileApproval(id: string): Promise<CommandApproval | null> {
    try {
      const { approvals } = await api<ListCommandApprovalsResponse>(shellApprovalsUrl(agentId))
      const approval = approvals.find((item) => item.id === id && item.agentId === agentId)
      if (approval) setLive((entries) => upsertCommandApprovalEntry(entries, approval))
      return approval ?? null
    } catch {
      return null
    }
  }

  async function decide(approval: CommandApproval, decision: 'allow' | 'deny') {
    if (approval.agentId !== agentId || approval.status !== 'pending') return
    setApprovalBusy((current) => ({ ...current, [approval.id]: true }))
    setApprovalErrors(({ [approval.id]: _cleared, ...rest }) => rest)
    try {
      const body = await api<CommandApprovalDecisionResponse>(
        `/api/shell-approvals/${encodeURIComponent(approval.id)}`,
        { body: { decision } },
      )
      if (body.approval.agentId === agentId) {
        setLive((entries) => upsertCommandApprovalEntry(entries, body.approval))
      }
    } catch (error) {
      // The one-shot decision may have been applied before the response was lost: look before
      // offering it again, so Allow never looks pending after the command started.
      const current = await reconcileApproval(approval.id)
      if (!current || current.status === 'pending') {
        setApprovalErrors((errors) => ({ ...errors, [approval.id]: errorMessage(error) }))
      }
    } finally {
      setApprovalBusy((current) => ({ ...current, [approval.id]: false }))
    }
  }

  /** Put the last user message back in the composer; sending it replaces the last turn. */
  function startEdit(): string | null {
    if (live.length > 0 || turnBusy) return null
    const index = lastUserMessage()
    if (index < 0) return null
    setEditing(true)
    return messages[index]?.content ?? null
  }

  const history = projectMessages(messages)
  const entries = [...history, ...live]
  entryCountRef.current = entries.length
  const lastUserEntry = history.findLastIndex((entry) => entry.type === 'user')

  return {
    entries,
    notes,
    /** While editing, history from this entry on is about to be replaced (-1 otherwise). */
    replacedFrom: editing ? lastUserEntry : -1,
    /** The entry that offers "edit" (-1 when editing is not possible now). */
    editableEntry: !editing && live.length === 0 && !turnBusy ? lastUserEntry : -1,
    thinking,
    turnBusy,
    agentBusy,
    editing,
    stale,
    recoveredTurn,
    historyUnavailable,
    queue,
    questionsKey,
    approvals: { busy: approvalBusy, errors: approvalErrors, decide },
    send,
    stop,
    startEdit,
    cancelEdit: () => setEditing(false),
    refreshHistory,
    refreshQueue,
    dismissStale: () => setStale(false),
  }
}

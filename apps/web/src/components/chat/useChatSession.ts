// One Agent's chat: the persisted history, the streaming turn, follow-ups, shell approvals and
// slash commands. The pane remounts per Agent, so the Agent never changes under this hook.
// Keeping level with the daemon is useSessionSync's; shell approvals are useCommandApprovals'.

import type {
  Attachment,
  ChatFrame,
  CompactionMark,
  ContextUse,
  ProviderMessage,
  SessionHeadResponse,
} from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, apiFetch, errorMessage } from '../../lib/api'
import {
  applyEvent,
  cancelPendingApprovals,
  draftEntry,
  interactiveChatRequest,
  projectMessages,
  type RenderEntry,
  readFrames,
} from './entries'
import { parseSlashCommand, runSlashCommand } from './slash-commands'
import type { TranscriptNote } from './Transcript'
import { useCommandApprovals } from './useCommandApprovals'
import { useSessionSync } from './useSessionSync'

export interface Draft {
  text: string
  attachments: Attachment[]
}

/** Slash-command output, shown after the entry that was last when it was produced. */
export type SystemNote = TranscriptNote

export function useChatSession({
  agentId,
  initialMessages,
  initialCompactions = [],
  initialContext = null,
  initialSessionHead,
  onOpenLibrary,
  onConversation,
}: {
  agentId: string
  initialMessages: ProviderMessage[]
  /** Where compactions summarized the conversation; dividers in the transcript. */
  initialCompactions?: CompactionMark[]
  initialContext?: ContextUse | null
  /** The SSR head of the conversation file; the stale poll compares against it. */
  initialSessionHead?: SessionHeadResponse
  onOpenLibrary: () => void
  /** The conversation on screen changed: the first turn made one, or another was loaded. */
  onConversation?: (conversationId: string | null) => void
}) {
  const base = `/api/agents/${encodeURIComponent(agentId)}`
  const [messages, setMessages] = useState(initialMessages)
  const [compactions, setCompactions] = useState(initialCompactions)
  const [context, setContext] = useState(initialContext)
  const [live, setLive] = useState<RenderEntry[]>([])
  const [notes, setNotes] = useState<SystemNote[]>([])
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [questionsKey, setQuestionsKey] = useState(0)
  // Counts the loads that brought what another source added, so the pane can mark it.
  const [arrival, setArrival] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const noteIdRef = useRef(0)
  const entryCountRef = useRef(0)
  const streamingRef = useRef(false)
  streamingRef.current = streaming

  function pushNote(content: string) {
    const note = { id: noteIdRef.current++, content, afterIndex: entryCountRef.current }
    setNotes((current) => [...current, note])
  }

  // Abort the chat request when the pane goes away (another Agent, another page).
  useEffect(() => () => abortRef.current?.abort(), [])

  const sync = useSessionSync({
    agentId,
    base,
    initialSessionHead,
    onConversation,
    streamingRef,
    hold: editing,
    pushNote,
    onHistory: (saved, arrived) => {
      setMessages(saved.messages)
      setCompactions(saved.compactions ?? [])
      setContext(saved.context ?? null)
      // A turn from elsewhere still waiting on a command keeps its card.
      setLive((entries) =>
        entries.filter(
          (entry) => entry.type === 'command_approval' && entry.approval.status === 'pending',
        ),
      )
      setEditing(false)
      if (arrived) setArrival((count) => count + 1)
    },
  })
  const {
    recoveredTurn,
    setRecoveredTurn,
    approvalTurnRef,
    approvalBusy,
    approvalErrors,
    decide,
    resetApprovals,
  } = useCommandApprovals({ agentId, setLive })

  const turnBusy = streaming || recoveredTurn
  // A turn from elsewhere (a follow-up, Telegram, a schedule) can be stopped from here too.
  const agentBusy = turnBusy || Boolean(sync.queue?.turnActive)

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
      if (frame.compactions) setCompactions(frame.compactions)
      if (frame.context) setContext(frame.context)
      setLive([])
      setRecoveredTurn(false)
      resetApprovals()
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
    if (
      slash &&
      (await runSlashCommand(slash.command, slash.rest, {
        base,
        messageCount: messages.length,
        pushNote,
        onOpenLibrary,
        setCompacting: (compacting) => {
          if (compacting) setEditing(false)
          setStreaming(compacting)
          setThinking(compacting)
        },
      }))
    ) {
      // Commands are text-only: attachments stay in the composer.
      return draft.attachments.length > 0 ? { text: '', attachments: draft.attachments } : null
    }
    if (turnBusy) {
      if (!editing) return sync.enqueue(draft)
      pushNote('Wait for the current turn to finish before replacing the last message.')
      return draft
    }
    if (editing) {
      const keepCount = lastUserMessage()
      try {
        await api(`${base}/chat/truncate`, {
          body: { keepCount, conversationId: sync.knownConversationId() ?? undefined },
        })
      } catch (error) {
        pushNote(`Could not replace the last turn: ${errorMessage(error)}`)
        return draft
      }
      setMessages((current) => current.slice(0, keepCount))
      setCompactions((current) => current.filter((mark) => mark.index < keepCount))
      setEditing(false)
    }

    setLive([draftEntry(draft.text, draft.attachments)])
    setRecoveredTurn(false)
    resetApprovals()
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
      await sync.refreshKnownHead()
    } catch (error) {
      if (error instanceof ApiError) {
        // Refused before the turn started: nothing was sent.
        if (error.code === 'agent_turn_active') {
          // A turn from elsewhere is running: this message waits as a follow-up.
          setLive([])
          restore = await sync.enqueue(draft)
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
        void sync.refreshQueue()
        setQuestionsKey((key) => key + 1)
      }
    }
    return restore
  }

  /** Stop the running turn, wherever it came from. */
  async function stop() {
    try {
      const stopped = await api<{ cancelled: boolean; queuePaused: boolean }>(`${base}/cancel`, {
        method: 'POST',
      })
      // Stop also holds the follow-ups waiting behind the turn: say so, and where to resume.
      if (stopped.queuePaused) {
        pushNote(
          'The follow-ups waiting behind this turn are paused too. Resume them under Follow-ups when you are ready.',
        )
      }
    } catch (error) {
      // 409: nothing was running any more.
      if (!(error instanceof ApiError && error.status === 409)) {
        pushNote('Stop was not confirmed; the response may still be running.')
      }
    }
    void sync.refreshQueue()
  }

  /** Put the last user message back in the composer; sending it replaces the last turn. */
  function startEdit(): string | null {
    if (live.length > 0 || turnBusy) return null
    const index = lastUserMessage()
    if (index < 0) return null
    setEditing(true)
    return messages[index]?.content ?? null
  }

  const history = projectMessages(messages, compactions)
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
    /** How full the model's window is; null before the daemon has said. */
    context,
    editing,
    /** Changes each time what another source added is loaded. */
    arrival,
    recoveredTurn,
    historyUnavailable: sync.historyUnavailable,
    queue: sync.queue,
    questionsKey,
    approvals: { busy: approvalBusy, errors: approvalErrors, decide },
    send,
    stop,
    startEdit,
    cancelEdit: () => setEditing(false),
    refreshHistory: sync.refreshHistory,
    refreshQueue: sync.refreshQueue,
    /** The conversation on screen; null before the Agent's first turn. */
    conversationId: sync.knownConversationId,
  }
}

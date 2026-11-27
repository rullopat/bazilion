// The conversation with one Agent: the transcript, what waits for an answer, and the composer.
// The state lives in useChatSession; this file lays it out. The bar above it comes from the
// workspace, which knows about Teams, panels and other conversations.

import type {
  Attachment,
  CompactionMark,
  ContextUse,
  ProviderMessage,
  SessionHeadResponse,
} from '@bazilion/api-types'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useActivityOptional } from '../../lib/activity'
import { useFindInTranscript } from '../../lib/find-in-transcript'
import { isAtEnd, markArrived, placeKey, useTranscriptPlace } from '../../lib/transcript-scroll'
import { Button } from '../Button'
import { useWorkspaceOptional } from '../workspace/context'
import { AgentQuestions } from './AgentQuestions'
import { Composer, encodeFiles, MAX_ATTACHMENTS } from './Composer'
import { FollowUps } from './FollowUps'
import { TranscriptBlocks, useMarkdownReady } from './Transcript'
import { type Draft, useChatSession } from './useChatSession'

/** What the bar above the conversation can do to it. */
export interface ChatControls {
  /** A turn runs, started here or elsewhere. */
  agentBusy: boolean
  /** Load the selected conversation again, e.g. after switching to another one. */
  reload: () => Promise<void>
  /** How full the model's window is; null before the daemon has said. */
  context: ContextUse | null
  /** `/new` asks for the list of conversations. */
  conversationsOpen: boolean
  setConversationsOpen: (open: boolean) => void
}

export interface ChatPaneProps {
  agentId: string
  agentName: string
  initialMessages: ProviderMessage[]
  /** Where compactions summarized the conversation. */
  initialCompactions?: CompactionMark[]
  initialContext?: ContextUse | null
  /** SSR snapshot of the conversation file; what moved since is loaded when the page opens. */
  initialSessionHead?: SessionHeadResponse
  /** The bar above the conversation; the Agent's name alone without it. */
  header?: (chat: ChatControls) => ReactNode
  /** Open another conversation of this Agent to read (a queued follow-up's). */
  onViewConversation?: (conversationId: string) => void
  /** The conversation on screen changed: the first turn made one, or another was loaded. */
  onConversationChange?: (conversationId: string | null) => void
}

/** Unsent text per Agent, kept while the page is open. */
const drafts = new Map<string, string>()

export const CHAT_FRAME =
  'relative flex h-full flex-col overflow-hidden rounded-[16px] border border-frost bg-snow shadow-baziu-sm'

/** One pane per Agent: switching Agents starts a fresh one. */
export function ChatPane(props: ChatPaneProps) {
  return <AgentChat key={props.agentId} {...props} />
}

function AgentChat({
  agentId,
  agentName,
  initialMessages,
  initialCompactions,
  initialContext,
  initialSessionHead,
  header,
  onViewConversation,
  onConversationChange,
}: ChatPaneProps) {
  const markdownReady = useMarkdownReady()
  const activity = useActivityOptional()
  const [conversationsOpen, setConversationsOpen] = useState(false)
  const chat = useChatSession({
    agentId,
    initialMessages,
    ...(initialCompactions ? { initialCompactions } : {}),
    ...(initialContext !== undefined ? { initialContext } : {}),
    initialSessionHead,
    onOpenLibrary: () => setConversationsOpen(true),
    onConversation: onConversationChange,
  })
  // What was typed and not sent waits here while another Agent is open (for this page only).
  const [input, setInputState] = useState(() => drafts.get(agentId) ?? '')
  // Editing the last message borrows the composer; cancelling gives back what was in it. While
  // editing, the draft kept for this Agent is what was there before, never the edited message.
  const beforeEdit = useRef('')
  const editingRef = useRef(false)
  // An edit can also end on its own (another turn began): the composer is no longer borrowed.
  useEffect(() => {
    if (!chat.editing) editingRef.current = false
  }, [chat.editing])
  const setInput = (next: string | ((current: string) => string)) =>
    setInputState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      const kept = editingRef.current ? beforeEdit.current : value
      if (kept) drafts.set(agentId, kept)
      else drafts.delete(agentId)
      return value
    })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)

  // Opened from a search: go to the message found, and stop following the end.
  const workspace = useWorkspaceOptional()
  const navigate = useNavigate()
  useFindInTranscript(logRef, workspace?.search.find, workspace?.search.match, () => {
    nearBottomRef.current = false
    if (workspace)
      void navigate({
        to: '/',
        search: workspace.to({ find: undefined, match: undefined }),
        replace: true,
      })
  })

  // Back at this Agent: where the reader was. Before the effect below, so it does not jump to the end.
  useTranscriptPlace(logRef, () => placeKey(agentId, chat.conversationId()), {
    ready: true,
    skip: Boolean(workspace?.search.find),
    onRestored: () => {
      nearBottomRef.current = false
    },
  })

  // Follow new output while the reader is at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    const log = logRef.current
    if (log && nearBottomRef.current) log.scrollTop = log.scrollHeight
  })

  // What another source added is marked for a moment. A reader who had scrolled up stays where
  // they are, with a way down to it.
  const [unseen, setUnseen] = useState(false)
  const messageCount = useRef(-1)
  const arrivalSeen = useRef(chat.arrival)
  useLayoutEffect(() => {
    const log = logRef.current
    if (!log) return
    const messages = log.querySelectorAll<HTMLElement>('[data-message]')
    if (chat.arrival !== arrivalSeen.current && messageCount.current >= 0) {
      const fresh = Array.from(messages).slice(messageCount.current)
      markArrived(fresh)
      if (fresh.length > 0 && !nearBottomRef.current) setUnseen(true)
    }
    arrivalSeen.current = chat.arrival
    messageCount.current = messages.length
  })

  async function addFiles(files: FileList | File[]) {
    // Encoding takes a while for a large file; a removal, another add or a send may happen
    // meanwhile, so the new files join the list as it is once they are ready.
    const added = await encodeFiles(files)
    setAttachments((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS))
  }

  async function submit() {
    const draft: Draft = { text: input, attachments }
    if (!draft.text.trim() && draft.attachments.length === 0) return
    // An edit sent gives the composer back what was typed before it.
    const earlier = editingRef.current ? beforeEdit.current : ''
    editingRef.current = false
    beforeEdit.current = ''
    setInput(earlier)
    setAttachments([])
    const restore = await chat.send(draft)
    activity?.refresh()
    if (restore) {
      setInput((current) => (current && current !== earlier ? current : restore.text))
      setAttachments((current) => (current.length > 0 ? current : restore.attachments))
    }
  }

  function edit() {
    const text = chat.startEdit()
    if (text === null) return
    beforeEdit.current = input
    editingRef.current = true
    setInput(text)
    inputRef.current?.focus()
  }

  const empty = !chat.historyUnavailable && chat.entries.length === 0 && chat.notes.length === 0
  // A turn this tab does not stream (a follow-up, Telegram, a schedule) still shows as work.
  const elsewhere = chat.agentBusy && !chat.turnBusy
  const state = activity?.stateOf(agentId)
  const working = state?.kind === 'working' ? state.text.replace(/^Working:?\s*/, '') : ''
  // A turn blocked on a question or a command to approve is not working: it waits for you.
  const waiting = state?.kind === 'needs'

  return (
    <section
      aria-label={`Chat with ${agentName}`}
      className={CHAT_FRAME}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        // Only when the pointer leaves the pane itself, not a child.
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        setDragging(false)
        void addFiles(event.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] border-2 border-dashed border-sapphire bg-sapphire-glow/80 text-[0.95em] font-medium text-sapphire-deep">
          drop images or files to attach
        </div>
      )}
      {header ? (
        header({
          agentBusy: chat.agentBusy,
          context: chat.context,
          reload: chat.refreshHistory,
          conversationsOpen,
          setConversationsOpen,
        })
      ) : (
        <div className="border-b border-frost px-4 py-2.5">
          <h1 className="m-0 truncate font-display text-xl text-charcoal">{agentName}</h1>
        </div>
      )}
      {chat.historyUnavailable && (
        <p role="alert" className="mx-5 mt-2 text-sm">
          This conversation's history is unavailable. Start a new conversation from the list above;
          earlier conversations and their files stay listed.
        </p>
      )}
      <div
        ref={logRef}
        onScroll={(event) => {
          nearBottomRef.current = isAtEnd(event.currentTarget)
          if (nearBottomRef.current) setUnseen(false)
        }}
        role="log"
        aria-label={`Conversation with ${agentName}`}
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={chat.turnBusy}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        <div className="mx-auto max-w-[50rem]">
          {empty && (
            <p className="py-12 text-center italic text-mocha-light">
              Say what you need. {agentName} keeps this conversation between turns.
            </p>
          )}
          <TranscriptBlocks
            entries={chat.entries}
            notes={chat.notes}
            markdownReady={markdownReady}
            editableEntry={chat.editableEntry}
            replacedFrom={chat.replacedFrom}
            onEdit={edit}
            approvals={chat.approvals}
          />
          {(chat.thinking || elsewhere) && (
            <div
              role="status"
              className={`flex items-center gap-2 px-1 py-1.5 text-[0.85em] ${waiting ? 'text-warning' : 'text-success'}`}
            >
              <span
                className={`size-[7px] rounded-full ${waiting ? 'bg-warning' : 'animate-pulse bg-success'}`}
                aria-hidden="true"
              />
              <span>
                {waiting
                  ? `${agentName} is waiting for you`
                  : `${agentName} is working${working ? `: ${working}` : ''}`}
              </span>
            </div>
          )}
        </div>
      </div>
      {unseen && (
        <div className="pointer-events-none relative z-10 -mt-12 mb-2 flex justify-center">
          <Button
            variant="primary"
            className="pointer-events-auto shadow-baziu-sm"
            onClick={() => {
              const log = logRef.current
              if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
              nearBottomRef.current = true
              setUnseen(false)
            }}
          >
            New messages ↓
          </Button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {chat.turnBusy ? `${agentName} is responding.` : 'Conversation ready.'}
      </p>

      <FollowUps
        agentId={agentId}
        queue={chat.queue}
        onChanged={() => void chat.refreshQueue()}
        onViewConversation={(id) => onViewConversation?.(id)}
        conversationId={chat.conversationId()}
      />
      <AgentQuestions agentId={agentId} agentName={agentName} refreshKey={chat.questionsKey} />
      <Composer
        agentName={agentName}
        value={input}
        onChange={setInput}
        onSubmit={() => void submit()}
        attachments={attachments}
        onAddFiles={(files) => void addFiles(files)}
        onRemoveAttachment={(index) =>
          setAttachments((current) => current.filter((_, i) => i !== index))
        }
        editing={chat.editing}
        onCancelEdit={() => {
          chat.cancelEdit()
          editingRef.current = false
          setInput(beforeEdit.current)
          beforeEdit.current = ''
        }}
        agentBusy={chat.agentBusy}
        onStop={() => void chat.stop()}
        inputRef={inputRef}
        dictation={workspace?.speech.transcription ?? false}
      />
    </section>
  )
}

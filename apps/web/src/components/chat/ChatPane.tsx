// The conversation with one Agent: the transcript, what waits for an answer, and the composer.
// The state lives in useChatSession; this file lays it out. The bar above it comes from the
// workspace, which knows about Teams, panels and other conversations.

import type { Attachment, ProviderMessage, SessionHeadResponse } from '@bazilion/api-types'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useActivityOptional } from '../../lib/activity'
import { AgentQuestions } from './AgentQuestions'
import { Composer, encodeFiles, MAX_ATTACHMENTS } from './Composer'
import { FollowUps } from './FollowUps'
import { TranscriptBlocks, useMarkdownReady } from './Transcript'
import { type Draft, useChatSession } from './useChatSession'

const AUTOSCROLL_THRESHOLD_PX = 40

/** What the bar above the conversation can do to it. */
export interface ChatControls {
  /** A turn runs, started here or elsewhere. */
  agentBusy: boolean
  /** Load the selected conversation again, e.g. after switching to another one. */
  reload: () => Promise<void>
  /** `/new` asks for the list of conversations. */
  conversationsOpen: boolean
  setConversationsOpen: (open: boolean) => void
}

export interface ChatPaneProps {
  agentId: string
  agentName: string
  initialMessages: ProviderMessage[]
  /** SSR snapshot of the conversation file; the stale banner compares against it. */
  initialSessionHead?: SessionHeadResponse
  /** The bar above the conversation; the Agent's name alone without it. */
  header?: (chat: ChatControls) => ReactNode
  /** Open another conversation of this Agent to read (a queued follow-up's). */
  onViewConversation?: (conversationId: string) => void
  /** The conversation on screen changed: the first turn made one, or another was loaded. */
  onConversationChange?: (conversationId: string | null) => void
}

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
    initialSessionHead,
    onOpenLibrary: () => setConversationsOpen(true),
    onConversation: onConversationChange,
  })
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)

  // Follow new output while the reader is at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    const log = logRef.current
    if (log && nearBottomRef.current) log.scrollTop = log.scrollHeight
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
    setInput('')
    setAttachments([])
    const restore = await chat.send(draft)
    activity?.refresh()
    if (restore) {
      setInput((current) => current || restore.text)
      setAttachments((current) => (current.length > 0 ? current : restore.attachments))
    }
  }

  function edit() {
    const text = chat.startEdit()
    if (text === null) return
    setInput(text)
    inputRef.current?.focus()
  }

  const empty = !chat.historyUnavailable && chat.entries.length === 0 && chat.notes.length === 0
  // A turn this tab does not stream (a follow-up, Telegram, a schedule) still shows as work.
  const elsewhere = chat.agentBusy && !chat.turnBusy
  const state = activity?.stateOf(agentId)
  const working = state?.kind === 'working' ? state.text.replace(/^Working:?\s*/, '') : ''

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
          reload: chat.refreshHistory,
          conversationsOpen,
          setConversationsOpen,
        })
      ) : (
        <div className="border-b border-frost px-4 py-2.5">
          <h1 className="m-0 truncate font-display text-[1.2rem] text-charcoal">{agentName}</h1>
        </div>
      )}
      {chat.historyUnavailable && (
        <p role="alert" className="mx-5 mt-2 text-sm">
          This conversation's history is unavailable. Start a new conversation from the list above;
          earlier conversations and their files stay listed.
        </p>
      )}
      {chat.stale && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mx-5 mt-2 flex items-center gap-2 rounded-[10px] border border-sapphire-light bg-sapphire-glow px-3 py-2 text-[0.86em] text-sapphire-deep"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-sapphire" aria-hidden="true" />
          <span className="flex-1">
            {chat.recoveredTurn
              ? 'The recovered turn has new activity.'
              : 'There is new activity from another source (a follow-up, Telegram or a schedule).'}
          </span>
          <button
            type="button"
            onClick={() => void chat.refreshHistory()}
            className="unstyled rounded-md bg-sapphire px-3 py-1 text-[0.92em] font-semibold text-snow hover:bg-sapphire-deep"
          >
            Show it
          </button>
          <button
            type="button"
            onClick={chat.dismissStale}
            className="unstyled px-1 text-sapphire-deep hover:opacity-70"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div
        ref={logRef}
        onScroll={(event) => {
          const log = event.currentTarget
          nearBottomRef.current =
            log.scrollHeight - log.scrollTop - log.clientHeight < AUTOSCROLL_THRESHOLD_PX
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
              className="flex items-center gap-2 px-1 py-1.5 text-[0.85em] text-success"
            >
              <span
                className="size-[7px] animate-pulse rounded-full bg-success"
                aria-hidden="true"
              />
              <span>
                {agentName} is working{working ? `: ${working}` : ''}
              </span>
            </div>
          )}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {chat.turnBusy ? `${agentName} is responding.` : 'Conversation ready.'}
      </p>

      <FollowUps
        agentId={agentId}
        queue={chat.queue}
        onChanged={() => void chat.refreshQueue()}
        onViewConversation={(id) => onViewConversation?.(id)}
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
        onCancelEdit={chat.cancelEdit}
        agentBusy={chat.agentBusy}
        onStop={() => void chat.stop()}
        inputRef={inputRef}
      />
    </section>
  )
}

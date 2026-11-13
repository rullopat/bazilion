// The chat with one Agent: header, conversation library, transcript, side panels and composer.
// The state lives in useChatSession; this file lays it out.

import type { Attachment, ProviderMessage, SessionHeadResponse } from '@bazilion/api-types'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../Button'
import { AgentQuestions } from './AgentQuestions'
import { Composer, encodeFiles, MAX_ATTACHMENTS } from './Composer'
import { ConversationLibrary } from './ConversationLibrary'
import { FollowUps } from './FollowUps'
import { Bubble, useMarkdownReady } from './Transcript'
import { type Draft, type SystemNote, useChatSession } from './useChatSession'

const AUTOSCROLL_THRESHOLD_PX = 40

export interface ChatPaneProps {
  agentId: string
  agentName: string
  initialMessages: ProviderMessage[]
  /** SSR snapshot of the conversation file; the stale banner compares against it. */
  initialSessionHead?: SessionHeadResponse
  /** Open the conversation library on this conversation (a link from a saved result). */
  openConversationId?: string
}

/** One pane per Agent: switching Agents starts a fresh one. */
export function ChatPane(props: ChatPaneProps) {
  return <AgentChat key={props.agentId} {...props} />
}

function AgentChat({
  agentId,
  agentName,
  initialMessages,
  initialSessionHead,
  openConversationId,
}: ChatPaneProps) {
  const markdownReady = useMarkdownReady()
  const [libraryOpen, setLibraryOpen] = useState(Boolean(openConversationId))
  const [libraryConversation, setLibraryConversation] = useState(openConversationId)
  const chat = useChatSession({
    agentId,
    initialMessages,
    initialSessionHead,
    onOpenLibrary: () => setLibraryOpen(true),
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

  return (
    <section
      aria-label={`Chat with ${agentName}`}
      className="relative flex h-full flex-col overflow-hidden rounded-[16px] border border-frost bg-snow shadow-baziu-sm"
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
      <div className="flex items-center justify-between gap-3 border-b border-frost px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <a
            href="/"
            className="inline-flex h-7 items-center rounded-md border border-frost px-2 text-xs font-semibold text-mocha lg:hidden"
          >
            ← agents
          </a>
          <h1 className="truncate font-display text-[1.2rem] text-charcoal">{agentName}</h1>
        </div>
        <a
          href={`/agents/${encodeURIComponent(agentId)}/settings`}
          className="shrink-0 text-xs text-mocha-light hover:text-sapphire"
        >
          Manage agent →
        </a>
      </div>
      <div className="mx-5 mt-2">
        <Button
          variant="ghost"
          aria-expanded={libraryOpen}
          onClick={() => {
            setLibraryConversation(undefined)
            setLibraryOpen((open) => !open)
          }}
        >
          {libraryOpen ? 'Close conversations' : 'Conversations'}
        </Button>
      </div>
      {libraryOpen && (
        <ConversationLibrary
          key={libraryConversation ?? ''}
          agentId={agentId}
          initialConversationId={libraryConversation}
          turnBusy={chat.agentBusy}
          onCreated={chat.refreshHistory}
        />
      )}
      {chat.historyUnavailable && (
        <p role="alert" className="mx-5 mt-2 text-sm">
          The selected conversation's history is unavailable. Open Conversations to start a new one;
          earlier conversations and their files stay listed.
        </p>
      )}
      {chat.stale && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mx-5 mt-2 flex items-center gap-2 rounded-md border border-sapphire bg-frost px-4 py-2 text-[0.86em] text-mocha"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-sapphire" aria-hidden="true" />
          <span className="flex-1">
            {chat.recoveredTurn
              ? 'the recovered turn has new activity — reload to see it'
              : 'new activity from another source — reload to see it'}
          </span>
          <button
            type="button"
            onClick={() => void chat.refreshHistory()}
            className="rounded-sm bg-sapphire px-3 py-1 text-[0.92em] text-snow hover:opacity-90"
          >
            reload
          </button>
          <button
            type="button"
            onClick={chat.dismissStale}
            className="px-1 text-mocha-light hover:text-mocha"
            aria-label="dismiss"
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
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      >
        {empty && (
          <p className="py-12 text-center italic text-mocha-light">Start a conversation…</p>
        )}
        {withNotes(
          chat.entries.map((entry, index) => (
            <Bubble
              // biome-ignore lint/suspicious/noArrayIndexKey: entries only append within a turn.
              key={index}
              entry={entry}
              markdownReady={markdownReady}
              dropped={chat.replacedFrom >= 0 && index >= chat.replacedFrom}
              onEdit={index === chat.editableEntry ? edit : undefined}
              approvals={chat.approvals}
            />
          )),
          chat.notes,
          markdownReady,
        )}
        {chat.thinking && (
          <div className="flex items-center gap-2 px-1 py-1 text-[0.85em] text-mocha-light">
            <Dot />
            <Dot delay="0.15s" />
            <Dot delay="0.3s" />
            <span>agent is thinking…</span>
          </div>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {chat.turnBusy ? `${agentName} is responding.` : 'Conversation ready.'}
      </p>

      <FollowUps
        agentId={agentId}
        queue={chat.queue}
        onChanged={() => void chat.refreshQueue()}
        onViewConversation={(id) => {
          setLibraryConversation(id)
          setLibraryOpen(true)
        }}
      />
      <AgentQuestions agentId={agentId} refreshKey={chat.questionsKey} />
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

/** Each slash-command note goes after the entry that was last when it was produced. */
function withNotes(bubbles: ReactNode[], notes: SystemNote[], markdownReady: boolean): ReactNode[] {
  const out: ReactNode[] = []
  let next = 0
  const flush = (upTo: number) => {
    while (next < notes.length && (notes[next]?.afterIndex ?? 0) <= upTo) {
      const note = notes[next] as SystemNote
      out.push(
        <Bubble
          key={`note-${note.id}`}
          entry={{ type: 'system', content: note.content }}
          markdownReady={markdownReady}
        />,
      )
      next++
    }
  }
  flush(0)
  bubbles.forEach((bubble, index) => {
    out.push(bubble)
    flush(index + 1)
  })
  // Notes anchored past the end (the tail was replaced by an edit) stay visible at the bottom.
  flush(Number.POSITIVE_INFINITY)
  return out
}

function Dot({ delay = '0s' }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mocha-light/60"
      style={{ animationDelay: delay }}
      aria-hidden="true"
    />
  )
}

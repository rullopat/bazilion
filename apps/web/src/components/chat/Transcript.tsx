import type { CommandApproval, CompactionMark, ProviderMessage } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { type ReactNode, useMemo, useState, useSyncExternalStore } from 'react'
import { type InboxNote, inboxUpdateLabel, parseInboxWake } from '../../lib/inbox-presentation'
import { renderMd } from '../../lib/md'
import { dayKey, dayLabel, fullTime, timeOfDay } from '../../lib/message-time'
import { formatContext } from '../../lib/model-facts'
import { AgentAvatar } from '../AgentAvatar'
import { ResultTile } from '../files/ResultTile'
import { useWorkspaceOptional } from '../workspace/context'
import { CommandApprovalCard } from './CommandApprovalCard'
import { groupEntries, projectMessages, type RenderEntry, type TranscriptBlock } from './entries'
import { ProgressContext, progressBoard } from './Progress'
import { ReadAloud } from './ReadAloud'
import { StepsBlock } from './Steps'

const INBOX_WAKE_PREFIX = '[[bazilion:inbox-wake]]\n'
/** A turn started by something the Agent began earlier: a job that ended, a picture, an answer. */
const WAKE_PREFIX = '[[bazilion:wake]]\n'

const noSubscription = () => () => {}

/**
 * False during SSR and the hydration pass, true afterwards. Markdown renders as escaped text until
 * then, so the server HTML and the first client render match byte for byte.
 */
export function useMarkdownReady(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
}

export interface ApprovalControls {
  busy: Record<string, boolean>
  errors: Record<string, string>
  decide: (
    approval: CommandApproval,
    decision: 'allow' | 'deny',
    remember?: { prefix: string },
  ) => void
}

/**
 * When a message was sent, small, as in a messaging app (BAZ-101); pointing at it shows the whole
 * date. Shown once the page runs in the browser: the time zone is the browser's, not the server's.
 */
function MessageTime({ at, ready }: { at: number | undefined; ready: boolean }) {
  if (!at || !ready) return null
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={fullTime(at)}
      className="shrink-0 text-[0.72rem] tabular-nums text-mocha"
    >
      {timeOfDay(at)}
    </time>
  )
}

/** The line before a day's first message: Today, Yesterday, a weekday or a date. */
function DayDivider({ at }: { at: number }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[0.78rem] text-mocha">
      <span className="h-px flex-1 bg-frost" aria-hidden="true" />
      <p className="m-0 rounded-full border border-frost bg-card px-2.5 py-0.5 font-medium">
        {dayLabel(at)}
      </p>
      <span className="h-px flex-1 bg-frost" aria-hidden="true" />
    </div>
  )
}

/** A teammate's message that woke the Agent: who wrote it, whether it is a reply, its text. */
function TeammateMessage({ note, markdownReady }: { note: InboxNote; markdownReady: boolean }) {
  const workspace = useWorkspaceOptional()
  const sender = note.fromId ? workspace?.agents.find((agent) => agent.id === note.fromId) : null
  const name = sender?.name ?? note.fromName
  return (
    <section
      aria-label={`Message from ${name}`}
      className="rounded-xl border border-fawn bg-ivory px-3.5 py-2.5"
    >
      <header className="mb-1 flex items-center gap-2 text-sm">
        <AgentAvatar identity={sender?.identity} size={22} />
        {sender ? (
          <Link
            to="/"
            search={{ agent: sender.id }}
            className="font-semibold text-chocolate hover:text-sapphire"
          >
            {name}
          </Link>
        ) : (
          <span className="font-semibold text-chocolate">{name}</span>
        )}
        <span className="text-xs text-mocha">{note.reply ? 'replied' : 'wrote'}</span>
      </header>
      <div
        className="md-content bubble-content leading-[1.55] text-chocolate"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
        dangerouslySetInnerHTML={{ __html: renderMd(note.text, markdownReady) }}
      />
    </section>
  )
}

export function Bubble({
  entry,
  markdownReady,
  onEdit,
  dropped = false,
  approvals,
}: {
  entry: Exclude<RenderEntry, { type: 'tool' } | { type: 'result' }>
  markdownReady: boolean
  /** Shown on the last user message: edit and resend it. */
  onEdit?: () => void
  /** Struck through: an edit in progress replaces it. */
  dropped?: boolean
  approvals?: ApprovalControls
}) {
  const dropClass = dropped ? 'opacity-40 [&_.bubble-content]:line-through' : ''
  // Read aloud is offered while a speech model is ready (BAZ-096).
  const readAloud = useWorkspaceOptional()?.speech.speech ?? false
  switch (entry.type) {
    case 'user':
      if (entry.content.startsWith(WAKE_PREFIX)) {
        const body = entry.content.slice(WAKE_PREFIX.length)
        return (
          <details
            data-message=""
            className={`my-3 rounded-lg border border-fawn bg-ivory px-3 py-2 text-sm text-mocha ${dropClass}`}
            aria-label="Update"
          >
            <summary className="flex cursor-pointer items-baseline gap-2 font-medium">
              <span className="min-w-0 flex-1">{body.split('\n', 1)[0] || 'An update'}</span>
              <MessageTime at={entry.at} ready={markdownReady} />
            </summary>
            <p className="mt-2 text-xs">What the Agent was told</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {body}
            </pre>
          </details>
        )
      }
      if (entry.content.startsWith(INBOX_WAKE_PREFIX)) {
        const body = entry.content.slice(INBOX_WAKE_PREFIX.length)
        const notes = parseInboxWake(body)
        if (notes)
          return (
            <div data-message="" className={`my-4 space-y-2 ${dropClass}`}>
              {notes.map((note, index) => (
                <TeammateMessage
                  // biome-ignore lint/suspicious/noArrayIndexKey: a wake's messages never reorder.
                  key={index}
                  note={note}
                  markdownReady={markdownReady}
                />
              ))}
              <details className="px-1 text-xs text-mocha">
                <summary className="flex cursor-pointer items-baseline gap-2">
                  <span className="min-w-0 flex-1">What the Agent was told</span>
                  <MessageTime at={entry.at} ready={markdownReady} />
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words">
                  {body}
                </pre>
              </details>
            </div>
          )
        return (
          <details
            data-message=""
            className={`my-3 rounded-lg border border-fawn bg-ivory px-3 py-2 text-sm text-mocha ${dropClass}`}
            aria-label="Teammate update"
          >
            <summary className="flex cursor-pointer items-baseline gap-2 font-medium">
              <span className="min-w-0 flex-1">{inboxUpdateLabel(body)}</span>
              <MessageTime at={entry.at} ready={markdownReady} />
            </summary>
            <p className="mt-2 text-xs">Original message and Agent instructions</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {body}
            </pre>
          </details>
        )
      }
      return (
        <div data-message="" className={`group relative my-4 flex flex-col items-end ${dropClass}`}>
          <span className="sr-only">you</span>
          {entry.images && entry.images.length > 0 && (
            <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
              {entry.images.map((image, index) => (
                <img
                  // biome-ignore lint/suspicious/noArrayIndexKey: a message's images never reorder.
                  key={index}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt="attachment"
                  className="max-h-48 rounded-lg border border-sapphire-light"
                />
              ))}
            </div>
          )}
          {entry.files && entry.files.length > 0 && (
            <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
              {entry.files.map((file, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a message's files never reorder.
                  key={index}
                  className="flex items-center gap-1 rounded-md border border-sapphire-light bg-sapphire-glow px-2 py-1 text-[0.8em] text-chocolate"
                >
                  <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                </span>
              ))}
            </div>
          )}
          {entry.content && <UserText content={entry.content} />}
          {(onEdit || (entry.at && markdownReady)) && (
            <div className="mt-1 flex items-center gap-2">
              {onEdit && (
                // Under the message it changes; shown on hover and keyboard focus, and always on
                // a touch screen, which has no hover.
                <button
                  type="button"
                  onClick={onEdit}
                  title="Edit and resend: replaces the last turn"
                  className="rounded-md px-2 py-0.5 text-xs font-semibold text-mocha opacity-0 transition hover:bg-sapphire-glow hover:text-sapphire focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  Edit
                </button>
              )}
              <MessageTime at={entry.at} ready={markdownReady} />
            </div>
          )}
        </div>
      )
    case 'assistant':
      return (
        <div
          data-message=""
          className={`group/message my-4 flex flex-col items-start ${dropClass}`}
        >
          <span className="sr-only">agent</span>
          <div
            className="md-content bubble-content w-full leading-[1.55] text-chocolate"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
            dangerouslySetInnerHTML={{ __html: renderMd(entry.content, markdownReady) }}
          />
          {((entry.at && markdownReady) || (readAloud && entry.content.trim())) && (
            <div className="mt-1 flex items-center gap-2">
              <MessageTime at={entry.at} ready={markdownReady} />
              {readAloud && entry.content.trim() && <ReadAloud text={entry.content} />}
            </div>
          )}
        </div>
      )
    case 'images':
      return (
        <div className={`my-2 space-y-2 ${dropClass}`}>
          {entry.images.map((image, index) => (
            <img
              // biome-ignore lint/suspicious/noArrayIndexKey: a result's images never reorder.
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt="screenshot"
              className="block max-w-full rounded-lg border border-fawn"
            />
          ))}
        </div>
      )
    case 'command_approval':
      return (
        <CommandApprovalCard
          approval={entry.approval}
          busy={approvals?.busy[entry.approval.id] ?? false}
          error={approvals?.errors[entry.approval.id]}
          onDecision={approvals?.decide}
        />
      )
    case 'system':
      return (
        <div className="my-3 rounded-r-sm border-l-[3px] border-sapphire bg-sapphire-glow px-3 py-1 font-mono text-[0.88em] text-sapphire-deep">
          <span className="mr-2 font-semibold uppercase tracking-wider opacity-80">system</span>
          <span className="whitespace-pre-wrap">{entry.content}</span>
        </div>
      )
    case 'stopped':
      return (
        <p className="my-2 px-1 text-[0.85em] italic text-muted-foreground">
          {entry.reason === 'cancelled' ? 'Stopped.' : 'This reply failed.'}
        </p>
      )
    case 'error':
      return (
        <div className="my-3 rounded-r-sm border-l-[3px] border-danger bg-danger/10 px-3 py-1 text-[0.92em] text-danger">
          {entry.content}
        </div>
      )
    case 'compacted':
      return <CompactedDivider mark={entry.mark} markdownReady={markdownReady} />
    case 'compacting':
      return entry.state === 'failed' ? (
        <div
          role="alert"
          className="my-3 rounded-r-sm border-l-[3px] border-danger bg-danger/10 px-3 py-1 text-[0.92em] text-danger"
        >
          Could not summarize older messages: {entry.error}
        </div>
      ) : (
        <p role="status" className="my-2 flex items-center gap-2 px-1 text-[0.85em] text-mocha">
          {entry.state === 'running' && (
            <span className="size-[7px] animate-pulse rounded-full bg-success" aria-hidden="true" />
          )}
          {entry.state === 'running'
            ? 'Summarizing older messages to make room…'
            : 'Older messages summarized to make room.'}
        </p>
      )
  }
}

/**
 * Where a compaction summarized the conversation. The messages above stay for the reader; the
 * Agent reads the summary in their place.
 */
function CompactedDivider({
  mark,
  markdownReady,
}: {
  mark: CompactionMark
  markdownReady: boolean
}) {
  const size = formatContext(mark.tokensBefore)
  return (
    <details className="group my-5 text-[0.85em] text-mocha">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md [&::-webkit-details-marker]:hidden">
        <span className="h-px flex-1 bg-fawn" aria-hidden="true" />
        <span className="min-w-0 text-center">
          Older messages summarized to make room{size ? ` (${size} tokens)` : ''} ·{' '}
          <span className="font-semibold text-sapphire-deep group-open:hidden">
            Show the summary
          </span>
          <span className="hidden font-semibold text-sapphire-deep group-open:inline">
            Hide the summary
          </span>
        </span>
        <span className="h-px flex-1 bg-fawn" aria-hidden="true" />
      </summary>
      <div className="mt-2 rounded-[10px] border border-frost bg-muted px-3 py-2 text-chocolate">
        <p className="m-0 mb-1.5 text-[0.92em] text-mocha">
          The Agent reads this summary in place of the messages above; they stay here for you.
        </p>
        <div
          className="md-content"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
          dangerouslySetInnerHTML={{ __html: renderMd(mark.summary, markdownReady) }}
        />
      </div>
    </details>
  )
}

const LONG_LINES = 14
const LONG_CHARS = 1_400
const SHOWN_LINES = 8

/** The operator's words. A very long message (a pasted log, a review) starts folded. */
function UserText({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const lines = content.split('\n')
  const long = lines.length > LONG_LINES || content.length > LONG_CHARS
  const shown =
    !long || open
      ? content
      : lines
          .slice(0, SHOWN_LINES)
          .join('\n')
          .slice(0, LONG_CHARS / 2)
  return (
    <div className="bubble-content max-w-[85%] rounded-[14px_14px_4px_14px] border border-sapphire-light bg-sapphire-glow px-3 py-2 text-chocolate">
      <div className="whitespace-pre-wrap break-words">
        {shown}
        {long && !open ? '…' : ''}
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="unstyled mt-1.5 text-[0.82em] font-semibold text-sapphire-deep hover:underline"
        >
          {open ? 'Show less' : `Show the whole message (${lines.length} lines)`}
        </button>
      )}
    </div>
  )
}

/** A slash-command note, shown after the entry that was last when it was produced. */
export interface TranscriptNote {
  id: number
  content: string
  afterIndex: number
}

/** A run of work: the steps, then the files it delivered side by side. */
function WorkBlock({
  block,
  dropped,
}: {
  block: Extract<TranscriptBlock, { type: 'work' }>
  dropped: boolean
}) {
  const workspace = useWorkspaceOptional()
  return (
    <>
      {block.items.length > 0 && <StepsBlock items={block.items} dimmed={dropped} />}
      {block.resultIds.length > 0 && (
        <div
          className={`my-3 grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-3 ${
            dropped ? 'opacity-40' : ''
          }`}
        >
          {block.resultIds.map((resultId) => (
            <ResultTile
              key={resultId}
              resultId={resultId}
              {...(workspace?.team
                ? { open: workspace.to({ view: 'files', result: resultId }) }
                : {})}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * The transcript: entries grouped into blocks, with each slash-command note after the entry that
 * was last when it was produced.
 */
export function TranscriptBlocks({
  entries,
  notes = [],
  markdownReady,
  editableEntry = -1,
  replacedFrom = -1,
  onEdit,
  approvals,
}: {
  entries: readonly RenderEntry[]
  notes?: readonly TranscriptNote[]
  markdownReady: boolean
  /** The entry that offers "edit" (-1: none). */
  editableEntry?: number
  /** While editing, entries from here on are about to be replaced (-1: none). */
  replacedFrom?: number
  onEdit?: () => void
  approvals?: ApprovalControls
}) {
  // Progress cards show once per task, in the state of its latest call.
  const board = useMemo(() => progressBoard(entries), [entries])
  const out: ReactNode[] = []
  let next = 0
  // A note made when `afterIndex` entries existed goes before the block that starts there.
  const flush = (upTo: number) => {
    while (next < notes.length && (notes[next]?.afterIndex ?? 0) <= upTo) {
      const note = notes[next] as TranscriptNote
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
  // A line before the first message of each day, once the browser's time zone is known.
  let day: string | null = null
  for (const block of groupEntries(entries)) {
    flush(block.index)
    const at =
      markdownReady && block.type === 'entry' && 'at' in block.entry ? block.entry.at : undefined
    if (at && dayKey(at) !== day) {
      day = dayKey(at)
      out.push(<DayDivider key={`day-${block.index}`} at={at} />)
    }
    const dropped = replacedFrom >= 0 && block.index >= replacedFrom
    out.push(
      block.type === 'work' ? (
        <WorkBlock key={block.index} block={block} dropped={dropped} />
      ) : (
        <Bubble
          key={block.index}
          entry={block.entry}
          markdownReady={markdownReady}
          dropped={dropped}
          onEdit={block.index === editableEntry ? onEdit : undefined}
          approvals={approvals}
        />
      ),
    )
  }
  // Notes anchored past the end (the tail was replaced by an edit) stay visible at the bottom.
  flush(Number.POSITIVE_INFINITY)
  return <ProgressContext.Provider value={board}>{out}</ProgressContext.Provider>
}

/** A conversation's messages, read-only (an earlier conversation). */
export function ReadOnlyTranscript({
  messages,
  compactions,
}: {
  messages: ProviderMessage[]
  compactions?: CompactionMark[]
}) {
  const markdownReady = useMarkdownReady()
  return (
    <section aria-label="Conversation history">
      <TranscriptBlocks
        entries={projectMessages(messages, compactions)}
        markdownReady={markdownReady}
      />
    </section>
  )
}

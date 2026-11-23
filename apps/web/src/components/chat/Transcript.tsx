import type { CommandApproval, ProviderMessage } from '@bazilion/api-types'
import { FileText } from 'lucide-react'
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import { inboxUpdateLabel } from '../../lib/inbox-presentation'
import { renderMd } from '../../lib/md'
import { ResultTile } from '../files/ResultTile'
import { useWorkspaceOptional } from '../workspace/context'
import { CommandApprovalCard } from './CommandApprovalCard'
import { groupEntries, projectMessages, type RenderEntry, type TranscriptBlock } from './entries'
import { StepsBlock } from './Steps'

const INBOX_WAKE_PREFIX = '[[bazilion:inbox-wake]]\n'
const COMPACTION_REPLAY_PREFIX = '[conversation summary]'

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
  decide: (approval: CommandApproval, decision: 'allow' | 'deny') => void
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
  switch (entry.type) {
    case 'user':
      if (entry.content.startsWith(INBOX_WAKE_PREFIX)) {
        const body = entry.content.slice(INBOX_WAKE_PREFIX.length)
        return (
          <details
            data-message=""
            className={`my-3 rounded-lg border border-fawn bg-ivory px-3 py-2 text-sm text-mocha ${dropClass}`}
            aria-label="Teammate update"
          >
            <summary className="cursor-pointer font-medium">{inboxUpdateLabel(body)}</summary>
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
          {onEdit && (
            // Under the message it changes; shown on hover and keyboard focus, and always on a
            // touch screen, which has no hover.
            <button
              type="button"
              onClick={onEdit}
              title="Edit and resend: replaces the last turn"
              className="mt-1 rounded-md px-2 py-0.5 text-xs font-semibold text-mocha opacity-0 transition hover:bg-sapphire-glow hover:text-sapphire focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
            >
              Edit
            </button>
          )}
        </div>
      )
    case 'assistant':
      if (entry.content.startsWith(COMPACTION_REPLAY_PREFIX)) {
        const summary = entry.content.slice(COMPACTION_REPLAY_PREFIX.length).trim()
        return (
          <div
            className={`my-3 border-y border-dashed border-frost py-2 text-[0.85em] italic text-mocha-light ${dropClass}`}
          >
            <details>
              <summary className="cursor-pointer select-none text-center [&::-webkit-details-marker]:hidden">
                — conversation summary (click to expand) —
              </summary>
              <div
                className="md-content mt-2 rounded-sm bg-frost/40 p-2 not-italic"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
                dangerouslySetInnerHTML={{ __html: renderMd(summary, markdownReady) }}
              />
            </details>
          </div>
        )
      }
      return (
        <div data-message="" className={`my-4 flex flex-col items-start ${dropClass}`}>
          <span className="sr-only">agent</span>
          <div
            className="md-content bubble-content w-full leading-[1.55] text-chocolate"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
            dangerouslySetInnerHTML={{ __html: renderMd(entry.content, markdownReady) }}
          />
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
  }
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
  for (const block of groupEntries(entries)) {
    flush(block.index)
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
  return <>{out}</>
}

/** A conversation's messages, read-only (an earlier conversation). */
export function ReadOnlyTranscript({ messages }: { messages: ProviderMessage[] }) {
  const markdownReady = useMarkdownReady()
  return (
    <section aria-label="Conversation history">
      <TranscriptBlocks entries={projectMessages(messages)} markdownReady={markdownReady} />
    </section>
  )
}

// A file's diff, drawn two ways: one column for the narrow panel, the old and the new file side
// by side for the full-width view. A line of the file as it is now takes a comment.

import { MessageSquarePlus, X } from 'lucide-react'
import { Fragment, type ReactNode, useMemo, useState } from 'react'
import { type DiffLine, parsePatch, type SideRow, sideBySide } from '../../lib/diff'
import { Button } from '../Button'
import type { ReviewComment } from './review'

/** Rows drawn before "show the rest": a very long diff stays quick to open. */
const ROWS_AT_FIRST = 1_500

export interface DiffProps {
  patch: string
  /** The comments on this file. */
  comments: readonly ReviewComment[]
  onAddComment?: (line: number, note: string) => void
  onRemoveComment?: (id: number) => void
}

const NUMBER =
  'select-none px-2 text-right text-[0.7rem] leading-[1.6] text-mocha-light tabular-nums'
const TEXT = 'whitespace-pre-wrap px-2 leading-[1.6] [overflow-wrap:anywhere]'

/** The line number of a commentable line: click to comment on it. */
function LineButton({
  line,
  active,
  onClick,
}: {
  line: number
  active: boolean
  onClick?: () => void
}) {
  if (!onClick) return <span className={NUMBER}>{line}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Comment on line ${line}`}
      aria-label={`Comment on line ${line}`}
      className={`unstyled group/line relative ${NUMBER} hover:bg-primary hover:text-primary-foreground ${
        active ? 'bg-primary text-primary-foreground' : ''
      }`}
    >
      <span className="group-hover/line:invisible">{line}</span>
      <MessageSquarePlus
        className="invisible absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 group-hover/line:visible"
        aria-hidden="true"
      />
    </button>
  )
}

function Composer({
  line,
  onAdd,
  onCancel,
}: {
  line: number
  onAdd: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const submit = () => {
    if (note.trim()) onAdd(note.trim())
  }
  return (
    <div className="border-y border-primary/30 bg-accent/40 px-3 py-2.5 font-body">
      <textarea
        // biome-ignore lint/a11y/noAutofocus: opened by the click on the line.
        autoFocus
        aria-label={`Comment on line ${line}`}
        placeholder={`What should change on line ${line}?`}
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
        }}
        className="min-h-16 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          className="min-h-8 px-3 py-1 text-xs"
          disabled={!note.trim()}
          onClick={submit}
        >
          Add to the review
        </Button>
        <Button variant="ghost" className="min-h-8 px-3 py-1 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function CommentCards({
  comments,
  onRemove,
}: {
  comments: readonly ReviewComment[]
  onRemove?: (id: number) => void
}) {
  return (
    <div className="space-y-1.5 border-y border-primary/25 bg-accent/30 px-3 py-2 font-body">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="flex items-start gap-2 rounded-[10px] border border-border bg-card px-2.5 py-1.5 text-sm"
        >
          <p className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words text-chocolate">
            {comment.note}
          </p>
          {onRemove && (
            <button
              type="button"
              aria-label="Remove this comment"
              onClick={() => onRemove(comment.id)}
              className="unstyled flex size-6 shrink-0 items-center justify-center rounded-md text-mocha hover:bg-muted hover:text-danger"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** What sits under a line: its comments, and the composer when it is being commented. */
function useLineExtras({ comments, onAddComment, onRemoveComment }: DiffProps) {
  const [composing, setComposing] = useState<number | null>(null)
  const byLine = useMemo(() => {
    const map = new Map<number, ReviewComment[]>()
    for (const comment of comments) {
      if (comment.line === undefined) continue
      map.set(comment.line, [...(map.get(comment.line) ?? []), comment])
    }
    return map
  }, [comments])
  const under = (line: number | undefined): ReactNode => {
    if (line === undefined) return null
    const here = byLine.get(line)
    if (!here && composing !== line) return null
    return (
      <div className="col-span-full">
        {here && <CommentCards comments={here} onRemove={onRemoveComment} />}
        {composing === line && onAddComment && (
          <Composer
            line={line}
            onAdd={(note) => {
              onAddComment(line, note)
              setComposing(null)
            }}
            onCancel={() => setComposing(null)}
          />
        )}
      </div>
    )
  }
  const startOn = onAddComment
    ? (line: number) => () => setComposing((current) => (current === line ? null : line))
    : () => undefined
  return { composing, under, startOn }
}

function Rest({ hidden, onShow }: { hidden: number; onShow: () => void }) {
  if (hidden <= 0) return null
  return (
    <div className="col-span-full border-t border-frost/70 px-3 py-2 font-body">
      <Button variant="ghost" className="min-h-8 px-3 py-1 text-xs" onClick={onShow}>
        Show {hidden.toLocaleString()} more line{hidden === 1 ? '' : 's'}
      </Button>
    </div>
  )
}

const HUNK = 'col-span-full bg-accent/50 px-3 py-0.5 text-[0.7rem] text-accent-foreground'
const NOTE = 'col-span-full px-3 py-0.5 font-body text-[0.7rem] italic text-mocha-light'

/** One column: removed lines above the lines that replace them. */
export function UnifiedDiff(props: DiffProps) {
  const lines = useMemo(() => parsePatch(props.patch).lines, [props.patch])
  const [all, setAll] = useState(false)
  const { composing, under, startOn } = useLineExtras(props)
  const shown = all ? lines : lines.slice(0, ROWS_AT_FIRST)
  return (
    <div className="grid grid-cols-[2.6rem_2.6rem_minmax(0,1fr)] font-mono text-xs text-chocolate">
      {shown.map((line: DiffLine, index) => {
        if (line.kind === 'hunk') {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one patch never reorder.
            <div key={index} className={HUNK}>
              {line.text}
            </div>
          )
        }
        if (line.kind === 'note') {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one patch never reorder.
            <div key={index} className={NOTE}>
              {line.text}
            </div>
          )
        }
        const tone =
          line.kind === 'add'
            ? 'bg-success/[0.13]'
            : line.kind === 'remove'
              ? 'bg-danger/[0.13]'
              : ''
        const gutter =
          line.kind === 'add'
            ? 'bg-success/20'
            : line.kind === 'remove'
              ? 'bg-danger/20'
              : 'bg-muted/60'
        const newLine = line.kind === 'remove' ? undefined : line.newLine
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one patch never reorder.
          <Fragment key={index}>
            <span className={`${NUMBER} ${gutter}`}>{line.kind === 'add' ? '' : line.oldLine}</span>
            {newLine === undefined ? (
              <span className={`${NUMBER} ${gutter}`} />
            ) : (
              <span className={`grid ${gutter}`}>
                <LineButton
                  line={newLine}
                  active={composing === newLine}
                  onClick={startOn(newLine)}
                />
              </span>
            )}
            <span className={`${TEXT} ${tone}`}>
              <span className="select-none text-mocha-light">
                {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
              </span>
              {line.text}
            </span>
            {under(newLine)}
          </Fragment>
        )
      })}
      <Rest hidden={lines.length - shown.length} onShow={() => setAll(true)} />
    </div>
  )
}

/** Two columns: the file as it was, and as it is now. */
export function SplitDiff(props: DiffProps) {
  const rows = useMemo(() => sideBySide(parsePatch(props.patch).lines), [props.patch])
  const [all, setAll] = useState(false)
  const { composing, under, startOn } = useLineExtras(props)
  const shown = all ? rows : rows.slice(0, ROWS_AT_FIRST)
  return (
    <div className="grid grid-cols-[2.8rem_minmax(0,1fr)_2.8rem_minmax(0,1fr)] font-mono text-xs text-chocolate">
      {shown.map((row: SideRow, index) => {
        if (row.kind === 'hunk') {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the rows of one patch never reorder.
            <div key={index} className={HUNK}>
              {row.text}
            </div>
          )
        }
        if (row.kind === 'note') {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the rows of one patch never reorder.
            <div key={index} className={NOTE}>
              {row.text}
            </div>
          )
        }
        const { left, right } = row
        const leftTone = left?.changed ? 'bg-danger/[0.13]' : left ? '' : 'bg-muted/50'
        const rightTone = right?.changed ? 'bg-success/[0.13]' : right ? '' : 'bg-muted/50'
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the rows of one patch never reorder.
          <Fragment key={index}>
            <span className={`${NUMBER} ${left?.changed ? 'bg-danger/20' : 'bg-muted/60'}`}>
              {left?.line}
            </span>
            <span className={`${TEXT} border-r border-frost/70 ${leftTone}`}>{left?.text}</span>
            {right ? (
              <span className={`grid ${right.changed ? 'bg-success/20' : 'bg-muted/60'}`}>
                <LineButton
                  line={right.line}
                  active={composing === right.line}
                  onClick={startOn(right.line)}
                />
              </span>
            ) : (
              <span className={`${NUMBER} bg-muted/60`} />
            )}
            <span className={`${TEXT} ${rightTone}`}>{right?.text}</span>
            {under(right?.line)}
          </Fragment>
        )
      })}
      <Rest hidden={rows.length - shown.length} onShow={() => setAll(true)} />
    </div>
  )
}

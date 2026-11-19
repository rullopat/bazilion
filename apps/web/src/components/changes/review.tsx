// A review of a Team's changes: the comparison base, and the comments gathered so far. The
// Changes tab and the side-by-side view share it, so a comment made in one is in the other.

import type { RepositoryReviewResponse, ReviewChange } from '@bazilion/api-types'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useActivity } from '../../lib/activity'
import { ApiError, api, errorMessage } from '../../lib/api'
import { type Resource, useResource } from '../../lib/use-resource'

export interface ReviewComment {
  id: number
  path: string
  /** Line of the file as it is now; absent for a comment about the whole file. */
  line?: number
  note: string
}

export interface ReviewSession {
  /** The comparison base in use; empty means HEAD. */
  base: string
  comments: ReviewComment[]
  /** A note about the review as a whole. */
  note: string
}

const EMPTY: ReviewSession = { base: '', comments: [], note: '' }

interface ReviewStore {
  sessions: Record<string, ReviewSession>
  update: (teamId: string, change: (session: ReviewSession) => ReviewSession) => void
  nextId: () => number
}

const ReviewContext = createContext<ReviewStore | null>(null)

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Record<string, ReviewSession>>({})
  const counter = useRef(0)
  const update = useCallback<ReviewStore['update']>((teamId, change) => {
    setSessions((current) => ({ ...current, [teamId]: change(current[teamId] ?? EMPTY) }))
  }, [])
  const nextId = useCallback(() => ++counter.current, [])
  const value = useMemo(() => ({ sessions, update, nextId }), [sessions, update, nextId])
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}

export interface ReviewSessionControls extends ReviewSession {
  setBase: (base: string) => void
  setNote: (note: string) => void
  addComment: (comment: Omit<ReviewComment, 'id'>) => void
  removeComment: (id: number) => void
  /** After sending: the comments and the note are gone, the base stays. */
  clear: () => void
}

export function useReviewSession(teamId: string): ReviewSessionControls {
  const store = useContext(ReviewContext)
  if (!store) throw new Error('useReviewSession needs a ReviewProvider')
  const { sessions, update, nextId } = store
  const session = sessions[teamId] ?? EMPTY
  return useMemo(
    () => ({
      ...session,
      setBase: (base) => update(teamId, (current) => ({ ...current, base })),
      setNote: (note) => update(teamId, (current) => ({ ...current, note })),
      addComment: (comment) =>
        update(teamId, (current) => ({
          ...current,
          comments: [...current.comments, { ...comment, id: nextId() }],
        })),
      removeComment: (id) =>
        update(teamId, (current) => ({
          ...current,
          comments: current.comments.filter((comment) => comment.id !== id),
        })),
      clear: () => update(teamId, (current) => ({ ...current, comments: [], note: '' })),
    }),
    [session, teamId, update, nextId],
  )
}

function reviewPath(teamId: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return `/api/teams/${encodeURIComponent(teamId)}/review${query ? `?${query}` : ''}`
}

export interface ReviewList {
  /** Null when the Team cannot be reviewed; `unavailable` says why. */
  review: RepositoryReviewResponse | null
  unavailable: { code: string | undefined; message: string } | null
}

/** The changed files since the base, with who wrote each; loaded again when a turn ends. */
export function useReviewList(teamId: string, base: string): Resource<ReviewList> {
  const { turnsEnded } = useActivity()
  return useResource(
    async (signal): Promise<ReviewList> => {
      try {
        const review = await api<RepositoryReviewResponse>(
          reviewPath(teamId, { authors: '1', ...(base ? { base } : {}) }),
          { signal },
        )
        return { review, unavailable: null }
      } catch (cause) {
        if (!(cause instanceof ApiError) || signal.aborted) throw cause
        return { review: null, unavailable: { code: cause.code, message: errorMessage(cause) } }
      }
    },
    [teamId, base, turnsEnded],
  )
}

export interface FileDiff {
  path: string
  patch: string | null
  truncated: boolean
  omitted: string | null
}

/** One file's diff; `path` null loads nothing. */
export function useFileDiff(
  teamId: string,
  base: string,
  path: string | null,
  /** Changes when the list was loaded again, so the diff follows. */
  revision: unknown,
): Resource<FileDiff | null> {
  return useResource(
    async (signal): Promise<FileDiff | null> => {
      if (!path) return null
      const response = await api<RepositoryReviewResponse>(
        reviewPath(teamId, { patches: '1', path, ...(base ? { base } : {}) }),
        { signal },
      )
      const change = response.changes.changes.find((entry) => entry.path === path)
      return {
        path,
        patch: change?.patch ?? null,
        truncated: change?.patchTruncated ?? false,
        omitted: change?.contentOmitted ?? null,
      }
    },
    [teamId, base, path, revision],
  )
}

const STATUS_LETTER: Record<ReviewChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  type_changed: 'T',
  unmerged: 'U',
  untracked: 'N',
  unknown: '?',
}

const STATUS_TONE: Record<ReviewChange['status'], string> = {
  added: 'bg-success/15 text-success',
  untracked: 'bg-success/15 text-success',
  copied: 'bg-success/15 text-success',
  modified: 'bg-accent text-accent-foreground',
  renamed: 'bg-accent text-accent-foreground',
  type_changed: 'bg-accent text-accent-foreground',
  deleted: 'bg-danger/15 text-danger',
  unmerged: 'bg-warning/15 text-warning',
  unknown: 'bg-frost text-mocha',
}

/** The one-letter mark of a change: A added, M modified, D deleted… */
export function StatusMark({ status }: { status: ReviewChange['status'] }) {
  return (
    <span
      className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded font-mono text-[0.7rem] font-semibold ${STATUS_TONE[status]}`}
      aria-hidden="true"
    >
      {STATUS_LETTER[status]}
    </span>
  )
}

/** A path as its folder (quiet) and its file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

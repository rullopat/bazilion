// The Files view: everything the Team's Agents delivered, as a gallery. Filter by Agent and by
// kind, open one for its details, put two side by side, download them all, delete one.

import type { AgentResult, Team } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { Columns2, Download, MessageSquare, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { shortTime } from '../../lib/activity'
import { ApiError, api, apiFetch, errorMessage } from '../../lib/api'
import { useHydrated, useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { CopyButton } from '../CopyButton'
import { Segmented } from '../Segmented'
import { useWorkspace } from '../workspace/context'
import { FocusFrame } from '../workspace/FocusFrame'
import { ResultTile } from './ResultTile'
import {
  archivePath,
  formatBytes,
  isPreviewImage,
  isPreviewText,
  kindLabel,
  resultPath,
} from './result-utils'
import { useResults } from './use-results'

type Kind = 'all' | 'pictures' | 'documents'

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pictures', label: 'Pictures' },
  { id: 'documents', label: 'Documents' },
]

const isPicture = (result: AgentResult) => result.mimeType.startsWith('image/')

export function FilesView({ team }: { team: Team }) {
  const { agents, agentById, search, to } = useWorkspace()
  const router = useRouter()
  const hydrated = useHydrated()
  const [agentId, setAgentId] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [comparing, setComparing] = useState(false)
  const [otherId, setOtherId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AgentResult | null>(null)
  const members = agents.filter((agent) => agent.teamId === team.id)
  const files = useResults(team.id, agentId ? { agentId } : {}, 48)
  const shown = files.results.filter(
    (result) => kind === 'all' || (kind === 'pictures') === isPicture(result),
  )
  const selectedId = search.result ?? null

  // The file in the address may be older than the pages loaded: fetch it on its own.
  const listed = files.results.find((result) => result.id === selectedId)
  const fetched = useResource(
    async (signal) => {
      if (!selectedId || listed) return null
      try {
        return (await api<{ result: AgentResult }>(resultPath(selectedId), { signal })).result
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return null
        throw cause
      }
    },
    [selectedId, Boolean(listed)],
  )
  const selected = listed ?? fetched.data ?? null
  const other = files.results.find((result) => result.id === otherId) ?? null

  const select = (id: string | undefined) =>
    void router.navigate({ to: '/', search: to({ result: id }), replace: true })
  const stopComparing = () => {
    setComparing(false)
    setOtherId(null)
  }
  // Another file, or none, ends a comparison.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the selection matters.
  useEffect(stopComparing, [selectedId])

  const by = (result: AgentResult) => agentById(result.agentId)?.name
  const filter = agentId ? { agentId } : {}

  return (
    <FocusFrame
      view="files"
      actions={
        files.total > 0 && (
          <a
            href={archivePath({ teamId: team.id, ...filter })}
            download
            className="ghost-btn min-h-8 px-3 py-1 text-xs"
          >
            <Download className="size-3.5" aria-hidden="true" />
            Download {agentId ? 'these' : 'all'} {files.total} (.zip)
          </a>
        )
      }
    >
      <div
        className={`grid h-full min-h-0 grid-cols-1 ${
          selected ? 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]' : ''
        }`}
      >
        {selected && other ? (
          <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Columns2 className="size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
              <h2 className="m-0 min-w-0 flex-1 font-body text-sm font-semibold text-foreground">
                Side by side
              </h2>
              <Button variant="ghost" className="min-h-8 px-3 py-1 text-xs" onClick={stopComparing}>
                Stop comparing
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[selected, other].map((result) => (
                <figure key={result.id} className="m-0 min-w-0">
                  <Preview result={result} />
                  <figcaption className="mt-1.5 flex items-center gap-2 text-xs text-mocha">
                    <span className="min-w-0 flex-1 truncate" title={result.name}>
                      <strong className="text-foreground">{result.name}</strong> ·{' '}
                      {formatBytes(result.byteLength)}
                      {by(result) ? ` · ${by(result)}` : ''}
                    </span>
                    <a
                      href={resultPath(result.id, 'download')}
                      download={result.name}
                      className="shrink-0 font-semibold"
                    >
                      Download
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={`min-h-0 overflow-y-auto p-3 sm:p-4 ${selected ? 'hidden lg:block' : ''}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Segmented label="Kind of file" value={kind} options={KINDS} onChange={setKind} />
              <select
                aria-label="Delivered by"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                className="min-h-8 w-auto min-w-40 py-1 text-xs"
              >
                <option value="">Everyone in {team.name}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {files.loading && files.results.length === 0
                  ? 'Loading…'
                  : kind === 'all'
                    ? `${files.total} file${files.total === 1 ? '' : 's'}`
                    : `${shown.length} of the ${files.results.length} loaded`}
              </span>
            </div>

            {comparing && (
              <p
                role="status"
                className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/30 bg-accent/40 px-3 py-2 text-sm text-foreground"
              >
                <Columns2 className="size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  Choose the file to put beside <strong>{selected?.name}</strong>.
                </span>
                <Button
                  variant="ghost"
                  className="min-h-8 px-3 py-1 text-xs"
                  onClick={stopComparing}
                >
                  Stop comparing
                </Button>
              </p>
            )}
            {files.error && (
              <p role="alert" className="err">
                {files.error}
              </p>
            )}
            {!files.loading && !files.error && shown.length === 0 && (
              <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
                {files.total === 0
                  ? 'Nothing saved yet. Files an Agent delivers and pictures it generates are kept here with their original contents.'
                  : 'No file of this kind among the ones loaded.'}
              </p>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {shown.map((result) => (
                <ResultTile
                  key={result.id}
                  resultId={result.id}
                  result={result}
                  compact
                  selected={result.id === selectedId || result.id === otherId}
                  detail={[by(result), hydrated ? shortTime(result.createdAt) : null]
                    .filter(Boolean)
                    .join(' · ')}
                  open={to({ result: result.id })}
                  {...(comparing && result.id !== selectedId
                    ? { onPick: () => setOtherId(result.id) }
                    : {})}
                />
              ))}
            </div>
            {files.hasMore && (
              <div className="mt-4 text-center">
                <Button variant="ghost" disabled={files.loading} onClick={files.more}>
                  {files.loading
                    ? 'Loading…'
                    : `Show more (${files.total - files.results.length} left)`}
                </Button>
              </div>
            )}
          </div>
        )}

        {selected && (
          <aside
            aria-label={`Details of ${selected.name}`}
            className="min-h-0 overflow-y-auto border-border p-3 sm:p-4 lg:border-l"
          >
            <div className="mb-3 flex items-start gap-2">
              <h2 className="m-0 min-w-0 flex-1 break-words font-body text-base font-semibold leading-snug text-foreground">
                {selected.name}
              </h2>
              <button
                type="button"
                aria-label="Close the details"
                onClick={() => select(undefined)}
                className="unstyled flex size-8 shrink-0 items-center justify-center rounded-[10px] text-mocha hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <Preview result={selected} />

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={resultPath(selected.id, 'download')}
                download={selected.name}
                className="btn-primary min-h-9 px-3 py-1.5 text-sm no-underline"
              >
                <Download className="size-4" aria-hidden="true" />
                Download
              </a>
              {other ? (
                <Button variant="ghost" className="min-h-9" onClick={stopComparing}>
                  Stop comparing
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="min-h-9"
                  disabled={files.results.length < 2}
                  onClick={() => setComparing(true)}
                >
                  <Columns2 className="size-4" aria-hidden="true" />
                  Compare
                </Button>
              )}
              <Button variant="danger" className="min-h-9" onClick={() => setDeleting(selected)}>
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </Button>
            </div>

            <dl className="m-0 mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Delivered by</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1.5">
                <AgentAvatar identity={agentById(selected.agentId)?.identity} size={18} />
                <span className="min-w-0 truncate">
                  {by(selected) ?? 'An Agent that was deleted'}
                </span>
              </dd>
              <dt className="text-muted-foreground">Saved</dt>
              <dd className="m-0">
                {hydrated ? new Date(selected.createdAt).toLocaleString() : ''}
              </dd>
              <dt className="text-muted-foreground">Kind</dt>
              <dd className="m-0">
                {kindLabel(selected.mimeType, selected.name)} · {formatBytes(selected.byteLength)}
              </dd>
              {selected.imageModel && (
                <>
                  <dt className="text-muted-foreground">Made with</dt>
                  <dd className="m-0 break-all font-mono text-xs">{selected.imageModel}</dd>
                </>
              )}
              <dt className="text-muted-foreground">SHA-256</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate font-mono text-xs text-mocha">
                  {selected.sha256}
                </span>
                <CopyButton value={selected.sha256} ariaLabel="Copy the checksum" title="Copy" />
              </dd>
            </dl>

            {by(selected) && (
              <Link
                to="/"
                search={{
                  agent: selected.agentId,
                  conversation: selected.sessionId,
                  panel: 'files',
                }}
                className="ghost-btn mt-4 min-h-9 w-full text-sm"
              >
                <MessageSquare className="size-4" aria-hidden="true" />
                Open the conversation it came from
              </Link>
            )}
          </aside>
        )}
        {selectedId && !selected && !fetched.loading && (
          <p role="alert" className="m-0 p-4 text-sm text-muted-foreground">
            That saved file is not available any more.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this file'}?`}
        description={
          <p>
            The saved copy is removed for good, and the conversation shows it as unavailable. A file
            of the same name in the Team's workspace, if there is one, is not touched.
          </p>
        }
        confirmLabel="Delete saved file"
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        onConfirm={async () => {
          if (!deleting) return
          await api(resultPath(deleting.id), { method: 'DELETE' })
          select(undefined)
          await files.reload()
        }}
      />
    </FocusFrame>
  )
}

/** A file as large as the pane lets it be: the picture, the text, or what kind of file it is. */
function Preview({ result }: { result: AgentResult }) {
  const text = useResource(
    async (signal) => {
      if (!isPreviewText(result)) return null
      return (await apiFetch(resultPath(result.id, 'preview'), { signal })).text()
    },
    [result.id],
  )
  if (isPreviewImage(result)) {
    return (
      <a
        href={resultPath(result.id, 'preview')}
        target="_blank"
        rel="noreferrer"
        title="Open at full size"
      >
        <img
          src={resultPath(result.id, 'preview')}
          alt={result.name}
          className="block max-h-[60vh] w-full rounded-[10px] border border-border bg-muted object-contain"
        />
      </a>
    )
  }
  if (isPreviewText(result)) {
    return (
      <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-muted p-3 font-mono text-xs leading-relaxed">
        {text.error ? errorMessage(text.error) : (text.data ?? 'Loading…')}
      </pre>
    )
  }
  return (
    <p className="m-0 rounded-[10px] border border-dashed border-border bg-muted/50 px-3 py-8 text-center text-sm text-muted-foreground">
      No preview for {kindLabel(result.mimeType, result.name)} files. Download it to open it.
    </p>
  )
}

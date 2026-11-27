// The Files tab: what the Team's Agents delivered, newest first, with pictures shown as
// pictures, narrowed by the same filters as the full-width view, which adds details, comparing
// and deleting.

import type { Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { Download, Images } from 'lucide-react'
import { shortTime } from '../../lib/activity'
import { useHydrated } from '../../lib/use-resource'
import { Button } from '../Button'
import { FileFilters, KIND_WORDS, useFileFilters } from '../files/FileFilters'
import { ResultTile } from '../files/ResultTile'
import { archivePath } from '../files/result-utils'
import { useResults } from '../files/use-results'
import { useWorkspace } from '../workspace/context'

const SMALL_ACTION =
  'inline-flex h-7 items-center gap-1 rounded-[10px] border border-border bg-card px-2 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire'

export function FilesPanel({ team }: { team: Team }) {
  const { agentById, to } = useWorkspace()
  const hydrated = useHydrated()
  const filters = useFileFilters(team)
  const { filter } = filters
  const files = useResults(team.id, filter, 12)
  const shown = files.results.filter(filters.matches)

  return (
    <div>
      <div className="mb-3">
        <FileFilters state={filters} />
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-muted-foreground">
          {files.loading && files.results.length === 0
            ? 'Loading…'
            : filters.kind === 'all'
              ? `${files.total} saved file${files.total === 1 ? '' : 's'}`
              : `${shown.length} of the ${files.results.length} loaded`}
        </p>
        <div className="flex gap-1.5">
          {/* The zip holds every kind: offered only while all kinds are shown. */}
          {files.total > 0 && filters.kind === 'all' && (
            <a
              href={archivePath({ teamId: team.id, ...filter })}
              download
              className={SMALL_ACTION}
              title="Download these files as one zip"
            >
              <Download className="size-3.5" aria-hidden="true" />
              All (.zip)
            </a>
          )}
          <Link to="/" search={to({ view: 'files', section: undefined })} className={SMALL_ACTION}>
            <Images className="size-3.5" aria-hidden="true" />
            Gallery
          </Link>
        </div>
      </div>

      {files.error && (
        <p role="alert" className="err">
          {files.error}
        </p>
      )}
      {!files.loading && !files.error && files.total === 0 && (
        <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
          Nothing saved {filters.narrowed ? 'here' : 'in this Team'} yet. Files an Agent delivers or
          pictures it generates are kept here with their original contents.
        </p>
      )}
      {!files.loading && files.total > 0 && shown.length === 0 && (
        <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
          No {filters.kind === 'all' ? 'files' : KIND_WORDS[filters.kind]} among the files loaded
          {files.hasMore ? '; Show more loads older ones.' : '.'}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {shown.map((result) => {
          const by = agentById(result.agentId)?.name
          return (
            <ResultTile
              key={result.id}
              resultId={result.id}
              result={result}
              compact
              detail={[by, hydrated ? shortTime(result.createdAt) : null]
                .filter(Boolean)
                .join(' · ')}
              open={to({ view: 'files', result: result.id, section: undefined })}
            />
          )
        })}
      </div>
      {files.hasMore && (
        <div className="mt-3">
          <Button variant="ghost" className="w-full" disabled={files.loading} onClick={files.more}>
            {files.loading ? 'Loading…' : `Show more (${files.total - files.results.length} left)`}
          </Button>
        </div>
      )}
    </div>
  )
}

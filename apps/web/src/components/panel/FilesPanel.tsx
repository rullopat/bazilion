// The Files tab: what the Team's Agents delivered, newest first, with pictures shown as
// pictures. The full-width view adds filters, details, comparing and deleting.

import type { Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { Download, Images } from 'lucide-react'
import { useState } from 'react'
import { shortTime } from '../../lib/activity'
import { useHydrated } from '../../lib/use-resource'
import { Button } from '../Button'
import { ResultTile } from '../files/ResultTile'
import { archivePath } from '../files/result-utils'
import { useResults } from '../files/use-results'
import { useWorkspace } from '../workspace/context'

type Scope = 'team' | 'agent' | 'conversation'

const CHIP =
  'unstyled inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-colors'
const SMALL_ACTION =
  'inline-flex h-7 items-center gap-1 rounded-[10px] border border-border bg-card px-2 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire'

export function FilesPanel({ team }: { team: Team }) {
  const { agent: open, agentById, conversationId, to } = useWorkspace()
  const hydrated = useHydrated()
  const [scope, setScope] = useState<Scope>('team')
  const openHere = open && open.team.id === team.id ? open.agent : null
  const effective: Scope =
    (scope === 'agent' && !openHere) || (scope === 'conversation' && !conversationId)
      ? 'team'
      : scope
  const filter =
    effective === 'agent' && openHere
      ? { agentId: openHere.id }
      : effective === 'conversation' && conversationId
        ? { sessionId: conversationId }
        : {}
  const files = useResults(team.id, filter, 12)
  const scopes: Array<{ id: Scope; label: string }> = [
    { id: 'team', label: 'Whole Team' },
    ...(openHere ? [{ id: 'agent' as const, label: openHere.name }] : []),
    ...(openHere && conversationId
      ? [{ id: 'conversation' as const, label: 'This conversation' }]
      : []),
  ]

  return (
    <div>
      {scopes.length > 1 && (
        <fieldset
          aria-label="Whose files"
          className="m-0 mb-3 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
        >
          {scopes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={effective === entry.id}
              onClick={() => setScope(entry.id)}
              className={`${CHIP} ${
                effective === entry.id
                  ? 'border-primary/30 bg-accent text-accent-foreground'
                  : 'border-border bg-card text-mocha hover:text-foreground'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </fieldset>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-muted-foreground">
          {files.loading && files.results.length === 0
            ? 'Loading…'
            : `${files.total} saved file${files.total === 1 ? '' : 's'}`}
        </p>
        <div className="flex gap-1.5">
          {files.total > 0 && (
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
          Nothing saved {effective === 'team' ? 'in this Team' : 'here'} yet. Files an Agent
          delivers or pictures it generates are kept here with their original contents.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {files.results.map((result) => {
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

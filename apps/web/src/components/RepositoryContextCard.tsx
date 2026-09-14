import type { RepositoryContextReport } from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

export function RepositoryContextCard({
  teamId,
}: {
  teamId: string
}) {
  const [target, setTarget] = useState('')
  const [capture, setCapture] = useState<{
    report: RepositoryContextReport
    target: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const report = capture?.report
  const issues = report
    ? [
        ...new Map(
          [...report.instructions.issues, ...report.commands.issues, ...report.git.issues].map(
            (issue) => [JSON.stringify([issue.path, issue.message]), issue] as const,
          ),
        ).values(),
      ]
    : []

  async function inspect() {
    const current = ++request.current
    const requestedTarget = target || '.'
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/repository-context?target=${encodeURIComponent(requestedTarget)}`,
        { cache: 'no-store' },
      )
      if (!response.ok)
        throw new Error('Repository context could not be loaded. Refresh to try again.')
      const data = (await response.json()) as RepositoryContextReport
      if (request.current === current) setCapture({ report: data, target: requestedTarget })
    } catch (err) {
      if (request.current === current)
        setError(err instanceof Error ? err.message : 'Inspection failed')
    } finally {
      if (request.current === current) setBusy(false)
    }
  }

  useEffect(() => {
    void inspect()
    return () => {
      request.current++
    }
  }, [teamId])

  return (
    <section className="min-w-0" aria-labelledby="repository-context-heading">
      <h2 id="repository-context-heading" className="font-serif text-xl mb-1">
        Explore the repository
      </h2>
      <p className="text-muted-foreground text-sm mb-3">
        See the instructions and commands for the part of the project you’re working on.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void inspect()
        }}
        className="flex flex-wrap gap-2 items-end mb-3"
      >
        <label className="flex-1 min-w-[12rem] m-0 text-sm">
          Project path
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder=". (Team root)"
            maxLength={4096}
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Inspecting…' : report ? 'Refresh context' : 'Inspect repository'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger mb-3">
          {error} {report ? 'The report below is the previous capture.' : ''}
        </p>
      )}
      {report && capture && (
        <div className="space-y-3 text-sm min-w-0" aria-live="polite">
          <p className="text-xs text-muted-foreground break-words">
            <code>{capture.target === '.' ? 'Team root' : capture.target}</code> · Inspected{' '}
            <time dateTime={new Date(report.capturedAt).toISOString()}>
              {new Date(report.capturedAt).toLocaleString()}
            </time>
            . Read-only inspection.
          </p>
          {issues.length > 0 && (
            <div role="status" className="border-l-2 border-primary bg-muted/40 px-3 py-2">
              <h3 className="font-sans text-sm font-semibold">Some context is unavailable</h3>
              <ul className="mt-1 space-y-1">
                {issues.map((issue, index) => (
                  <li key={index} className="break-words">
                    {issue.path ? `${issue.path}: ` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-md bg-muted/40 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-sans text-sm font-semibold">
                {report.git.state === 'available'
                  ? 'Working tree'
                  : report.git.state === 'not_repository'
                    ? 'No Git repository'
                    : 'Git unavailable'}
              </h3>
              {report.git.state === 'available' && (
                <p className="min-w-0 break-all">
                  <span className="font-mono">{report.git.branch ?? 'Detached HEAD'}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {report.git.head?.slice(0, 8) ?? 'No commits yet'}
                  </span>
                </p>
              )}
            </div>
            {report.git.state === 'available' && (
              <p className="text-xs text-muted-foreground mt-1">
                {report.git.staged} staged · {report.git.unstaged} unstaged · {report.git.untracked}{' '}
                untracked · {report.git.conflicted} conflicted
              </p>
            )}
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold">
              Instructions{' '}
              <span className="font-normal text-muted-foreground">
                · {report.instructions.files.length} files
                {report.instructions.state !== 'complete' ? ' · incomplete' : ''}
              </span>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Listed from broadest to most specific. Operator instructions and runtime policy take
              priority.
            </p>
            {report.instructions.files.length === 0 && (
              <p className="mt-2 text-muted-foreground">
                {report.instructions.state === 'complete'
                  ? 'No applicable AGENTS.md files found.'
                  : 'Instructions for this scope could not be prepared.'}
              </p>
            )}
            <div className="mt-2 divide-y">
              {report.instructions.files.map((file) => (
                <details key={file.path} className="py-2 min-w-0">
                  <summary className="cursor-pointer break-words font-mono text-sm">
                    {file.path}
                  </summary>
                  <pre className="mt-2 rounded-md bg-muted/40 p-3 whitespace-pre-wrap break-words text-xs max-h-80 overflow-auto">
                    {file.content}
                  </pre>
                </details>
              ))}
            </div>
          </div>
          <div className="border-t pt-3">
            <h3 className="font-sans text-sm font-semibold">Suggested commands</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Source suggestions for Agent investigation; inspection never executes commands.
            </p>
            {report.commands.candidates.length === 0 && (
              <p className="mt-2 text-muted-foreground">
                No command suggestions available for this scope.
              </p>
            )}
            <ul className="mt-1 divide-y">
              {report.commands.candidates.map((candidate, index) => (
                <li key={`${candidate.source}:${index}`} className="py-2 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="block bg-transparent p-0 whitespace-pre-wrap break-words min-w-0">
                      {candidate.command}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    {candidate.source} · {candidate.location} · cwd {candidate.cwd}
                    {candidate.kind === 'script'
                      ? ` · ${candidate.packageManager ?? 'package manager unknown'}`
                      : ' · documentation excerpt'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <details className="border-t pt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Source details and fingerprints</summary>
            <div className="mt-2 space-y-2">
              <p>
                Deeper repository instructions apply within their own subtree. Private Agent
                instructions are managed on each Agent.
              </p>
              <p className="break-all">Snapshot SHA-256: {report.fingerprint}</p>
              {report.git.head && <p className="break-all">Git commit: {report.git.head}</p>}
              {report.instructions.files.map((file) => (
                <p key={file.path} className="break-all">
                  <span className="font-mono">{file.path}</span> · Scope: {file.scope} · Precedence:{' '}
                  {file.precedence}
                  <br />
                  SHA-256: {file.sha256}
                </p>
              ))}
              {report.commands.sources.map((source) => (
                <p key={source.path} className="break-all">
                  <span className="font-mono">{source.path}</span>
                  <br />
                  SHA-256: {source.sha256}
                </p>
              ))}
            </div>
          </details>
        </div>
      )}
    </section>
  )
}

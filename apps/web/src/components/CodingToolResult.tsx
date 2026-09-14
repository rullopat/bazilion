import { useState } from 'react'
import { codingFailureSummary, PRIVATE_CODING_HISTORY } from '../lib/coding-presentation'
import { fetchRetainedCodingLog, type RetainedCodingLog } from '../lib/coding-log'
import { Button } from './Button'
import type {
  CodingCommandReceipt,
  CodingEnvironmentSnapshot,
  CodingLogReference,
  CodingReceiptView,
  RepositoryContextReport,
} from '@bazilion/api-types'

/**
 * Presents already-authorized chat text. A masked history card may additionally
 * offer retained output, but that read is an explicit operator action through
 * the daemon's releasing route — nothing is disclosed by rendering the card.
 */
export function CodingToolResult({
  name,
  body,
  pending = false,
  log,
}: {
  name: string
  body: string
  pending?: boolean
  /** Opaque pointer carried by a masked history projection. */
  log?: CodingLogReference
}) {
  if (!pending && body === PRIVATE_CODING_HISTORY) return (
    <details className="py-1 text-xs font-sans" aria-label="Private command details">
      <summary className="cursor-pointer">Detailed output isn’t included in this history view</summary>
      <p className="mt-1">The Agent’s summary is shown in the conversation. Ask the Agent to summarize its retained command result if you need more detail.</p>
      {log && <RetainedLogControl reference={log} />}
    </details>
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return <span>{body}</span>
  }
  if (!parsed || typeof parsed !== 'object') return <span>{body}</span>
  if (pending) {
    const input = parsed as { command?: unknown; target?: unknown }
    return (
      <p className="py-1 break-words">
        {name === 'coding_command' ? 'Running' : 'Inspecting'}:{' '}
        {typeof input.command === 'string'
          ? input.command
          : typeof input.target === 'string'
            ? input.target
            : 'command evidence'}
      </p>
    )
  }
  if (name === 'repository_context') {
    const report = parsed as RepositoryContextReport
    if (!Array.isArray(report.instructions?.files)) return <span>{body}</span>
    return (
      <details className="py-1">
        <summary className="cursor-pointer">
          Repository: {report.target} ·{' '}
          {report.instructions.state === 'complete'
            ? `${report.instructions.files.length} instruction files`
            : 'instructions unavailable'}
        </summary>
        {report.instructions.files.map((file) => (
          <p key={file.path}>{file.path}</p>
        ))}
        <p>
          {report.commands?.candidates?.length ?? 0} suggested commands ·{' '}
          {report.git?.state === 'available' ? report.git.branch : 'Git unavailable'}
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{body}</pre>
      </details>
    )
  }
  if (name === 'coding_log') {
    const page = parsed as {
      availability?: unknown
      text?: unknown
      offset?: unknown
      hasMore?: unknown
      byteLength?: unknown
    }
    if (typeof page.text !== 'string' || typeof page.availability !== 'string') return <span>{body}</span>
    return (
      <details className="py-1" aria-label="Retained command output">
        <summary className="cursor-pointer">
          Retained output: {page.availability}
          {page.hasMore ? ' · more available' : ''}
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{page.text}</pre>
        <p className="text-xs">
          bytes {typeof page.offset === 'number' ? page.offset : 0}–
          {(typeof page.offset === 'number' ? page.offset : 0) + page.text.length} of{' '}
          {typeof page.byteLength === 'number' ? page.byteLength : 0}
        </p>
      </details>
    )
  }
  if (name === 'coding_environment') {
    const value = parsed as CodingEnvironmentSnapshot
    if (typeof value.posture !== 'string') return <span>{body}</span>
    return (
      <details className="py-1">
        <summary className="cursor-pointer">
          Environment: {value.posture} · {value.cwd}
        </summary>
        <p className="break-all">{value.imageId ?? 'Host runtime'}</p>
        {Array.isArray(value.restrictions) &&
          value.restrictions
            .filter((x) => typeof x === 'string')
            .map((text) => <p key={text}>{text}</p>)}
      </details>
    )
  }
  const view = parsed as CodingReceiptView
  const receipt = name === 'coding_receipt' ? view.receipt : (parsed as CodingCommandReceipt)
  if (
    !receipt ||
    typeof receipt.state !== 'string' ||
    typeof receipt.input?.command !== 'string' ||
    typeof receipt.input?.cwd !== 'string'
  )
    return <span>{body}</span>
  const failure = receipt.state === 'failed' && typeof receipt.diagnostic === 'string'
    ? codingFailureSummary(receipt.diagnostic) : null
  return (
    <div className="py-2" aria-label="Coding command result">
      <p className="font-sans">
        <strong className={receipt.state === 'succeeded' ? 'text-sapphire-deep' : 'text-mocha'}>
          {receipt.state.replaceAll('_', ' ')}
        </strong>{' '}
        · {receipt.input.purpose}
        {typeof receipt.exitCode === 'number' ? ` · exit ${receipt.exitCode}` : ''}
        {name === 'coding_receipt' ? ` · ${view.applicability}` : ''}
      </p>
      <p className="whitespace-pre-wrap break-words">{receipt.input.command}</p>
      <p className="text-xs">
        {receipt.input.cwd} · {receipt.environment?.posture} · result at execution time
      </p>
      {failure && <p className="mt-1 font-sans text-rose-baziu" aria-label="Command failure summary">{failure}</p>}
      {typeof receipt.reason === 'string' && <p>{receipt.reason}</p>}
      <details>
        <summary className="cursor-pointer">Output and evidence</summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
          {receipt.diagnostic}
        </pre>
        {receipt.truncated && <p>Output truncated.</p>}
        <p className="break-all">coding-receipt:{receipt.id}</p>
        {receipt.environment?.imageId && <p className="break-all">{receipt.environment.imageId}</p>}
      </details>
    </div>
  )
}

/**
 * Explicit operator read of a retained log. Loads a single bounded first page
 * on demand; the daemon re-authorizes every call and reports a held log as
 * `not-shared` so it can never be mistaken for an empty result.
 */
function RetainedLogControl({ reference }: { reference: CodingLogReference }) {
  const [result, setResult] = useState<RetainedCodingLog | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setResult(await fetchRetainedCodingLog(reference))
    } finally {
      setLoading(false)
    }
  }

  if (result === null)
    return (
      <p className="mt-2">
        <Button variant="ghost" disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Show retained output'}
        </Button>
      </p>
    )

  if (result.status === 'not-shared')
    return <p className="mt-2">This command’s output hasn’t been shared with the conversation yet.</p>
  if (result.status === 'missing')
    return <p className="mt-2">This retained output is no longer available.</p>
  if (result.status === 'unavailable')
    return (
      <p className="mt-2" role="alert">
        {result.message}
      </p>
    )

  return (
    <div className="mt-2">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[rgba(42,31,22,0.04)] p-2">
        {result.page.text}
      </pre>
      <p>
        Retained output: {result.page.availability}
        {result.page.hasMore ? ' · earlier output omitted' : ''} · bytes {result.page.offset}–
        {result.page.offset + result.page.text.length} of {result.page.byteLength}
      </p>
    </div>
  )
}

import { codingFailureSummary, PRIVATE_CODING_HISTORY } from '../lib/coding-presentation'
import type {
  CodingCommandReceipt,
  CodingEnvironmentSnapshot,
  CodingReceiptView,
  RepositoryContextReport,
} from '@bazilion/api-types'

/** Presents only already-authorized chat text; never fetches private receipt records. */
export function CodingToolResult({
  name,
  body,
  pending = false,
}: {
  name: string
  body: string
  pending?: boolean
}) {
  if (!pending && body === PRIVATE_CODING_HISTORY) return (
    <details className="py-1 text-xs font-sans" aria-label="Private command details">
      <summary className="cursor-pointer">Detailed output isn’t included in this history view</summary>
      <p className="mt-1">The Agent’s summary is shown in the conversation. Ask the Agent to summarize its retained command result if you need more detail.</p>
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

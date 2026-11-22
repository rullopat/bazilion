// The Skills page's import dialog and what it says about a skill's scan.

import type { ImportSkillsResponse, SkillScanFinding } from '@bazilion/api-types'
import { useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { count } from '../../lib/manage'
import { cn } from '../../lib/utils'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'
import { CheckboxRow, ChoiceCards, TextField } from '../ui/form'
import { Notice } from '../ui/parts'

/** A scan's findings, one to a line: what it found, and where. */
export function FindingLines({ findings }: { findings: readonly SkillScanFinding[] }) {
  return (
    <ul className="m-0 mt-1 grid list-none gap-1 p-0">
      {findings.map((finding, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a scan's findings never reorder.
        <li key={index} className="min-w-0">
          <span className={finding.severity === 'danger' ? 'font-semibold' : ''}>
            {finding.severity === 'danger' ? 'Risky' : 'Check'}:
          </span>{' '}
          {finding.message}{' '}
          <span className="text-muted-foreground">
            ({finding.code}
            {finding.line ? `, line ${finding.line}` : ''})
          </span>
        </li>
      ))}
    </ul>
  )
}

/** What the scan found in one skill, or in what was imported. */
export function FindingsNotice({
  findings,
  title,
}: {
  findings: readonly SkillScanFinding[]
  title?: string
}) {
  const danger = findings.some((finding) => finding.severity === 'danger')
  return (
    <Notice
      tone={danger ? 'warning' : 'neutral'}
      title={
        title ??
        (danger
          ? 'Read it before an Agent uses it: its text goes into the system prompt.'
          : 'Worth a look.')
      }
    >
      <FindingLines findings={findings} />
    </Notice>
  )
}

type Source = 'openclaw' | 'path' | 'zip'

const SOURCES = [
  {
    value: 'openclaw',
    label: 'OpenClaw',
    hint: 'Every skill in ~/.openclaw/skills on the computer Bazilion runs on.',
  },
  {
    value: 'path',
    label: 'A folder',
    hint: 'One skill folder with a SKILL.md, or a folder of them, on that computer.',
  },
  {
    value: 'zip',
    label: 'A ZIP file',
    hint: 'Uploaded from here: one folder per skill at its top level.',
  },
] as const

/** Import skills from OpenClaw, a folder or a ZIP file; the scan's findings are shown here. */
export function ImportSkillsDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  /** Called after an import; resolves once the page has the new list. */
  onImported: (result: ImportSkillsResponse) => Promise<void>
}) {
  const [source, setSource] = useState<Source>('openclaw')
  const [path, setPath] = useState('')
  const [zip, setZip] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [findings, setFindings] = useState<SkillScanFinding[]>([])
  const pathProblem =
    source === 'path' && path.trim() && !path.trim().startsWith('/')
      ? 'The full path of the folder, starting with /.'
      : undefined
  const ready =
    source === 'openclaw' ||
    (source === 'path' && path.trim() !== '' && !pathProblem) ||
    (source === 'zip' && zip !== null)

  function chooseZip(file: File | undefined) {
    if (!file) return
    setError(null)
    if (!/\.zip$/i.test(file.name)) {
      setError('Only ZIP archives can be imported.')
      return
    }
    setZip(file)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    setFindings([])
    let body: unknown
    if (source === 'zip' && zip) {
      const form = new FormData()
      form.set('file', zip)
      if (force) form.set('force', 'true')
      body = form
    } else {
      body = { source: source === 'openclaw' ? 'openclaw' : path.trim(), force }
    }
    try {
      const result = await api<ImportSkillsResponse>('/api/skills/import', { body })
      await onImported(result)
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFindings((cause.body as { findings?: SkillScanFinding[] } | null)?.findings ?? [])
      }
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Import skills"
      description="A skill's SKILL.md is added to the system prompt of every Agent it is attached to. Each one is scanned before it is installed."
      busy={busy}
      onClose={onClose}
      className="max-w-2xl"
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4">
        <ChoiceCards
          legend="From"
          name="skills-source"
          value={source}
          options={SOURCES}
          columns={3}
          disabled={busy}
          onChange={(next) => {
            setSource(next)
            setError(null)
            setFindings([])
          }}
        />
        {source === 'path' && (
          <TextField
            label="Folder"
            value={path}
            disabled={busy}
            placeholder="/home/you/my-skills"
            mono
            className="max-w-none"
            problem={pathProblem}
            onChange={setPath}
          />
        )}
        {source === 'zip' && (
          <label
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              chooseZip(event.dataTransfer.files[0])
            }}
            className={cn(
              'relative m-0 block cursor-pointer rounded-xl border-2 border-dashed px-6 py-7 text-center text-sm transition-colors',
              dragOver
                ? 'border-primary bg-accent text-accent-foreground'
                : zip
                  ? 'border-solid border-primary/40 bg-card text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary hover:bg-accent/60',
            )}
          >
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(event) => chooseZip(event.target.files?.[0])}
              className="absolute h-px w-px overflow-hidden opacity-0"
            />
            {zip ? (
              <span className="block break-all font-mono text-foreground">{zip.name}</span>
            ) : (
              <>
                <span className="block font-semibold text-foreground">Choose a ZIP file</span>
                <span className="text-xs">or drop it here</span>
              </>
            )}
          </label>
        )}
        <CheckboxRow
          checked={force}
          disabled={busy}
          label="Replace skills that are already installed, and import despite scan findings"
          onChange={setForce}
        />
        {findings.length > 0 && (
          <FindingsNotice
            findings={findings}
            title={`The scan found ${count(findings.length, 'thing')} to check. Read them; to import anyway, tick the box above.`}
          />
        )}
        {error && findings.length === 0 && (
          <Notice tone="warning" role="alert" title="Nothing was imported.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {busy
              ? 'Importing…'
              : source === 'openclaw'
                ? 'Import from OpenClaw'
                : source === 'zip'
                  ? 'Upload and import'
                  : 'Import'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

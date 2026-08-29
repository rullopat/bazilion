import type { ImportSkillsResponse, SkillInfo, SkillScanFinding } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { type ChangeEvent, type DragEvent, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState, PageHeader, PageShell, SectionCard, StatusBadge } from '../../components/Page'
import { daemonClient } from '../../lib/daemon-client'

const fetchSkills = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<SkillInfo[]>('/api/skills'),
)

export const Route = createFileRoute('/skills/')({
  loader: () => fetchSkills(),
  component: SkillsPage,
})

type Tab = 'openclaw' | 'path' | 'zip'

function SkillsPage() {
  const skills = Route.useLoaderData()
  const router = useRouter()
  const [removeTarget, setRemoveTarget] = useState<SkillInfo | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function remove(name: string) {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not remove skill (${res.status})`)
    }
    await router.invalidate()
  }

  return (
    <PageShell size="wide">
      <PageHeader
        title="Skills"
        description="Install and review the prompt-only skills available to your agents."
      />
      {removeError && (
        <p role="alert" className="err">
          {removeError}
        </p>
      )}
      <ImportCard onImported={() => router.invalidate()} />

      <SectionCard
        title="Installed skills"
        description={`${skills.length} skill${skills.length === 1 ? '' : 's'} available`}
      >
        {skills.length === 0 ? (
          <EmptyState
            title="No skills installed"
            description="Import from OpenClaw, a server directory, or a ZIP archive to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="m-0 min-w-[760px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Scan</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.name}>
                    <td>
                      <code>{s.name}</code>
                    </td>
                    <td className="max-w-xl">
                      {s.parseError ? (
                        <div className="flex items-start gap-2 text-sm">
                          <StatusBadge variant="danger">Parse error</StatusBadge>
                          <span className="text-destructive">{s.parseError}</span>
                        </div>
                      ) : (
                        s.description
                      )}
                    </td>
                    <td>
                      <FindingSummary findings={s.scanFindings ?? []} />
                    </td>
                    <td className="text-xs text-muted-foreground">
                      <span className="font-mono">{s.source ?? 'Unknown'}</span>
                      {s.importedAt && (
                        <div className="mt-1 font-mono">
                          {new Date(s.importedAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      <Button
                        variant="danger"
                        className="whitespace-nowrap"
                        onClick={() => {
                          setRemoveError(null)
                          setRemoveTarget(s)
                        }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <ConfirmDialog
        open={removeTarget !== null}
        title={`Remove skill ${removeTarget?.name ?? ''}?`}
        description={
          <p>
            This permanently deletes the installed <code className="font-mono">SKILL.md</code> and
            every helper script or asset in the <code className="font-mono">{removeTarget?.name}</code>{' '}
            directory. The skill becomes unavailable to every Agent and Agent template until it is
            imported again.
          </p>
        }
        confirmLabel="delete installed skill"
        onConfirm={async () => {
          if (!removeTarget) return
          try {
            await remove(removeTarget.name)
          } catch (error) {
            setRemoveError(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      />
    </PageShell>
  )
}

function ImportCard({ onImported }: { onImported: () => void }) {
  const [tab, setTab] = useState<Tab>('openclaw')
  const [path, setPath] = useState('')
  const [force, setForce] = useState(false)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [findings, setFindings] = useState<SkillScanFinding[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr(null)
    setFindings([])
    setSubmitting(true)
    try {
      let res: Response
      if (tab === 'zip') {
        if (!zipFile) {
          setErr('Choose a ZIP file first.')
          setSubmitting(false)
          return
        }
        const fd = new FormData()
        fd.set('file', zipFile)
        if (force) fd.set('force', 'true')
        res = await fetch('/api/skills/import', { method: 'POST', body: fd })
      } else {
        let source: string
        if (tab === 'openclaw') {
          source = 'openclaw'
        } else {
          source = path.trim()
          if (!source) {
            setErr('Enter the server path.')
            setSubmitting(false)
            return
          }
        }
        res = await fetch('/api/skills/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source, force }),
        })
      }
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as {
          error?: string
          findings?: SkillScanFinding[]
        } | null
        setFindings(e2?.findings ?? [])
        throw new Error(e2?.error ?? `${res.status} ${res.statusText}`)
      }
      const imported = (await res.json().catch(() => null)) as ImportSkillsResponse | null
      setFindings(flattenImportFindings(imported?.findings))
      setPath('')
      setZipFile(null)
      onImported()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setZipFile(f)
  }
  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const f = files[0]
    if (!f) return
    if (!/\.zip$/i.test(f.name)) {
      setErr('Only ZIP archives are supported.')
      return
    }
    setZipFile(f)
    if (fileInput.current) {
      // Sync the underlying input so the label reflects state if anyone reads it.
      const dt = new DataTransfer()
      dt.items.add(f)
      fileInput.current.files = dt.files
    }
  }

  const findingsVariant = findings.some((finding) => finding.severity === 'danger')
    ? 'danger'
    : 'warning'

  return (
    <SectionCard
      title="Import skills"
      description={
        <>
          Choose a source. Each skill's <code>SKILL.md</code> body is injected into the system
          prompt of any agent it is attached to.
        </>
      }
    >
      <div
        role="tablist"
        className="mb-5 inline-flex max-w-full gap-0 overflow-x-auto rounded-lg border border-border bg-muted p-1"
      >
        {[
          { id: 'openclaw' as const, label: 'OpenClaw' },
          { id: 'path' as const, label: 'Server directory' },
          { id: 'zip' as const, label: 'Upload ZIP' },
        ].map((it) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={tab === it.id}
            onClick={() => {
              setTab(it.id)
              setErr(null)
            }}
            className={`unstyled cursor-pointer whitespace-nowrap rounded-md border-none bg-transparent px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === it.id
                ? 'bg-card text-accent-foreground shadow-baziu-sm'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {err && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {err}
        </div>
      )}
      {findings.length > 0 && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <StatusBadge variant={findingsVariant} className="mb-2">
            Scan findings
          </StatusBadge>
          <FindingList findings={findings} />
        </div>
      )}

      <form className="space-y-4" onSubmit={submit}>
        {tab === 'openclaw' && (
          <p className="text-sm leading-6 text-muted-foreground">
            One-click import of every skill found in <code>~/.openclaw/skills</code> on the
            server.
          </p>
        )}
        {tab === 'path' && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              Import from an absolute path on the server — either a single skill folder
              (contains <code>SKILL.md</code>) or a parent folder holding many skill subfolders.
            </p>
            <label className="max-w-2xl">
              Server path
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/home/you/my-skills"
                required
              />
            </label>
          </>
        )}
        {tab === 'zip' && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              Upload a <code>.zip</code> archive whose top level contains one folder per skill —
              the folder name becomes the skill name.
            </p>
            <label
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragOver
                  ? 'border-primary bg-accent text-accent-foreground'
                  : zipFile
                    ? 'border-solid border-primary/40 bg-card text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-primary hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip"
                onChange={onFileChange}
                className="absolute h-px w-px overflow-hidden opacity-0"
              />
              {zipFile ? (
                <span className="block break-all font-mono text-sm text-accent-foreground">
                  {zipFile.name}
                </span>
              ) : (
                <>
                  <span className="block text-sm font-medium text-foreground">
                    Click to choose a ZIP file
                  </span>
                  <span className="text-xs">or drag and drop it here</span>
                </>
              )}
            </label>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting
              ? 'Importing…'
              : tab === 'zip'
                ? 'Upload and import'
                : tab === 'openclaw'
                  ? 'Import from OpenClaw'
                  : 'Import'}
          </Button>
          <label className="m-0 inline-flex cursor-pointer items-center gap-1 text-sm text-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <span>Overwrite existing</span>
            <span className="text-muted-foreground">and confirm scan findings</span>
          </label>
        </div>
      </form>
    </SectionCard>
  )
}

function FindingSummary({ findings }: { findings: SkillScanFinding[] }) {
  if (findings.length === 0) return <StatusBadge variant="success">Clean</StatusBadge>
  const danger = findings.some((f) => f.severity === 'danger')
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none">
        <StatusBadge variant={danger ? 'danger' : 'warning'}>
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </StatusBadge>
      </summary>
      <div className="mt-2 min-w-64">
        <FindingList findings={findings} />
      </div>
    </details>
  )
}

function FindingList({ findings }: { findings: SkillScanFinding[] }) {
  return (
    <ul className="m-0 space-y-1.5 pl-0">
      {findings.map((f, i) => (
        <li key={`${f.code}-${f.line ?? 0}-${i}`} className="flex items-start gap-2">
          <StatusBadge variant={f.severity === 'danger' ? 'danger' : 'warning'}>
            {f.severity === 'danger' ? 'Danger' : 'Warning'}
          </StatusBadge>
          <span>
            <code>{f.code}</code>
            {f.line ? `, line ${f.line}` : ''} — {f.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

function flattenImportFindings(
  findings: ImportSkillsResponse['findings'] | undefined,
): SkillScanFinding[] {
  if (!findings) return []
  return Object.entries(findings).flatMap(([name, items]) =>
    items.map((item) => ({ ...item, message: `${name}: ${item.message}` })),
  )
}

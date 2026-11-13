import type { ImportSkillsResponse, SkillInfo, SkillScanFinding } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  EmptyState,
  ItemList,
  ItemRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
} from '../../components/Page'
import { FindingList, FindingSummary } from '../../components/SkillFindings'
import { Tabs } from '../../components/Tabs'
import { ApiError, api, errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

const fetchSkills = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<SkillInfo[]>('/api/skills'),
)

export const Route = createFileRoute('/skills/')({
  loader: () => fetchSkills(),
  component: SkillsPage,
})

function SkillsPage() {
  const skills = Route.useLoaderData()
  const router = useRouter()
  const [removeTarget, setRemoveTarget] = useState<SkillInfo | null>(null)

  return (
    <PageShell size="wide">
      <PageHeader
        title="Skills"
        description="Install and review the prompt-only skills available to your agents."
      />
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
          <ItemList>
            {skills.map((skill) => (
              <ItemRow
                key={skill.name}
                title={<code>{skill.name}</code>}
                meta={
                  <>
                    <FindingSummary findings={skill.scanFindings ?? []} />
                    <span className="font-mono">{skill.source ?? 'unknown source'}</span>
                    {skill.importedAt && (
                      <span>imported {new Date(skill.importedAt).toLocaleDateString()}</span>
                    )}
                  </>
                }
                actions={
                  <Button variant="danger" onClick={() => setRemoveTarget(skill)}>
                    Remove
                  </Button>
                }
              >
                {skill.parseError ? (
                  <p className="mb-0 mt-1 flex items-start gap-2 text-sm">
                    <StatusBadge variant="danger">Parse error</StatusBadge>
                    <span className="text-destructive">{skill.parseError}</span>
                  </p>
                ) : (
                  skill.description && <p className="mb-0 mt-1 text-sm">{skill.description}</p>
                )}
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SectionCard>
      <ConfirmDialog
        open={removeTarget !== null}
        title={`Remove skill ${removeTarget?.name ?? ''}?`}
        description={
          <p>
            This permanently deletes the installed <code className="font-mono">SKILL.md</code> and
            every script and asset in the <code className="font-mono">{removeTarget?.name}</code>{' '}
            directory. No Agent or Agent template can use the skill until it is imported again.
          </p>
        }
        confirmLabel="Delete installed skill"
        onConfirm={async () => {
          if (!removeTarget) return
          await api(`/api/skills/${encodeURIComponent(removeTarget.name)}`, { method: 'DELETE' })
          await router.invalidate()
        }}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      />
    </PageShell>
  )
}

type Source = 'openclaw' | 'path' | 'zip'

function ImportCard({ onImported }: { onImported: () => void }) {
  const [source, setSource] = useState<Source>('openclaw')
  const [path, setPath] = useState('')
  const [force, setForce] = useState(false)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [findings, setFindings] = useState<SkillScanFinding[]>([])
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFindings([])
    let body: unknown
    if (source === 'zip') {
      if (!zipFile) {
        setError('Choose a ZIP file first.')
        return
      }
      const form = new FormData()
      form.set('file', zipFile)
      if (force) form.set('force', 'true')
      body = form
    } else {
      body = { source: source === 'openclaw' ? 'openclaw' : path.trim(), force }
    }
    setSubmitting(true)
    try {
      const imported = await api<ImportSkillsResponse>('/api/skills/import', { body })
      setFindings(
        Object.entries(imported.findings ?? {}).flatMap(([name, items]) =>
          items.map((item) => ({ ...item, message: `${name}: ${item.message}` })),
        ),
      )
      setPath('')
      setZipFile(null)
      onImported()
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFindings((cause.body as { findings?: SkillScanFinding[] }).findings ?? [])
      }
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  function chooseZip(file: File | undefined) {
    if (!file) return
    if (!/\.zip$/i.test(file.name)) {
      setError('Only ZIP archives are supported.')
      return
    }
    setZipFile(file)
  }

  return (
    <SectionCard
      title="Import skills"
      description={
        <>
          Each skill's <code>SKILL.md</code> body is added to the system prompt of every agent it is
          attached to.
        </>
      }
    >
      <Tabs
        items={[
          { id: 'openclaw', label: 'OpenClaw' },
          { id: 'path', label: 'Server directory' },
          { id: 'zip', label: 'Upload ZIP' },
        ]}
        active={source}
        onChange={(next) => {
          setSource(next)
          setError(null)
        }}
      />

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {findings.length > 0 && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <StatusBadge
            variant={
              findings.some((finding) => finding.severity === 'danger') ? 'danger' : 'warning'
            }
            className="mb-2"
          >
            Scan findings
          </StatusBadge>
          <FindingList findings={findings} />
        </div>
      )}

      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {source === 'openclaw' && (
          <p className="text-sm leading-6 text-muted-foreground">
            Imports every skill in <code>~/.openclaw/skills</code> on the server.
          </p>
        )}
        {source === 'path' && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              An absolute path on the server: one skill folder (with a <code>SKILL.md</code>) or a
              folder of skill folders.
            </p>
            <label className="max-w-2xl">
              Server path
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/home/you/my-skills"
                required
              />
            </label>
          </>
        )}
        {source === 'zip' && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              A <code>.zip</code> archive with one folder per skill at its top level; the folder
              name becomes the skill name.
            </p>
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
              className={`relative block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragOver
                  ? 'border-primary bg-accent text-accent-foreground'
                  : zipFile
                    ? 'border-solid border-primary/40 bg-card text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-primary hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => chooseZip(event.target.files?.[0])}
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
              : source === 'zip'
                ? 'Upload and import'
                : source === 'openclaw'
                  ? 'Import from OpenClaw'
                  : 'Import'}
          </Button>
          <label className="m-0 inline-flex cursor-pointer items-center gap-1 text-sm text-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
            />
            <span>Overwrite existing</span>
            <span className="text-muted-foreground">and accept scan findings</span>
          </label>
        </div>
      </form>
    </SectionCard>
  )
}

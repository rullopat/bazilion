import type { ImportSkillsResponse, SkillInfo, SkillScanFinding } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { type ChangeEvent, type DragEvent, useRef, useState } from 'react'
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

  async function remove(name: string) {
    if (!confirm(`remove skill "${name}"? this deletes the directory on disk.`)) return
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      alert(res.statusText)
      return
    }
    await router.invalidate()
  }

  return (
    <div>
      <h1>skills</h1>
      <ImportCard onImported={() => router.invalidate()} />

      <table>
        <thead>
          <tr>
            <th>name</th>
            <th>description</th>
            <th>scan</th>
            <th>source</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {skills.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                no skills installed yet
              </td>
            </tr>
          )}
          {skills.map((s) => (
            <tr key={s.name}>
              <td>
                <code>{s.name}</code>
              </td>
              <td>
                {s.parseError ? (
                  <span className="text-[#9B3D3D]">parse error: {s.parseError}</span>
                ) : (
                  s.description
                )}
              </td>
              <td>
                <FindingSummary findings={s.scanFindings ?? []} />
              </td>
              <td className="text-[0.78em] text-mocha-light">
                <span className="font-mono">{s.source ?? '(unknown)'}</span>
                {s.importedAt && (
                  <div className="font-mono">
                    {new Date(s.importedAt).toLocaleDateString()}
                  </div>
                )}
              </td>
              <td>
                <button type="button" className="ghost-btn" onClick={() => remove(s.name)}>
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          setErr('choose a .zip file first')
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
            setErr('fill in the server path')
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
      setErr('only .zip archives are supported')
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

  return (
    <section className="card">
      <h3 className="mb-1">import skills</h3>
      <p className="muted mb-3 text-[0.88em]">
        pick a source. Each skill's <code>SKILL.md</code> body is injected into the system
        prompt of any agent it's attached to.
      </p>

      <div
        role="tablist"
        className="mb-4 inline-flex gap-0 rounded-md border border-frost bg-ivory p-1"
      >
        {[
          { id: 'openclaw' as const, label: 'OpenClaw' },
          { id: 'path' as const, label: 'server directory' },
          { id: 'zip' as const, label: 'upload zip' },
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
            className={`unstyled cursor-pointer rounded-sm border-none bg-transparent px-3 py-1.5 text-[0.88em] font-medium transition-colors ${
              tab === it.id
                ? 'bg-snow text-sapphire-deep shadow-baziu-sm'
                : 'text-mocha hover:text-sapphire'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {err && <div className="err">{err}</div>}
      {findings.length > 0 && (
        <div className="mb-3 rounded-md border border-[#D7A3A3] bg-[#FFF7F5] p-3 text-[0.86em] text-[#7C2D2D]">
          <div className="mb-1 font-semibold">scan findings</div>
          <FindingList findings={findings} />
        </div>
      )}

      <form onSubmit={submit}>
        {tab === 'openclaw' && (
          <p className="text-[0.92em] text-mocha">
            One-click import of every skill found in <code>~/.openclaw/skills</code> on the
            server.
          </p>
        )}
        {tab === 'path' && (
          <>
            <p className="text-[0.92em] text-mocha">
              Import from an absolute path on the server — either a single skill folder
              (contains <code>SKILL.md</code>) or a parent folder holding many skill subfolders.
            </p>
            <label>
              server path
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
            <p className="text-[0.92em] text-mocha">
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
              className={`block cursor-pointer rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                dragOver
                  ? 'border-sapphire bg-sapphire-glow text-sapphire-deep'
                  : zipFile
                    ? 'border-solid border-sapphire-light bg-snow text-chocolate'
                    : 'border-frost bg-ivory text-mocha-light hover:border-sapphire hover:bg-sapphire-glow hover:text-sapphire-deep'
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
                <span className="block break-all font-mono text-[0.85em] text-sapphire-deep">
                  {zipFile.name}
                </span>
              ) : (
                <>
                  <span className="block text-[0.95em] font-medium text-mocha">
                    click to choose a .zip file
                  </span>
                  <span className="text-[0.82em]">or drag &amp; drop here</span>
                </>
              )}
            </label>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting}>
            {submitting
              ? 'importing…'
              : tab === 'zip'
                ? 'upload & import'
                : tab === 'openclaw'
                  ? 'import from OpenClaw'
                  : 'import'}
          </button>
          <label className="m-0 inline-flex cursor-pointer items-center text-[0.88em] text-mocha">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            overwrite existing
            <span className="ml-1 text-mocha-light">/ confirm scan findings</span>
          </label>
        </div>
      </form>
    </section>
  )
}

function FindingSummary({ findings }: { findings: SkillScanFinding[] }) {
  if (findings.length === 0) return <span className="text-mocha-light">clean</span>
  const danger = findings.some((f) => f.severity === 'danger')
  return (
    <details className="text-[0.82em]">
      <summary className={danger ? 'cursor-pointer text-[#9B3D3D]' : 'cursor-pointer text-mocha'}>
        {findings.length} finding{findings.length === 1 ? '' : 's'}
      </summary>
      <FindingList findings={findings} />
    </details>
  )
}

function FindingList({ findings }: { findings: SkillScanFinding[] }) {
  return (
    <ul className="m-0 list-disc pl-4">
      {findings.map((f, i) => (
        <li key={`${f.code}-${f.line ?? 0}-${i}`}>
          <span className="font-mono">{f.severity}</span>: {f.code}
          {f.line ? ` line ${f.line}` : ''} - {f.message}
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

import type { SkillInfo } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { ItemList, ItemRow, StatusBadge } from './Page'
import { FindingList, FindingSummary } from './SkillFindings'

/** Attach and detach installed skills for one Agent; scan findings need confirmation. */
export function AgentSkills({
  agentId,
  attached,
  all,
}: {
  agentId: string
  attached: Set<string>
  all: SkillInfo[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [risky, setRisky] = useState<SkillInfo | null>(null)
  const [detaching, setDetaching] = useState<string | null>(null)
  const base = `/api/agents/${encodeURIComponent(agentId)}/skills`

  async function change(name: string, request: () => Promise<unknown>) {
    setPending(name)
    setError(null)
    try {
      await request()
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setPending(null)
    }
  }

  const attach = (skill: SkillInfo) =>
    change(skill.name, () =>
      api(base, {
        body: { skill: skill.name, allowFindings: (skill.scanFindings ?? []).length > 0 },
      }),
    )
  const detach = (name: string) =>
    change(name, () => api(`${base}/${encodeURIComponent(name)}`, { method: 'DELETE' }))

  if (all.length === 0) return <p className="text-[0.9em] text-mocha-light">No skills installed.</p>
  return (
    <>
      {error && (
        <p role="alert" className="mb-2 text-[0.85em] text-danger">
          {error}
        </p>
      )}
      <ItemList>
        {all.map((skill) => {
          const isAttached = attached.has(skill.name)
          const busy = pending === skill.name
          const findings = skill.scanFindings ?? []
          return (
            <ItemRow
              key={skill.name}
              title={<code>{skill.name}</code>}
              meta={
                <>
                  <StatusBadge variant={isAttached ? 'success' : 'neutral'}>
                    {isAttached ? 'Attached' : 'Available'}
                  </StatusBadge>
                  <span>{skill.description || 'No description.'}</span>
                  <FindingSummary findings={findings} />
                </>
              }
              actions={
                isAttached ? (
                  <Button variant="ghost" disabled={busy} onClick={() => setDetaching(skill.name)}>
                    {busy ? 'Detaching…' : 'Detach'}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      findings.length > 0 ? setRisky(skill) : void attach(skill).catch(() => {})
                    }
                  >
                    {busy ? 'Attaching…' : 'Attach'}
                  </Button>
                )
              }
            />
          )
        })}
      </ItemList>
      <ConfirmDialog
        open={risky !== null}
        onOpenChange={(open) => {
          if (!open) setRisky(null)
        }}
        title={`Attach ${risky?.name ?? 'skill'} despite scan findings?`}
        description={
          <div className="space-y-2">
            <p>
              Static scanning found {risky?.scanFindings?.length ?? 0} potentially unsafe
              instruction{risky?.scanFindings?.length === 1 ? '' : 's'}. Review them before allowing
              this skill into the Agent's prompt.
            </p>
            <FindingList findings={risky?.scanFindings ?? []} />
          </div>
        }
        confirmLabel="Attach despite findings"
        onConfirm={async () => {
          if (risky) await attach(risky)
        }}
      />
      <ConfirmDialog
        open={detaching !== null}
        onOpenChange={(open) => {
          if (!open) setDetaching(null)
        }}
        title={`Detach ${detaching ?? 'skill'}?`}
        description={
          <p>
            This removes the skill's instructions from this Agent's future turns. It does not
            uninstall the skill, and you can attach it again later.
          </p>
        }
        confirmLabel="Detach skill"
        onConfirm={async () => {
          if (detaching) await detach(detaching)
        }}
      />
    </>
  )
}

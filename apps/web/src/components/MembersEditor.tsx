import type { Profile, ReasoningLevel } from '@bazilion/api-types'
import { REASONING_LEVELS } from '../lib/wire-constants'

export interface MemberDraft {
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
}

export interface ModelGroup {
  provider: string
  models: string[]
}

interface MembersEditorProps {
  members: MemberDraft[]
  onChange: (members: MemberDraft[]) => void
  profiles: Profile[]
  modelGroups: ModelGroup[]
  /** Optional message rendered when the list is empty. */
  emptyHint?: string
}

// Controlled member editor — used on both the create form and the detail
// page. Parent owns the member array; this component handles row edits,
// reorders, add, and remove, then notifies via onChange.
export function MembersEditor({
  members,
  onChange,
  profiles,
  modelGroups,
  emptyHint = 'No members yet. Add one to define your first team member.',
}: MembersEditorProps) {
  function update(i: number, patch: Partial<MemberDraft>) {
    onChange(members.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }

  function move(i: number, delta: -1 | 1) {
    const j = i + delta
    if (j < 0 || j >= members.length) return
    const next = [...members]
    const tmp = next[i]
    const swap = next[j]
    if (!tmp || !swap) return
    next[i] = swap
    next[j] = tmp
    onChange(next)
  }

  function removeMember(i: number) {
    onChange(members.filter((_, idx) => idx !== i))
  }

  function addMember() {
    const firstProfile = profiles[0]
    if (!firstProfile) return
    onChange([
      ...members,
      {
        profileId: firstProfile.id,
        agentName: 'agent',
        modelOverride: null,
        reasoningLevel: null,
      },
    ])
  }

  if (profiles.length === 0) {
    return (
      <p className="muted">
        Create a profile first under <a href="/profiles">/profiles</a> — members reference
        existing profiles.
      </p>
    )
  }

  return (
    <>
      {members.length === 0 ? (
        <p className="muted">{emptyHint}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>profile</th>
              <th>agent name</th>
              <th>model override</th>
              <th>reasoning</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are addressed by position; the index IS the key.
              <tr key={i}>
                <td>{i}</td>
                <td>
                  <select
                    value={m.profileId}
                    onChange={(e) => update(i, { profileId: e.target.value })}
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={m.agentName}
                    onChange={(e) => update(i, { agentName: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={m.modelOverride ?? ''}
                    onChange={(e) =>
                      update(i, { modelOverride: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">(use profile default)</option>
                    {modelGroups.map((g) => (
                      <optgroup key={g.provider} label={g.provider}>
                        {g.models.map((mm) => (
                          <option key={mm} value={`${g.provider}:${mm}`}>
                            {`${g.provider}:${mm}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={m.reasoningLevel ?? ''}
                    onChange={(e) =>
                      update(i, {
                        reasoningLevel:
                          e.target.value === '' ? null : (e.target.value as ReasoningLevel),
                      })
                    }
                  >
                    <option value="">(default: medium)</option>
                    {REASONING_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="flex gap-1">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === members.length - 1}
                    title="move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => removeMember(i)}
                    title="remove member"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3">
        <button type="button" className="ghost-btn" onClick={addMember}>
          + add member
        </button>
      </div>
    </>
  )
}

import type { Profile, ReasoningLevel } from '@bazilion/api-types'
import { REASONING_LEVELS } from '../lib/wire-constants'

export interface SlotDraft {
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
}

export interface ModelGroup {
  provider: string
  models: string[]
}

interface SlotsEditorProps {
  slots: SlotDraft[]
  onChange: (slots: SlotDraft[]) => void
  profiles: Profile[]
  modelGroups: ModelGroup[]
  /** Optional heading rendered above the table. */
  emptyHint?: string
}

// Controlled slot editor — used on both the create form and the detail
// page. Parent owns the slot array; this component handles row edits,
// reorders, add, and remove, then notifies via onChange.
export function SlotsEditor({
  slots,
  onChange,
  profiles,
  modelGroups,
  emptyHint = 'No slots yet. Add one to define your first team member.',
}: SlotsEditorProps) {
  function update(i: number, patch: Partial<SlotDraft>) {
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function move(i: number, delta: -1 | 1) {
    const j = i + delta
    if (j < 0 || j >= slots.length) return
    const next = [...slots]
    const tmp = next[i]
    const swap = next[j]
    if (!tmp || !swap) return
    next[i] = swap
    next[j] = tmp
    onChange(next)
  }

  function removeSlot(i: number) {
    onChange(slots.filter((_, idx) => idx !== i))
  }

  function addSlot() {
    const firstProfile = profiles[0]
    if (!firstProfile) return
    onChange([
      ...slots,
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
        Create a profile first under <a href="/profiles">/profiles</a> — slots reference
        existing profiles.
      </p>
    )
  }

  return (
    <>
      {slots.length === 0 ? (
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
            {slots.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are addressed by position; the index IS the key.
              <tr key={i}>
                <td>{i}</td>
                <td>
                  <select
                    value={s.profileId}
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
                    value={s.agentName}
                    onChange={(e) => update(i, { agentName: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={s.modelOverride ?? ''}
                    onChange={(e) =>
                      update(i, { modelOverride: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">(use profile default)</option>
                    {modelGroups.map((g) => (
                      <optgroup key={g.provider} label={g.provider}>
                        {g.models.map((m) => (
                          <option key={m} value={`${g.provider}:${m}`}>
                            {`${g.provider}:${m}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={s.reasoningLevel ?? ''}
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
                    disabled={i === slots.length - 1}
                    title="move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => removeSlot(i)}
                    title="delete slot"
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
        <button type="button" className="ghost-btn" onClick={addSlot}>
          + add slot
        </button>
      </div>
    </>
  )
}

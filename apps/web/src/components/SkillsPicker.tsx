import type { SkillInfo, SkillsMode } from '@bazilion/api-types'

/** Which skills an Agent template attaches at spawn: every installed skill, or the ticked ones. */
export function SkillsPicker({
  mode,
  onModeChange,
  picked,
  onPickedChange,
  skills,
}: {
  mode: SkillsMode
  onModeChange: (mode: SkillsMode) => void
  picked: Set<string>
  onPickedChange: (picked: Set<string>) => void
  skills: SkillInfo[]
}) {
  function toggle(name: string) {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onPickedChange(next)
  }

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Skills at spawn</legend>
      <label className="my-2 flex cursor-pointer items-start gap-2">
        <input type="radio" checked={mode === 'all'} onChange={() => onModeChange('all')} />
        <span>
          <strong>All skills</strong>: every installed skill is attached at spawn.
        </span>
      </label>
      <label className="my-2 flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          checked={mode === 'selected'}
          onChange={() => onModeChange('selected')}
        />
        <span>
          <strong>Selected skills</strong>: only the ones ticked below.
        </span>
      </label>
      <div
        className={`mt-3 max-h-[22rem] overflow-y-auto rounded-md border border-frost p-3 ${mode === 'all' ? 'pointer-events-none opacity-50' : ''}`}
      >
        {skills.length === 0 ? (
          <p className="muted">
            No skills installed yet. Import some on <a href="/skills">Skills</a>.
          </p>
        ) : (
          skills.map((skill) => (
            <label key={skill.name} className="my-1.5 flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={picked.has(skill.name)}
                disabled={mode === 'all'}
                onChange={() => toggle(skill.name)}
              />
              <span>
                <code>{skill.name}</code>
                {skill.description && (
                  <span className="text-[0.9em] text-mocha-light"> — {skill.description}</span>
                )}
              </span>
            </label>
          ))
        )}
      </div>
      <p className="muted mt-2 text-[0.85em]">
        Each Agent can still attach or detach skills after it is spawned.
      </p>
    </fieldset>
  )
}

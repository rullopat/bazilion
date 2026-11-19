/** A small either-or switch: a row of options of which one is on. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ id: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-0 rounded-[12px] border border-border bg-card p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`unstyled h-7 whitespace-nowrap rounded-[9px] px-2.5 text-xs font-semibold ${
            value === option.id
              ? 'bg-accent text-accent-foreground'
              : 'text-mocha hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}

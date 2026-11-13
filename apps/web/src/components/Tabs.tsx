/** In-page tabs that switch between panels of one form or page. */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
}: {
  items: { id: T; label: string; disabled?: boolean }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-1 border-b border-frost">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          className={`unstyled -mb-px border-b-2 bg-transparent px-4 py-2 text-[0.9em] font-medium transition-colors ${
            item.disabled
              ? 'cursor-not-allowed border-transparent text-mocha-light/40'
              : active === item.id
                ? 'cursor-pointer border-sapphire text-sapphire'
                : 'cursor-pointer border-transparent text-mocha hover:text-sapphire'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

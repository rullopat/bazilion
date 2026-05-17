interface PawIconProps {
  className?: string
}

export function PawIcon({ className }: PawIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <ellipse cx="7" cy="5" rx="2.2" ry="2.8" />
      <ellipse cx="17" cy="5" rx="2.2" ry="2.8" />
      <ellipse cx="3.5" cy="11" rx="2" ry="2.5" />
      <ellipse cx="20.5" cy="11" rx="2" ry="2.5" />
      <path d="M12 22c-4.5 0-7.5-3-7.5-6 0-3 2.5-5.5 4.5-7a4 4 0 0 1 6 0c2 1.5 4.5 4 4.5 7 0 3-3 6-7.5 6z" />
    </svg>
  )
}

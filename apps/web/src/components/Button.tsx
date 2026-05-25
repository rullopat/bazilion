// Shared button component. Every CTA in the app should use this instead of
// raw <button> so the variant decision can't be silently forgotten (which is
// what happened with the early "save members" button — it was a bare
// <button type="button"> with no className, so it fell through to Tailwind
// preflight and lost all styling).
//
// Variants map 1:1 to the CSS classes in styles.css — `btn-primary`,
// `ghost-btn`, `danger-btn`. The wrapper exists to make the choice mandatory
// via TS and to default `type="button"` (HTML's `submit` default has bitten
// us inside <form>s).
//
// Icon-only buttons and dropdown-menu items intentionally stay bare — they
// need transparent backgrounds and Tailwind preflight, which is exactly what
// raw <button type="button"> gives.

import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  ghost: 'ghost-btn',
  danger: 'danger-btn',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant
}

export function Button({ variant, type, className, ...rest }: Props) {
  const cls = className ? `${VARIANT_CLASS[variant]} ${className}` : VARIANT_CLASS[variant]
  return <button type={type ?? 'button'} className={cls} {...rest} />
}

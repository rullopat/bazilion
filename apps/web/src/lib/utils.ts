import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Scroll a strip of tabs sideways so its selected tab (`selector`) is in view, as on a phone
 * where the strip is wider than the screen. Only the strip moves, never the page.
 */
export function revealInStrip(strip: HTMLElement | null, selector: string): void {
  const item = strip?.querySelector<HTMLElement>(selector)
  if (!strip || !item) return
  const box = strip.getBoundingClientRect()
  const tab = item.getBoundingClientRect()
  if (tab.left < box.left) strip.scrollLeft -= box.left - tab.left + 8
  else if (tab.right > box.right) strip.scrollLeft += tab.right - box.right + 8
}

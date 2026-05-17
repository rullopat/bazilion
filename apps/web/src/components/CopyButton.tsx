// Tiny clipboard button used by the agent detail header (copies the full UUID
// for inter-agent messaging). Async clipboard API where available, transient
// <textarea> + execCommand fallback for http://127… contexts where Chromium
// blocks the async API. Flashes a green ✓ for ~1s on success.

import { useState } from 'react'

interface Props {
  value: string
  className?: string
  ariaLabel?: string
  title?: string
}

export function CopyButton({
  value,
  className,
  ariaLabel = 'Copy to clipboard',
  title = 'Copy to clipboard',
}: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!value) return
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        ok = true
      }
    } catch {
      // fall through
    }
    if (!ok) {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        ok = document.execCommand('copy')
      } catch {}
      ta.remove()
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    }
  }

  const base =
    'inline-flex h-[1.3rem] w-[1.6rem] items-center justify-center rounded-sm border border-transparent text-mocha-light transition-colors hover:border-frost hover:bg-snow hover:text-mocha'
  const success =
    'border-[#bcd9bc] bg-[#eef7ee] text-[#3b7a3b] hover:border-[#bcd9bc] hover:bg-[#eef7ee] hover:text-[#3b7a3b]'
  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      aria-label={ariaLabel}
      className={`${base} ${copied ? success : ''} ${className ?? ''}`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

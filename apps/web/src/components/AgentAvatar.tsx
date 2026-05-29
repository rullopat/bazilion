// Renders an agent's avatar (parsed from IDENTITY.md) with an emoji fallback.
//
// Only http(s):// and data: URIs render as an <img> — workspace-relative paths
// (e.g. "avatars/me.png") need a static-file route that doesn't exist yet, so
// they're treated as "no avatar" and fall through to the emoji. Keep that rule
// in ONE place: every list/detail surface goes through here.

import type { AgentIdentityFile } from '@bazilion/api-types'

/** Whether an avatar string is something the browser can render directly. */
export function isRenderableAvatar(avatar: string | undefined): avatar is string {
  if (!avatar) return false
  return /^https?:\/\//i.test(avatar) || /^data:image\//i.test(avatar)
}

interface Props {
  identity?: AgentIdentityFile | null
  /** px size of the square avatar / emoji badge. */
  size?: number
  className?: string
}

export function AgentAvatar({ identity, size = 28, className }: Props) {
  const avatar = identity?.avatar
  const emoji = identity?.emoji
  const dim = { width: size, height: size }
  const base = 'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full'
  const cls = className ? `${base} ${className}` : base

  if (isRenderableAvatar(avatar)) {
    return (
      <img
        src={avatar}
        alt=""
        style={dim}
        className={`${cls} object-cover`}
        // A broken avatar URL shouldn't leave a busted image icon — hide it and
        // let the surrounding layout fall back to text.
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  return (
    <span
      style={{ ...dim, fontSize: Math.round(size * 0.6) }}
      className={`${cls} bg-frost leading-none`}
      aria-hidden
    >
      {emoji ?? '🤖'}
    </span>
  )
}

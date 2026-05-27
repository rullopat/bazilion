// In-memory state for the `/spawn` keyboard flow.
//
// Telegram delivers the user's profile-pick callback and the subsequent
// name-input message as two separate updates. Between them we need to
// remember "this user picked profile X and is about to type a name". The
// state lives in this module — per-process Map keyed on (chatId, userId)
// with a 60s TTL so a forgotten or abandoned spawn doesn't linger.
//
// Persistence is intentional: a daemon restart drops in-flight spawns
// silently. They were never confirmed by the user; better to ask again
// than to attribute a name typed afterwards to a flow the user has
// forgotten about.

const STATE_TTL_MS = 60_000

interface PendingSpawn {
  profileId: string
  expiresAt: number
}

const _pending = new Map<string, PendingSpawn>()

function key(chatId: number, userId: number): string {
  return `${chatId}:${userId}`
}

/** Register a pending spawn for the given user. Overwrites any prior pending. */
export function setPendingSpawn(chatId: number, userId: number, profileId: string): void {
  _pending.set(key(chatId, userId), {
    profileId,
    expiresAt: Date.now() + STATE_TTL_MS,
  })
}

/**
 * Read and remove pending spawn for the user. Returns null when no pending
 * exists or when the prior entry expired (also clears expired entries as a
 * side effect).
 */
export function takePendingSpawn(chatId: number, userId: number): { profileId: string } | null {
  const k = key(chatId, userId)
  const entry = _pending.get(k)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    _pending.delete(k)
    return null
  }
  _pending.delete(k)
  return { profileId: entry.profileId }
}

/**
 * Peek without consuming — used by the help / debugging surfaces. Returns
 * null on expiry, mirroring takePendingSpawn semantics.
 */
export function peekPendingSpawn(chatId: number, userId: number): { profileId: string } | null {
  const entry = _pending.get(key(chatId, userId))
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    _pending.delete(key(chatId, userId))
    return null
  }
  return { profileId: entry.profileId }
}

/** Test-only — wipe the pending map between tests. */
export function _resetSpawnStateForTest(): void {
  _pending.clear()
}

/** Test-only — expose the configured TTL so tests can assert it. */
export const SPAWN_STATE_TTL_MS = STATE_TTL_MS

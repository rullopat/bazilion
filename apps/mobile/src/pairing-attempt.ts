export interface PairingAttemptSnapshot {
  busy: boolean
  lastRaw: string | null
  scanPaused: boolean
}

/**
 * Camera scanners report the same QR every frame. Only explicit button taps
 * may retry a failed value; camera/deep-link callbacks stay deduplicated.
 */
export function canStartPairingAttempt(
  raw: string,
  snapshot: PairingAttemptSnapshot,
  explicitRetry = false,
): boolean {
  const candidate = raw.trim()
  if (!candidate || snapshot.busy) return false
  if (explicitRetry) return true
  if (snapshot.scanPaused) return false
  return candidate !== snapshot.lastRaw
}

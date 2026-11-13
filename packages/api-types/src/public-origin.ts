// The origin the web gateway serves (BAZILION_PUBLIC_ORIGIN) and the cookie names that follow from
// it. The daemon and the gateway both read it here, so they always agree.

export interface PublicOriginConfig {
  /** The exact HTTPS origin, or null for loopback development. */
  origin: string | null
  production: boolean
  sessionCookie: '__Host-bz_session' | 'bz_session_dev'
  csrfCookie: '__Host-bz_csrf' | 'bz_csrf_dev'
}

/** The configuration for a BAZILION_PUBLIC_ORIGIN value; anything but an exact HTTPS origin throws. */
export function publicOriginConfig(raw: string | undefined): PublicOriginConfig {
  const value = raw?.trim()
  if (!value) {
    return {
      origin: null,
      production: false,
      sessionCookie: 'bz_session_dev',
      csrfCookie: 'bz_csrf_dev',
    }
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('BAZILION_PUBLIC_ORIGIN must be an exact HTTPS origin')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value.replace(/\/$/, '')
  ) {
    throw new Error('BAZILION_PUBLIC_ORIGIN must be an exact HTTPS origin')
  }
  return {
    origin: url.origin,
    production: true,
    sessionCookie: '__Host-bz_session',
    csrfCookie: '__Host-bz_csrf',
  }
}

export function isLoopbackHost(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)
}

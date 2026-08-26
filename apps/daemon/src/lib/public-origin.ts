export interface PublicOriginConfig {
  origin: string | null
  production: boolean
  sessionCookie: '__Host-bz_session' | 'bz_session_dev'
  csrfCookie: '__Host-bz_csrf' | 'bz_csrf_dev'
}

export function resolvePublicOrigin(env: NodeJS.ProcessEnv = process.env): PublicOriginConfig {
  const raw = env.BAZILION_PUBLIC_ORIGIN?.trim()
  if (!raw) {
    return {
      origin: null,
      production: false,
      sessionCookie: 'bz_session_dev',
      csrfCookie: 'bz_csrf_dev',
    }
  }
  let url: URL
  try {
    url = new URL(raw)
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
    url.origin !== raw.replace(/\/$/, '')
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
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

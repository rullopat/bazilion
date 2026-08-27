export interface ParsedPairing {
  server: string
  token: string
}

export class PairUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PairUrlError'
  }
}

/**
 * Parse a `bazilion://pair?server=<url>&token=<t>` URL emitted by
 * `bazilion token create --qr`. The scheme and host are both mandatory so a
 * stray http(s) URL or a typo surfaces as a clear error instead of a
 * confusing downstream network failure.
 */
export function parsePairingUrl(raw: string): ParsedPairing {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PairUrlError(`not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'bazilion:') {
    throw new PairUrlError(`expected bazilion:// scheme, got ${url.protocol}`)
  }
  // Custom-scheme URLs parse `pair` as the hostname, not pathname.
  if (url.hostname !== 'pair') {
    throw new PairUrlError(`expected bazilion://pair, got bazilion://${url.hostname}`)
  }
  const server = url.searchParams.get('server')
  const token = url.searchParams.get('token')
  if (!server) throw new PairUrlError('missing ?server=')
  if (!token) throw new PairUrlError('missing ?token=')
  try {
    const serverUrl = new URL(server)
    const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(serverUrl.hostname)
    if (serverUrl.protocol !== 'https:' && !(serverUrl.protocol === 'http:' && loopback)) {
      throw new PairUrlError('server must use HTTPS (HTTP is allowed only for loopback development)')
    }
    if (
      serverUrl.username ||
      serverUrl.password ||
      serverUrl.pathname !== '/' ||
      serverUrl.search ||
      serverUrl.hash
    ) {
      throw new PairUrlError('server must be an exact origin without credentials, path, query, or fragment')
    }
  } catch (err) {
    if (err instanceof PairUrlError) throw err
    throw new PairUrlError(`server is not a valid URL: ${server}`)
  }
  // Strip trailing slash so `${server}${path}` never produces `//`.
  return { server: new URL(server).origin, token }
}

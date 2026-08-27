function cookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`
  for (const part of document.cookie.split(';')) {
    const value = part.trim()
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length))
  }
  return null
}

export function installCsrfFetch(): void {
  if (typeof window === 'undefined') return
  const marker = '__bazilionCsrfFetchInstalled'
  const state = window as typeof window & Record<string, unknown>
  if (state[marker]) return
  state[marker] = true
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const url = new URL(request?.url ?? String(input), window.location.href)
    if (url.origin !== window.location.origin || ['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return original(input, init)
    }
    const csrf = cookie('__Host-bz_csrf') ?? cookie('bz_csrf_dev')
    if (!csrf) return original(input, init)
    const headers = new Headers(request?.headers ?? undefined)
    for (const [key, value] of new Headers(init?.headers)) headers.set(key, value)
    headers.set('x-bazilion-csrf', csrf)
    return original(input, { ...init, headers })
  }
}

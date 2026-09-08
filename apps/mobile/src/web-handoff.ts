/** Open only the paired server's exact origin, without carrying a device credential. */
export function questionWebHandoff(server: string, agentId: string): string | null {
  try {
    const url = new URL(server)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(agentId)) return null
    return `${url.origin}/agents/${encodeURIComponent(agentId)}`
  } catch { return null }
}

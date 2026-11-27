// What every media provider call shares: the provider's own reason for a refusal, whatever shape
// its error body has, and waiting between looks at a job that runs on the provider's side.

export type Fetch = typeof fetch

/** The words a provider's error body gives, from the shapes the media providers use. */
export function errorReason(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, unknown>
  // OpenAI, Groq, Gemini, xAI and MiniMax v2: { error: { message } } (or a bare string).
  const error = record.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  // ElevenLabs: { detail: { message } } or { detail: [{ msg }] }.
  const detail = record.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail))
    return detail
      .map((entry) => (entry as Record<string, unknown> | null)?.msg)
      .filter((message): message is string => typeof message === 'string')
      .join('; ')
  if (detail && typeof detail === 'object') {
    const message = (detail as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  // MiniMax v1: { base_resp: { status_msg } }; Mistral: { message }.
  const base = record.base_resp as Record<string, unknown> | undefined
  if (base && typeof base.status_msg === 'string') return base.status_msg
  if (typeof record.message === 'string') return record.message
  return ''
}

/** Throw with the status and the provider's reason when `response` is not a success. */
export async function requireOk(response: Response, what: string): Promise<void> {
  if (response.ok) return
  const text = await response.text().catch(() => '')
  let reason = ''
  try {
    reason = errorReason(JSON.parse(text))
  } catch {
    reason = text.slice(0, 300)
  }
  throw new Error(`${what} answered ${response.status}${reason ? `: ${reason}` : ''}`)
}

/** The JSON body of a successful response. */
export async function okJson<T>(response: Response, what: string): Promise<T> {
  await requireOk(response, what)
  return (await response.json()) as T
}

/** The bytes of a successful response. */
export async function okBytes(response: Response, what: string): Promise<Buffer> {
  await requireOk(response, what)
  return Buffer.from(await response.arrayBuffer())
}

/** Wait `ms`, or stop at once when `signal` aborts. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    timer.unref?.()
    const stop = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', stop, { once: true })
  })
}

/** What a media file's first bytes say it is; null when none of these. */
export function mediaType(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  const ascii = (from: number, to: number) =>
    Buffer.from(bytes.subarray(from, to)).toString('latin1')
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    return brand.startsWith('M4A')
      ? { mimeType: 'audio/mp4', extension: 'm4a' }
      : { mimeType: 'video/mp4', extension: 'mp4' }
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return { mimeType: 'video/webm', extension: 'webm' }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
    return { mimeType: 'audio/wav', extension: 'wav' }
  if (ascii(0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' }
  if (ascii(0, 4) === 'fLaC') return { mimeType: 'audio/flac', extension: 'flac' }
  // MP3: an ID3 tag, or an MPEG audio frame sync.
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    return { mimeType: 'audio/mpeg', extension: 'mp3' }
  return null
}

/**
 * Raw 16-bit little-endian PCM as a WAV file: some speech models answer with samples and no
 * header. `rate` and `channels` are what the provider documents for that answer.
 */
export function wavFromPcm(pcm: Buffer, rate: number, channels: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

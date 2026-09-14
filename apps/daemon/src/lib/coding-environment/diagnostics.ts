export const CODING_OUTPUT_BYTES = 64 * 1024
/** BAZ-041: how much diagnostic text Bazilion retains for a single command. */
export const CODING_RETAINED_BYTES = 2 * 1024 * 1024
/** BAZ-041: cumulative live tail shipped per chat progress update. */
export const CODING_LIVE_BYTES = 8 * 1024

/** A UTF-8 tail with no partial leading codepoint. */
export function diagnosticTail(value: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value)
  if (bytes.length <= limit) return { text: value, truncated: false }
  let offset = bytes.length - limit
  while (offset < bytes.length && ((bytes[offset] ?? 0) & 0xc0) === 0x80) offset++
  return { text: bytes.subarray(offset).toString('utf8'), truncated: true }
}

/** Redacts across arbitrary output chunks before a byte reaches retained diagnostics. */
export class CodingDiagnostics {
  private readonly decoder = new TextDecoder()
  private readonly secrets: string[]
  private readonly lookbehind: number
  private readonly retainBytes: number
  private pending = ''
  private text = ''
  private truncated = false
  private observedBytes = 0
  private redactions = 0
  private finished = false

  constructor(secrets: readonly string[], retainBytes = CODING_OUTPUT_BYTES) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)
    this.lookbehind = Math.max(1, ...this.secrets.map((secret) => secret.length)) - 1
    this.retainBytes = retainBytes
  }

  append(bytes: Uint8Array): void {
    if (this.finished) throw new Error('Coding diagnostics already finalized')
    this.observedBytes += bytes.length
    // Bound temporary decoded strings even if a producer supplies one enormous chunk.
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      this.pending += this.decoder.decode(bytes.subarray(offset, offset + 8192), { stream: true })
      this.flush(false)
    }
  }

  /**
   * Redacted cumulative tail for a live update. Unlike `finish()` this does not seal
   * the diagnostics: more output may follow. It deliberately excludes the trailing
   * lookbehind bytes so a credential split across chunks cannot leak before the next
   * chunk resolves it.
   */
  preview(limit = CODING_LIVE_BYTES): { text: string; truncated: boolean } {
    return diagnosticTail(this.text, limit)
  }

  finish(): {
    diagnostic: string
    truncated: boolean
    /** Bytes observed before retention, which stops at `retainBytes`. */
    observedBytes: number
    /** True when at least one known credential was rewritten. */
    redacted: boolean
  } {
    if (!this.finished) {
      this.pending += this.decoder.decode()
      this.flush(true)
      this.finished = true
    }
    return {
      diagnostic: this.text,
      truncated: this.truncated,
      observedBytes: this.observedBytes,
      redacted: this.redactions > 0,
    }
  }

  private flush(final: boolean): void {
    let end = final ? this.pending.length : Math.max(0, this.pending.length - this.lookbehind)
    // Keep a UTF-16 pair together before converting the retained tail back to UTF-8.
    const last = this.pending.charCodeAt(end - 1)
    if (!final && last >= 0xd800 && last <= 0xdbff) end--
    let offset = 0
    let safe = ''
    while (offset < end) {
      const secret = this.secrets.find((value) => this.pending.startsWith(value, offset))
      if (secret) {
        safe += '[redacted]'
        this.redactions++
        offset += secret.length
      } else {
        const code = this.pending.charCodeAt(offset)
        const char = this.pending[offset] ?? ''
        safe +=
          (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159)
            ? `\\u${code.toString(16).padStart(4, '0')}`
            : char
        offset++
      }
    }
    this.pending = this.pending.slice(offset)
    const tail = diagnosticTail(this.text + safe, this.retainBytes)
    this.text = tail.text
    this.truncated ||= tail.truncated
  }
}

/** Include individual values in stored structured credentials, without retaining their keys. */
export function codingSecrets(env: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>()
  function collect(value: unknown, depth = 0) {
    if (depth > 8) return
    if (typeof value === 'string' && value.length >= 4) values.add(value)
    else if (value && typeof value === 'object')
      for (const entry of Object.values(value)) collect(entry, depth + 1)
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value || !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i.test(key)) continue
    values.add(value)
    try {
      collect(JSON.parse(value))
    } catch {
      /* Ordinary string credential. */
    }
  }
  return [...values]
}

import { describe, expect, it } from 'vitest'
import { PairUrlError, parsePairingUrl } from '../src/pair-url.ts'

describe('parsePairingUrl', () => {
  it('extracts server and token from a well-formed URL', () => {
    const r = parsePairingUrl('bazilion://pair?server=https%3A%2F%2Fserver.tailnet.ts.net&token=abc123')
    expect(r.server).toBe('https://server.tailnet.ts.net')
    expect(r.token).toBe('abc123')
  })

  it('strips a trailing slash on the server URL', () => {
    const r = parsePairingUrl('bazilion://pair?server=https%3A%2F%2Fhost%2F&token=t')
    expect(r.server).toBe('https://host')
  })

  it('accepts https servers', () => {
    const r = parsePairingUrl('bazilion://pair?server=https%3A%2F%2Fbazilion.example%2F&token=t')
    expect(r.server).toBe('https://bazilion.example')
  })

  it('rejects a non-bazilion scheme', () => {
    expect(() => parsePairingUrl('https://pair?server=X&token=Y')).toThrow(PairUrlError)
  })

  it('rejects a bazilion URL with the wrong host', () => {
    expect(() => parsePairingUrl('bazilion://unpair?server=X&token=Y')).toThrow(/bazilion:\/\/pair/)
  })

  it('rejects when ?server= is missing', () => {
    expect(() => parsePairingUrl('bazilion://pair?token=Y')).toThrow(/missing \?server/)
  })

  it('rejects when ?token= is missing', () => {
    expect(() => parsePairingUrl('bazilion://pair?server=http%3A%2F%2Fh')).toThrow(/missing \?token/)
  })

  it('rejects when the server URL uses a non-http(s) scheme', () => {
    expect(() => parsePairingUrl('bazilion://pair?server=ftp%3A%2F%2Fh&token=t')).toThrow(
      /HTTPS/,
    )
  })

  it('rejects insecure non-loopback and non-origin server URLs', () => {
    expect(() => parsePairingUrl('bazilion://pair?server=http%3A%2F%2F192.168.1.10&token=t')).toThrow(
      /HTTPS/,
    )
    expect(() => parsePairingUrl('bazilion://pair?server=https%3A%2F%2Fhost%2Fapi&token=t')).toThrow(
      /exact origin/,
    )
  })

  it('permits loopback HTTP development only', () => {
    expect(
      parsePairingUrl('bazilion://pair?server=http%3A%2F%2F127.0.0.1%3A4322&token=t').server,
    ).toBe('http://127.0.0.1:4322')
  })

  it('rejects a completely malformed input', () => {
    expect(() => parsePairingUrl('not a url')).toThrow(PairUrlError)
  })
})

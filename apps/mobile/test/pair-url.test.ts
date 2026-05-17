import { describe, expect, it } from 'vitest'
import { PairUrlError, parsePairingUrl } from '../src/pair-url.ts'

describe('parsePairingUrl', () => {
  it('extracts server and token from a well-formed URL', () => {
    const r = parsePairingUrl('bazilion://pair?server=http%3A%2F%2F192.168.1.10%3A4321&token=abc123')
    expect(r.server).toBe('http://192.168.1.10:4321')
    expect(r.token).toBe('abc123')
  })

  it('strips a trailing slash on the server URL', () => {
    const r = parsePairingUrl('bazilion://pair?server=http%3A%2F%2Fhost%3A4321%2F&token=t')
    expect(r.server).toBe('http://host:4321')
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
      /must be http/,
    )
  })

  it('rejects a completely malformed input', () => {
    expect(() => parsePairingUrl('not a url')).toThrow(PairUrlError)
  })
})

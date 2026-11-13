import { publicOriginConfig } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'

describe('publicOriginConfig', () => {
  test('uses bounded loopback development cookie names only when origin is unset', () => {
    expect(publicOriginConfig(undefined)).toEqual({
      origin: null,
      production: false,
      sessionCookie: 'bz_session_dev',
      csrfCookie: 'bz_csrf_dev',
    })
  })

  test('accepts one exact HTTPS origin and selects __Host cookies', () => {
    expect(publicOriginConfig('https://server.tailnet.ts.net')).toEqual({
      origin: 'https://server.tailnet.ts.net',
      production: true,
      sessionCookie: '__Host-bz_session',
      csrfCookie: '__Host-bz_csrf',
    })
  })

  test.each([
    'http://server.tailnet.ts.net',
    'https://user@server.tailnet.ts.net',
    'https://server.tailnet.ts.net/path',
    'https://server.tailnet.ts.net?query=1',
    'not a URL',
  ])('rejects an unsafe or non-origin production value: %s', (origin) => {
    expect(() => publicOriginConfig(origin)).toThrow(/exact HTTPS origin/)
  })
})

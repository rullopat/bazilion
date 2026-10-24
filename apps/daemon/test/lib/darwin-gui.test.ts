import { expect, test } from 'vitest'
import {
  classifyDarwinGraphicAccess,
  classifyDarwinGuiSession,
  probeDarwinGuiSession,
} from '../../src/lib/process/darwin-gui.ts'

test('caller audit-session graphic permission is required independently of console facts', () => {
  expect(classifyDarwinGraphicAccess(0, 0)).toBe('unavailable')
  expect(classifyDarwinGraphicAccess(0, 0x20)).toBe('unavailable')
  expect(classifyDarwinGraphicAccess(0, 0x10)).toBe('available')
  expect(classifyDarwinGraphicAccess(0, 0x30)).toBe('available')
  for (const [status, attributes] of [
    [1, 0],
    [null, 0],
    [0, -1],
    [0, 2 ** 32],
    [0, '16'],
    [0, undefined],
  ])
    expect(classifyDarwinGraphicAccess(status, attributes)).toBe('unsupported')
})

// Pure classification; native Quartz observation has its own actual-macOS case below.
test('Quartz GUI classification needs the current user, completed login and console evidence', () => {
  const session = { uid: 501, onConsole: true, loginDone: true }
  expect(classifyDarwinGuiSession(session, 501)).toBe('available')
  expect(classifyDarwinGuiSession(null, 501)).toBe('unavailable')
  expect(classifyDarwinGuiSession(session, 502)).toBe('unavailable')
  expect(classifyDarwinGuiSession({ ...session, onConsole: false }, 501)).toBe('unavailable')
  expect(classifyDarwinGuiSession({ ...session, loginDone: false }, 501)).toBe('unavailable')
})

test('unknown Quartz facts cannot be downgraded to a proven headless session', () => {
  for (const session of [
    undefined,
    {},
    { uid: 501, onConsole: 'yes', loginDone: true },
    { uid: -1, onConsole: true, loginDone: true },
    { uid: 2 ** 32, onConsole: true, loginDone: true },
    { uid: 501, onConsole: true },
  ])
    expect(classifyDarwinGuiSession(session, 501)).toBe('unsupported')
})

test.skipIf(process.platform !== 'darwin')(
  'actual public Quartz session APIs return typed GUI evidence',
  () => {
    const result = probeDarwinGuiSession()
    console.log(`actual Quartz GUI availability: ${result}; effective uid: ${process.geteuid?.()}`)
    expect(['available', 'unavailable']).toContain(result)
  },
)

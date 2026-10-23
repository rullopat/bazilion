import { expect, test } from 'vitest'
import {
  classifyDarwinGuiSession,
  probeDarwinGuiSession,
} from '../../src/lib/process/darwin-gui.ts'

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

import { expect, test } from 'vitest'
import {
  connectionNeedsSwitch,
  OUTSIDE,
  type PolicyDocument,
  switchAndConnect,
} from '../src/lib/team-policy'

const open: PolicyDocument = {
  kind: 'live',
  name: 'sales',
  userMd: null,
  mode: 'open',
  members: [],
  edges: [],
}

test('a teammate connection in an open Team asks to switch first; one to other Teams does not', () => {
  expect(connectionNeedsSwitch(open, 'sally', 'reachy', true)).toBe(true)
  expect(connectionNeedsSwitch(open, 'sally', OUTSIDE, true)).toBe(false)
  expect(connectionNeedsSwitch(open, 'sally', 'reachy', false)).toBe(false)
  expect(connectionNeedsSwitch({ ...open, mode: 'restricted' }, 'sally', 'reachy', true)).toBe(
    false,
  )
  expect(switchAndConnect(open, 'sally', 'reachy')).toMatchObject({
    mode: 'restricted',
    edges: [{ from: 'sally', to: 'reachy' }],
  })
})

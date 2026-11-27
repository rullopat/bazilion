// A tab open across an upgrade learns from any response that the server runs another build.
import { afterEach, expect, test } from 'vitest'
import {
  _resetBuildForTest,
  isServerUpdated,
  noteServerBuild,
  PAGE_BUILD,
} from '../src/lib/build.ts'

afterEach(() => _resetBuildForTest())

test('only a build other than the page’s marks it out of date', () => {
  // Unit tests run without Vite's define: the page is the development build.
  expect(PAGE_BUILD).toBe('dev')
  noteServerBuild(null)
  noteServerBuild(undefined)
  noteServerBuild('dev')
  expect(isServerUpdated()).toBe(false)
  noteServerBuild('2026-11-27T19:30:00.000Z')
  expect(isServerUpdated()).toBe(true)
})

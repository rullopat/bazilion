import { afterEach, expect, test } from 'vitest'
import { miscRouter } from '../../src/routes/misc.ts'

const originalEnforcement = process.env.BAZILION_HARNESS_ENFORCEMENT

afterEach(() => {
  if (originalEnforcement === undefined) delete process.env.BAZILION_HARNESS_ENFORCEMENT
  else process.env.BAZILION_HARNESS_ENFORCEMENT = originalEnforcement
})

test('health exposes the disabled BAZ-012 harness management contract', async () => {
  delete process.env.BAZILION_HARNESS_ENFORCEMENT
  const response = await miscRouter.request('/health')
  expect(response.status).toBe(200)
  const report = (await response.json()) as {
    harnessManagement: {
      contractVersion: number
      enforcementRequested: boolean
      releaseReady: boolean
    }
  }
  expect(report.harnessManagement).toEqual({
    contractVersion: 0,
    enforcementRequested: false,
    releaseReady: false,
  })
})

test('health reports a requested gate without claiming release readiness', async () => {
  process.env.BAZILION_HARNESS_ENFORCEMENT = 'on'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    harnessManagement: { enforcementRequested: boolean; releaseReady: boolean }
  }
  expect(report.harnessManagement).toMatchObject({
    enforcementRequested: true,
    releaseReady: false,
  })
})

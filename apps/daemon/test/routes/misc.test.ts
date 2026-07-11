import { afterEach, expect, test } from 'vitest'
import { miscRouter } from '../../src/routes/misc.ts'

const originalEnforcement = process.env.BAZILION_HARNESS_ENFORCEMENT

afterEach(() => {
  if (originalEnforcement === undefined) delete process.env.BAZILION_HARNESS_ENFORCEMENT
  else process.env.BAZILION_HARNESS_ENFORCEMENT = originalEnforcement
})

test('health exposes the release-ready harness management contract with enforcement off', async () => {
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
    contractVersion: 1,
    enforcementRequested: false,
    enforcementActive: false,
    releaseReady: true,
    degraded: false,
    decisions: { allowed: 0, denied: 0 },
  })
})

test('health reports active enforcement when requested by a release-ready build', async () => {
  process.env.BAZILION_HARNESS_ENFORCEMENT = 'on'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    harnessManagement: { enforcementRequested: boolean; releaseReady: boolean }
  }
  expect(report.harnessManagement).toMatchObject({
    enforcementRequested: true,
    enforcementActive: true,
    releaseReady: true,
    degraded: false,
  })
})
